import type { ExchangeContext, IExchangePrivateStreamAdapter, PrivateStreamEvent } from './interfaces';
import { assertProductionWsUrl } from './ws-config';

/**
 * Dedups private events by (type+key) and drops out-of-order/stale events using a per-key sequence
 * high-water mark, so an old event never overwrites newer state (docs PHASE3-05).
 */
export class PrivateEventDedup {
  private seen = new Set<string>();
  private hwm = new Map<string, number>();
  /** returns true if the event should be APPLIED, false if duplicate or stale/out-of-order. */
  accept(key: string, seq: number, dedupId?: string): boolean {
    if (dedupId) {
      if (this.seen.has(dedupId)) return false;
      this.seen.add(dedupId);
    }
    const cur = this.hwm.get(key) ?? -Infinity;
    if (seq <= cur) return false; // stale / out-of-order
    this.hwm.set(key, seq);
    return true;
  }
}

/**
 * In-memory mock private stream (for tests / SHADOW). A real BitMart private WS adapter implements
 * the same interface with auth + heartbeat + reconnect + backoff; kept mock here because live
 * connection requires real credentials (Not Executed).
 */
export class MockPrivateStreamAdapter implements IExchangePrivateStreamAdapter {
  private onEvent?: (e: PrivateStreamEvent) => void;
  private _connected = false;
  readonly subscriptions = new Set<string>();
  get connected(): boolean {
    return this._connected;
  }
  async connect(_ctx: ExchangeContext, onEvent: (e: PrivateStreamEvent) => void): Promise<void> {
    this.onEvent = onEvent;
    this._connected = true;
  }
  subscribe(channels: string[]): void {
    for (const ch of channels) this.subscriptions.add(ch);
  }
  disconnect(): void {
    this._connected = false;
    this.subscriptions.clear();
    this.onEvent = undefined;
  }
  /** test helper: push an event as if received from the exchange. */
  emit(e: PrivateStreamEvent): void {
    if (this._connected) this.onEvent?.(e);
  }
}

/**
 * Production BitMart private (user) stream adapter. The WS URL is validated at construction against
 * the production allowlist (`assertProductionWsUrl`) so a demo/non-official URL is rejected
 * fail-closed BEFORE any connect. Live auth/connect requires real credentials (loaded via the
 * server-side credential provider); without them `connect` is Not Executed.
 */
export interface BitMartPrivateStreamConfig {
  /** production private WS URL, e.g. wss://openapi-ws-v2.bitmart.com/user?protocol=1.1 */
  url: string;
  /** injectable socket factory (real ws in prod, fake in tests). Absent → connect not executed. */
  socketFactory?: (url: string) => unknown;
}

export class BitMartPrivateStreamAdapter implements IExchangePrivateStreamAdapter {
  readonly url: string;
  private onEvent?: (e: PrivateStreamEvent) => void;
  private _connected = false;
  readonly subscriptions = new Set<string>();
  readonly dedup = new PrivateEventDedup();

  constructor(cfg: BitMartPrivateStreamConfig) {
    // Fail-closed: reject demo / non-official / non-wss URLs before anything else.
    this.url = assertProductionWsUrl(cfg.url, 'private');
    this.socketFactory = cfg.socketFactory;
  }
  private readonly socketFactory?: (url: string) => unknown;

  get connected(): boolean {
    return this._connected;
  }
  async connect(_ctx: ExchangeContext, onEvent: (e: PrivateStreamEvent) => void): Promise<void> {
    if (!this.socketFactory) {
      // No socket factory (and, in this environment, no real credentials) → do NOT fake a connection.
      throw new Error('private WS connect Not Executed: no socket factory / credentials injected (fail-closed)');
    }
    this.onEvent = onEvent;
    this.socketFactory(this.url);
    this._connected = true;
  }
  subscribe(channels: string[]): void {
    for (const ch of channels) this.subscriptions.add(ch);
  }
  /** Dispatch a raw stream event through dedup/out-of-order protection to the consumer. */
  handleRawEvent(key: string, e: PrivateStreamEvent, dedupId?: string): boolean {
    if (!this._connected || !this.onEvent) return false;
    if (!this.dedup.accept(key, e.seq, dedupId)) return false;
    this.onEvent(e);
    return true;
  }
  disconnect(): void {
    this._connected = false;
    this.subscriptions.clear();
    this.onEvent = undefined;
  }
}
