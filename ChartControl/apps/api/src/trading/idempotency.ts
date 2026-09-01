import { randomBytes } from 'node:crypto';

/**
 * Idempotency service (docs PHASE3-09). Same idempotency key ⇒ same result; concurrent requests
 * with the same key are serialized so a duplicate submit never produces two orders. Backed by a
 * store (memory for tests; a UNIQUE-constrained DB table in production).
 */
export interface IdempotencyStore {
  get(key: string): Promise<{ result: unknown } | null>;
  /**
   * @param meta 저장에 필요한 부가 정보(사용자·용도). DB 구현이 컬럼으로 요구한다.
   *
   * ★ 키에서 사용자 id 를 파싱하지 않는다. 키 형식이 바뀌는 날 조용히 엉뚱한
   *   사용자에게 기록이 붙는다 — 명시적으로 받는다.
   */
  put(key: string, result: unknown, meta?: { userId?: string; scope?: string }): Promise<void>;
}

export class MemoryIdempotencyStore implements IdempotencyStore {
  private m = new Map<string, unknown>();
  async get(key: string) {
    return this.m.has(key) ? { result: this.m.get(key) } : null;
  }
  async put(key: string, result: unknown) {
    this.m.set(key, result);
  }
}

export function newClientOrderId(prefix = 'qt'): string {
  return `${prefix}-${Date.now().toString(36)}-${randomBytes(6).toString('hex')}`;
}

export class IdempotencyService {
  private inflight = new Map<string, Promise<unknown>>();
  constructor(private readonly store: IdempotencyStore) {}

  /** Run `fn` at most once per key; concurrent/duplicate calls await/return the same result. */
  async run<T>(
    key: string,
    fn: () => Promise<T>,
    meta?: { userId?: string; scope?: string },
  ): Promise<{ result: T; replayed: boolean }> {
    const existing = await this.store.get(key);
    if (existing) return { result: existing.result as T, replayed: true };
    const pending = this.inflight.get(key);
    if (pending) return { result: (await pending) as T, replayed: true };

    const p = (async () => {
      const r = await fn();
      await this.store.put(key, r, meta);
      return r;
    })();
    this.inflight.set(key, p);
    try {
      const result = await p;
      return { result, replayed: false };
    } finally {
      this.inflight.delete(key);
    }
  }
}
