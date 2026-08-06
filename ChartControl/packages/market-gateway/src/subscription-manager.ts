/**
 * Subscription manager (Phase 6 §1): per (symbol, channel) reference counting so N browser subscribers
 * share ONE upstream BitMart subscription. First subscriber opens upstream; last unsubscribe cleans it
 * up. This is the core dedup that keeps upstream connections bounded regardless of user count.
 */
export interface UpstreamController {
  open(key: string): void | Promise<void>;
  close(key: string): void | Promise<void>;
}

export function subKey(symbol: string, channel: string): string {
  return `${channel}:${symbol}`;
}

export class SubscriptionManager {
  private refs = new Map<string, Set<string>>(); // key → set of consumerIds
  constructor(private readonly upstream: UpstreamController) {}

  /** Returns true if this opened a NEW upstream subscription. */
  async subscribe(consumerId: string, symbol: string, channel: string): Promise<boolean> {
    const key = subKey(symbol, channel);
    let set = this.refs.get(key);
    const isNew = !set || set.size === 0;
    if (!set) { set = new Set(); this.refs.set(key, set); }
    set.add(consumerId);
    if (isNew) await this.upstream.open(key);
    return isNew;
  }

  /** Returns true if this closed the upstream subscription (last consumer left). */
  async unsubscribe(consumerId: string, symbol: string, channel: string): Promise<boolean> {
    const key = subKey(symbol, channel);
    const set = this.refs.get(key);
    if (!set) return false;
    set.delete(consumerId);
    if (set.size === 0) { this.refs.delete(key); await this.upstream.close(key); return true; }
    return false;
  }

  /** Remove a consumer entirely (disconnect); closes any now-empty upstreams. */
  async dropConsumer(consumerId: string): Promise<string[]> {
    const closed: string[] = [];
    for (const [key, set] of [...this.refs.entries()]) {
      if (set.delete(consumerId) && set.size === 0) {
        this.refs.delete(key);
        await this.upstream.close(key);
        closed.push(key);
      }
    }
    return closed;
  }

  refCount(symbol: string, channel: string): number {
    return this.refs.get(subKey(symbol, channel))?.size ?? 0;
  }
  upstreamCount(): number { return this.refs.size; }
  activeKeys(): string[] { return [...this.refs.keys()]; }
}
