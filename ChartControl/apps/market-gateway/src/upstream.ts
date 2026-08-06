import WebSocket from 'ws';
import {
  FUTURES_WS_PUBLIC_URL,
  REST_KLINE_STEP,
  klineTopic,
  parseFrame,
  parseRestKlines,
  pingFrame,
  restKlineUrl,
  subscribeFrame,
  tickerTopic,
  tradeTopic,
  unsubscribeFrame,
  depthTopic,
  isStreamableTimeframe,
  WS_PING_INTERVAL_MS,
  type WsCandle,
} from '@quantumtrade/exchange-bitmart';
import type { Timeframe } from '@quantumtrade/config';
import type { GatewayConfig } from './config';
import { parseStreamKey, type StreamKey } from './stream-key';

/** A normalized upstream market message flowing gateway-ward. */
export interface UpstreamMessage {
  key: string; // `${channel}:${symbol}` — candles carry the timeframe as `candle@1m:BTCUSDT`
  seq: number;
  ts: number;
  type: 'candle' | 'ticker' | 'orderbook_snapshot' | 'orderbook_delta' | 'trade';
  data: unknown;
}

export interface Upstream {
  onMessage(cb: (m: UpstreamMessage) => void): void;
  open(key: string): void | Promise<void>;
  close(key: string): void | Promise<void>;
  /** REST gap-fill for a missing sequence range (returns synthesized/fetched messages). */
  restGapFill(key: string, fromSeq: number, toSeq: number): Promise<UpstreamMessage[]>;
  status(): { mode: string; connected: boolean; upstreamConnections: number };
  stop(): Promise<void>;
}

/** Deterministic in-process replay upstream — no external network. Emits sequenced candle + orderbook. */
export class MockReplayUpstream implements Upstream {
  private timers = new Map<string, NodeJS.Timeout>();
  private seq = new Map<string, number>();
  private cb: (m: UpstreamMessage) => void = () => {};
  constructor(private readonly intervalMs = 200) {}
  onMessage(cb: (m: UpstreamMessage) => void): void { this.cb = cb; }
  open(key: string): void {
    if (this.timers.has(key)) return;
    this.seq.set(key, 0);
    // `candle@1m` → `candle`: the base channel drives the payload shape.
    const channel = parseStreamKey(key)?.channel ?? key.split(':')[0];
    if (channel === 'orderbook') this.cb({ key, seq: this.next(key), ts: Date.now(), type: 'orderbook_snapshot', data: { bids: [['68000', '1']], asks: [['68010', '1']] } });
    const t = setInterval(() => {
      const s = this.next(key);
      const price = 68000 + Math.round(Math.sin(s / 5) * 50);
      if (channel === 'candle') this.cb({ key, seq: s, ts: Date.now(), type: 'candle', data: { openTime: Date.now(), open: price, high: price + 5, low: price - 5, close: price, volume: 1 } });
      else if (channel === 'orderbook') this.cb({ key, seq: s, ts: Date.now(), type: 'orderbook_delta', data: { prevSeq: s - 1, seq: s, bids: [[String(price), '2']], asks: [] } });
      else this.cb({ key, seq: s, ts: Date.now(), type: channel === 'trades' ? 'trade' : 'ticker', data: { price, ts: Date.now() } });
    }, this.intervalMs);
    if (typeof t.unref === 'function') t.unref();
    this.timers.set(key, t);
  }
  close(key: string): void { const t = this.timers.get(key); if (t) { clearInterval(t); this.timers.delete(key); this.seq.delete(key); } }
  private next(key: string): number { const n = (this.seq.get(key) ?? 0) + 1; this.seq.set(key, n); return n; }
  async restGapFill(key: string, fromSeq: number, toSeq: number): Promise<UpstreamMessage[]> {
    const out: UpstreamMessage[] = [];
    for (let s = fromSeq; s <= toSeq; s++) out.push({ key, seq: s, ts: Date.now(), type: 'candle', data: { gapFilled: true, seq: s } });
    return out;
  }
  status() { return { mode: 'MOCK_REPLAY', connected: true, upstreamConnections: this.timers.size }; }
  async stop(): Promise<void> { for (const t of this.timers.values()) clearInterval(t); this.timers.clear(); }
}

/** Diagnostics surfaced on /health/ready so a broken subscription is visible instead of silent. */
export interface UpstreamDiagnostics {
  /** Topics the exchange accepted. */
  acked: string[];
  /** Topics the exchange REJECTED, with its reason. */
  rejected: { topic: string; error: string }[];
  /** Keys we could not translate into any exchange topic (e.g. a 3m candle). */
  unsupported: { key: string; reason: string }[];
  reconnects: number;
  unknownFrames: number;
  lastMessageAt: number | null;
}

interface Sub {
  key: string;
  parsed: StreamKey;
  topic: string | null;
}

/**
 * BitMart PUBLIC futures upstream (no secret).
 *
 * Rewritten after verifying the protocol against the live endpoint. The previous implementation could not
 * have worked and could not report that it wasn't working:
 *
 *  - it sent `{op:'subscribe'}` where the server expects `{action:'subscribe'}`;
 *  - it subscribed to `spot/ticker:<symbol>` on a **futures** platform — verified live to be rejected with
 *    `Invalid channel: not found`;
 *  - it discarded subscription acks, including failures, inside a bare `catch {}`;
 *  - it labelled every inbound frame `type:'ticker'`, so candles could never reach the candle cache;
 *  - it read `msg.data[0].symbol` while futures payloads are objects, so the symbol was always empty and
 *    every key collapsed to `ticker:`;
 *  - it never pinged, so the server would drop the connection after 20s of quiet;
 *  - it never reconnected, and `status().connected` stayed true through all of the above.
 */
export class BitMartPublicUpstream implements Upstream {
  private ws: WebSocket | null = null;
  private cb: (m: UpstreamMessage) => void = () => {};
  private seq = new Map<string, number>();
  private subs = new Map<string, Sub>();
  /** topic → key, for routing inbound frames back to the subscription that asked for them. */
  private topicToKey = new Map<string, string>();
  private connected = false;
  private stopped = false;
  private pingTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private attempt = 0;
  private diag: UpstreamDiagnostics = {
    acked: [],
    rejected: [],
    unsupported: [],
    reconnects: 0,
    unknownFrames: 0,
    lastMessageAt: null,
  };

  constructor(
    private readonly cfg: GatewayConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  onMessage(cb: (m: UpstreamMessage) => void): void { this.cb = cb; }

  /**
   * Why a key cannot be streamed, or null when it can.
   *
   * The gateway uses this to tell the client, because a `subscribed` ack for a stream that will never
   * deliver a frame is worse than a refusal: the client waits forever and shows a live-looking chart.
   */
  unsupportedReason(key: string): string | null {
    return this.diag.unsupported.find((u) => u.key === key)?.reason ?? null;
  }

  diagnostics(): UpstreamDiagnostics {
    return {
      ...this.diag,
      acked: [...this.diag.acked],
      rejected: this.diag.rejected.map((r) => ({ ...r })),
      unsupported: this.diag.unsupported.map((u) => ({ ...u })),
    };
  }

  /** Translates an internal stream key into a BitMart topic, or null with a stated reason. */
  private topicFor(parsed: StreamKey): { topic: string } | { reason: string } {
    const { channel, symbol, timeframe } = parsed;
    if (channel === 'candle') {
      if (timeframe === undefined) return { reason: 'candle subscription without a timeframe' };
      if (!isStreamableTimeframe(timeframe)) {
        // 3m is the real case: BitMart has no klineBin3m channel (verified live).
        return { reason: `BitMart has no kline channel for ${timeframe}; REST polling only` };
      }
      const t = klineTopic(symbol, timeframe as Timeframe);
      return t === null ? { reason: `no kline channel for ${timeframe}` } : { topic: t };
    }
    if (channel === 'ticker') return { topic: tickerTopic(symbol) };
    if (channel === 'trades') return { topic: tradeTopic(symbol) };
    if (channel === 'orderbook') return { topic: depthTopic(symbol, 20, '200ms') };
    return { reason: `unsupported channel ${channel}` };
  }

  private ensure(): void {
    if (this.ws || this.stopped) return;
    const ws = new WebSocket(this.cfg.bitmartWsUrl || FUTURES_WS_PUBLIC_URL, { handshakeTimeout: 8000 });
    this.ws = ws;

    ws.on('open', () => {
      this.connected = true;
      this.attempt = 0;
      // The server closes a connection that has not subscribed within 5s, so subscribe immediately.
      const topics = [...this.subs.values()].map((s) => s.topic).filter((t): t is string => t !== null);
      if (topics.length > 0) this.send(subscribeFrame(topics));
      this.startPing();
    });

    ws.on('message', (raw) => this.handleFrame(String(raw)));
    ws.on('error', () => { this.connected = false; });
    ws.on('close', () => {
      this.connected = false;
      this.stopPing();
      if (this.ws === ws) this.ws = null;
      this.scheduleReconnect();
    });
  }

  private send(payload: string): void {
    try {
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(payload);
    } catch {
      /* the close handler will reconnect */
    }
  }

  private startPing(): void {
    this.stopPing();
    // Well inside the server's 20s idle timeout. Quiet channels (a 1d kline) would otherwise be dropped.
    const t = setInterval(() => this.send(pingFrame()), WS_PING_INTERVAL_MS);
    if (typeof t.unref === 'function') t.unref();
    this.pingTimer = t;
  }

  private stopPing(): void {
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer || this.subs.size === 0) return;
    this.attempt += 1;
    // Exponential backoff capped at 30s. Reconnecting instantly in a loop would trip BitMart's
    // 500-connections-per-IP limit and get us rate-limited.
    const delay = Math.min(30_000, 500 * 2 ** Math.min(this.attempt, 6));
    const t = setTimeout(() => {
      this.reconnectTimer = null;
      this.diag.reconnects += 1;
      this.ensure();
    }, delay);
    if (typeof t.unref === 'function') t.unref();
    this.reconnectTimer = t;
  }

  private handleFrame(raw: string): void {
    const f = parseFrame(raw);
    switch (f.kind) {
      case 'pong':
        return;

      case 'ack': {
        // Recorded, not swallowed: a rejected topic means that stream is dead, and the operator needs to
        // see it. The previous implementation discarded exactly this information.
        const topic = f.group ?? '(unknown)';
        if (f.success) {
          if (f.action === 'subscribe' && !this.diag.acked.includes(topic)) this.diag.acked.push(topic);
          if (f.action === 'unsubscribe') this.diag.acked = this.diag.acked.filter((t) => t !== topic);
        } else if (!this.diag.rejected.some((r) => r.topic === topic)) {
          this.diag.rejected.push({ topic, error: f.error ?? 'unknown error' });
        }
        return;
      }

      case 'kline': {
        const key = this.topicToKey.get(f.topic);
        if (key === undefined) return;
        this.diag.lastMessageAt = Date.now();
        for (const c of f.candles) this.emit(key, 'candle', c);
        return;
      }

      case 'ticker': {
        const key = this.topicToKey.get(f.topic);
        if (key === undefined) return;
        this.diag.lastMessageAt = Date.now();
        this.emit(key, 'ticker', f.ticker);
        return;
      }

      case 'trade': {
        const key = this.topicToKey.get(f.topic);
        if (key === undefined) return;
        this.diag.lastMessageAt = Date.now();
        for (const t of f.trades) this.emit(key, 'trade', t);
        return;
      }

      case 'depth': {
        const key = this.topicToKey.get(f.topic);
        if (key === undefined) return;
        this.diag.lastMessageAt = Date.now();
        // One side per message. Emitting a snapshot with a single side would leave the book half empty, so
        // this is delivered as a side-tagged snapshot and assembled downstream.
        this.emit(key, 'orderbook_snapshot', {
          side: f.depth.side,
          levels: f.depth.levels,
          ts: f.depth.ts,
          partial: true,
        });
        return;
      }

      case 'bookticker': {
        const key = this.topicToKey.get(f.topic);
        if (key === undefined) return;
        this.diag.lastMessageAt = Date.now();
        this.emit(key, 'ticker', f.book);
        return;
      }

      default:
        this.diag.unknownFrames += 1;
    }
  }

  private emit(key: string, type: UpstreamMessage['type'], data: unknown): void {
    const s = (this.seq.get(key) ?? 0) + 1;
    this.seq.set(key, s);
    this.cb({ key, seq: s, ts: Date.now(), type, data });
  }

  open(key: string): void {
    if (this.subs.has(key)) return;
    const parsed = parseStreamKey(key);
    if (parsed === null) {
      this.diag.unsupported.push({ key, reason: 'unparseable stream key' });
      return;
    }
    const t = this.topicFor(parsed);
    if ('reason' in t) {
      // Recorded rather than ignored: the client asked for something this exchange cannot stream.
      if (!this.diag.unsupported.some((u) => u.key === key)) {
        this.diag.unsupported.push({ key, reason: t.reason });
      }
      this.subs.set(key, { key, parsed, topic: null });
      return;
    }
    this.subs.set(key, { key, parsed, topic: t.topic });
    this.topicToKey.set(t.topic, key);
    this.ensure();
    if (this.connected) this.send(subscribeFrame([t.topic]));
  }

  close(key: string): void {
    const s = this.subs.get(key);
    if (!s) return;
    this.subs.delete(key);
    this.seq.delete(key);
    if (s.topic !== null) {
      this.topicToKey.delete(s.topic);
      this.diag.acked = this.diag.acked.filter((t) => t !== s.topic);
      if (this.connected) this.send(unsubscribeFrame([s.topic]));
    }
  }

  /**
   * Fetches recent bars over REST.
   *
   * The gateway assigns its own sequence numbers, so `fromSeq`/`toSeq` carry no exchange-side meaning and
   * cannot be turned into a time range. What IS recoverable — and what actually matters after a reconnect
   * — is the recent history for the key's symbol and timeframe, so that is what this returns. Non-candle
   * channels have no equivalent replay endpoint and return an empty list.
   */
  async restGapFill(key: string, fromSeq: number, toSeq: number): Promise<UpstreamMessage[]> {
    void fromSeq;
    const parsed = parseStreamKey(key);
    if (parsed === null || parsed.channel !== 'candle' || parsed.timeframe === undefined) return [];
    const candles = await this.fetchCandles(parsed.symbol, parsed.timeframe as Timeframe, 120);
    let s = toSeq;
    return candles.map((c) => ({ key, seq: ++s, ts: Date.now(), type: 'candle' as const, data: c }));
  }

  /** Recent history for a symbol/timeframe. Used for gap-fill and for seeding a new subscriber. */
  async fetchCandles(symbol: string, tf: Timeframe, bars = 120): Promise<WsCandle[]> {
    const stepMin = REST_KLINE_STEP[tf];
    const nowSec = Math.floor(Date.now() / 1000);
    // Both start_time and end_time are required, in seconds, and one call returns at most 500 bars.
    const fromSec = nowSec - stepMin * 60 * Math.min(bars, 500);
    const url = restKlineUrl(this.cfg.bitmartRestBase, symbol, tf, fromSec, nowSec);
    try {
      const res = await this.fetchImpl(url, { headers: { accept: 'application/json' } });
      if (!res.ok) return [];
      return parseRestKlines(await res.json());
    } catch {
      // Best-effort: an empty list means "no history available", which callers render as such.
      return [];
    }
  }

  status() {
    return {
      mode: 'BITMART_PUBLIC',
      // Reflects the socket AND whether any subscription was actually accepted: a socket that is open but
      // whose every topic was rejected is not a working upstream.
      connected: this.connected && (this.subs.size === 0 || this.diag.acked.length > 0),
      upstreamConnections: this.subs.size,
    };
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.stopPing();
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    try { this.ws?.close(); } catch { /* ignore */ }
    this.ws = null;
    this.connected = false;
  }
}

export function createUpstream(cfg: GatewayConfig): Upstream {
  return cfg.upstream === 'BITMART_PUBLIC' ? new BitMartPublicUpstream(cfg) : new MockReplayUpstream();
}
