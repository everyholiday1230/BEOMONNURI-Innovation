import { RedisClient } from './resp-client';

/**
 * Multinode shared state (Phase 6 §4). A versioned key/value store with optimistic concurrency (CAS)
 * and a pub/sub invalidation channel so cache-invalidation propagates across API/WS/Admin instances.
 * Live-trading-related state is FAIL-CLOSED: if the shared store is unavailable, callers must treat
 * the kill switch as ACTIVE (blocked). Provider is behind an interface (Redis or in-memory for tests).
 */
export interface VersionedValue {
  value: string;
  version: number;
}

export interface SharedStateStore {
  get(key: string): Promise<VersionedValue | null>;
  /** Compare-and-set: succeeds only if the current version equals expectedVersion (0 to create). */
  cas(key: string, value: string, expectedVersion: number): Promise<boolean>;
  del(key: string): Promise<void>;
  /** Publish an invalidation event to subscribers on other nodes. */
  publishInvalidation(key: string): Promise<void>;
}

export class InMemorySharedState implements SharedStateStore {
  private map = new Map<string, VersionedValue>();
  constructor(private readonly onInvalidate?: (key: string) => void) {}
  async get(key: string): Promise<VersionedValue | null> { return this.map.get(key) ?? null; }
  async cas(key: string, value: string, expectedVersion: number): Promise<boolean> {
    const cur = this.map.get(key);
    const curVer = cur?.version ?? 0;
    if (curVer !== expectedVersion) return false;
    this.map.set(key, { value, version: curVer + 1 });
    this.onInvalidate?.(key);
    return true;
  }
  async del(key: string): Promise<void> { this.map.delete(key); this.onInvalidate?.(key); }
  async publishInvalidation(key: string): Promise<void> { this.onInvalidate?.(key); }
}

// Atomic CAS + publish in one round-trip (avoids races across nodes).
const CAS_LUA = `
local cur = redis.call('HGET', KEYS[1], 'version')
if cur == false then
  if tonumber(ARGV[2]) ~= 0 then return 0 end
  redis.call('HSET', KEYS[1], 'value', ARGV[1], 'version', 1)
  redis.call('PUBLISH', ARGV[3], KEYS[1])
  return 1
end
if tonumber(cur) == tonumber(ARGV[2]) then
  redis.call('HSET', KEYS[1], 'value', ARGV[1], 'version', tonumber(cur)+1)
  redis.call('PUBLISH', ARGV[3], KEYS[1])
  return 1
end
return 0`;

export class RedisSharedState implements SharedStateStore {
  constructor(private readonly client: RedisClient, private readonly channel = 'qt:invalidate') {}
  async get(key: string): Promise<VersionedValue | null> {
    const reply = (await this.client.command('HMGET', key, 'value', 'version')) as (string | null)[];
    const value = reply[0];
    const version = reply[1];
    if (value == null || version == null) return null;
    return { value, version: Number(version) };
  }
  async cas(key: string, value: string, expectedVersion: number): Promise<boolean> {
    const r = await this.client.command('EVAL', CAS_LUA, 1, key, value, expectedVersion, this.channel);
    return Number(r) === 1;
  }
  async del(key: string): Promise<void> {
    await this.client.command('DEL', key);
    await this.client.command('PUBLISH', this.channel, key);
  }
  async publishInvalidation(key: string): Promise<void> {
    await this.client.command('PUBLISH', this.channel, key);
  }
}

/**
 * Fail-closed reader for live-trading kill switches. Live scopes default to BLOCKED (active) whenever
 * the shared store read fails (Redis outage). Non-live scopes default to their provided safe default.
 */
/*
   ★ 거래소 중립 이름(exchange_live_trading)과 옛 이름(bitmart_live_trading)을
     모두 포함한다. 조회 실패 시 안전 기본값(차단)을 적용할 대상이므로, 새 이름이
     빠지면 새 스코프가 조회 실패 때 **열린 채로** 남는다.
*/
export const LIVE_TRADING_SCOPES = new Set(['global_live_trading', 'exchange_live_trading', 'bitmart_live_trading', 'new_positions']);

export async function readKillSwitchFailClosed(
  store: SharedStateStore,
  scope: string,
): Promise<{ active: boolean; degraded: boolean }> {
  try {
    const v = await store.get(`killswitch:${scope}`);
    if (!v) return { active: LIVE_TRADING_SCOPES.has(scope), degraded: false }; // unset → safe default
    return { active: v.value === '1', degraded: false };
  } catch {
    // store unavailable → fail closed for live-trading scopes
    return { active: LIVE_TRADING_SCOPES.has(scope), degraded: true };
  }
}
