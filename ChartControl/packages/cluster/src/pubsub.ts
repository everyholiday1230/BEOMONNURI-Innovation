import { RedisClient, type RedisClientOptions } from './resp-client';

/**
 * Cross-node pub/sub (Phase 6 §4). Interface with an in-memory implementation (single-node/tests) and
 * a Redis implementation. The Redis subscriber uses a DEDICATED connection (Redis requires a separate
 * connection while subscribed). Duplicate events are deduplicated by an optional event id.
 */
export interface PubSub {
  publish(channel: string, message: string): Promise<void>;
  subscribe(channel: string, handler: (message: string) => void): Promise<void>;
  close(): Promise<void>;
}

export class InMemoryPubSub implements PubSub {
  private handlers = new Map<string, Array<(m: string) => void>>();
  async publish(channel: string, message: string): Promise<void> {
    for (const h of this.handlers.get(channel) ?? []) h(message);
  }
  async subscribe(channel: string, handler: (m: string) => void): Promise<void> {
    const list = this.handlers.get(channel) ?? [];
    list.push(handler);
    this.handlers.set(channel, list);
  }
  async close(): Promise<void> { this.handlers.clear(); }
}

export class RedisPubSub implements PubSub {
  private pub: RedisClient;
  private sub: RedisClient;
  private handlers = new Map<string, Array<(m: string) => void>>();
  private connected = false;
  constructor(opts: RedisClientOptions) {
    this.pub = new RedisClient(opts);
    this.sub = new RedisClient(opts);
  }
  private async ensure(): Promise<void> {
    if (this.connected) return;
    await this.pub.connect();
    await this.sub.connect();
    this.sub.onMessage((channel, message) => {
      for (const h of this.handlers.get(channel) ?? []) h(message);
    });
    this.connected = true;
  }
  async publish(channel: string, message: string): Promise<void> {
    await this.ensure();
    await this.pub.command('PUBLISH', channel, message);
  }
  async subscribe(channel: string, handler: (m: string) => void): Promise<void> {
    await this.ensure();
    const list = this.handlers.get(channel) ?? [];
    list.push(handler);
    this.handlers.set(channel, list);
    await this.sub.command('SUBSCRIBE', channel);
  }
  async close(): Promise<void> {
    await this.pub.quit();
    await this.sub.quit();
    this.connected = false;
  }
}

/** Deduplicate events seen within a bounded window (multinode duplicate-event suppression). */
export class EventDeduper {
  private seen = new Map<string, number>();
  constructor(private readonly ttlMs = 60_000, private readonly now: () => number = Date.now) {}
  isDuplicate(id: string): boolean {
    const t = this.now();
    for (const [k, exp] of this.seen) if (exp <= t) this.seen.delete(k);
    if (this.seen.has(id)) return true;
    this.seen.set(id, t + this.ttlMs);
    return false;
  }
}
