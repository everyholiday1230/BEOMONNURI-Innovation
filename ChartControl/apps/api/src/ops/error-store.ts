import { createHash, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

/*
   ============================================================
   운영 오류 관측 (ops/error-store)

   ★★ 왜 만들었나

     이 서비스는 오류를 **고객 신고로만** 알 수 있었다. 클라이언트 오류는
     console.error 로만 남고 아무도 보지 않았고, 서버의 처리되지 않은 예외는
     어디에도 쌓이지 않았다. 실주문이 열린 서비스에서 이건 눈을 가린 상태다.

   ★★ 설계에서 지킨 두 가지

     1) 같은 원인은 한 행으로 모은다(fingerprint).
        오류는 폭주한다. 행이 수만 개가 되면 정작 읽을 수 없고, 알림을 그대로
        보내면 메일함이 막혀 **알림 자체가 무의미해진다.**

     2) 기록·알림 실패가 요청을 깨뜨리지 않는다.
        관측 장치가 서비스를 죽이면 안 된다. 모든 실패는 삼키고 로그만 남긴다.
        단, 삼킨 사실을 로그에 남긴다 — 조용히 사라지면 관측 장치가 죽은 것도
        모르게 된다.
   ============================================================ */

/** 저장 요청. message 외에는 모두 선택이다. */
export interface RecordErrorInput {
  source: 'client' | 'server';
  message: string;
  stack?: string | undefined;
  url?: string | undefined;
  method?: string | undefined;
  status?: number | undefined;
  userId?: string | undefined;
}

export interface OpsErrorRow {
  id: string;
  fingerprint: string;
  source: 'client' | 'server';
  message: string;
  stack: string | null;
  url: string | null;
  method: string | null;
  status: number | null;
  userId: string | null;
  seenCount: number;
  firstSeenAt: number;
  lastSeenAt: number;
  alertedAt: number | null;
}

/** 저장 결과. 알림을 보내야 하는지 호출자에게 알린다. */
export interface RecordErrorResult {
  fingerprint: string;
  /** 이 지문을 처음 본 것인가. */
  isNew: boolean;
  /** 지금까지 몇 번 봤는가(이번 포함). */
  seenCount: number;
  /** 알림을 보내야 하는가(처음 보거나, 마지막 알림 후 창이 지났을 때). */
  shouldAlert: boolean;
}

/*
   ★ 지문 계산.

     같은 원인을 같은 값으로, 다른 원인을 다른 값으로 묶어야 한다. 그래서
     (출처 · 메시지 · 스택 앞 3줄)만 쓴다.

   ★★ URL 을 지문에 넣지 않는다. 같은 버그가 여러 화면에서 나면 별개 오류로
     쪼개져 "한 원인당 한 행" 이 깨진다. 대신 처음 본 URL 을 행에 남긴다.

   ★★ 메시지에서 숫자·UUID·따옴표 안 값을 지운다. 그러지 않으면
     "order 8f2c… not found" 가 주문마다 새 지문이 되어 한 버그가 수천 행이 된다.
*/
export function fingerprintOf(input: Pick<RecordErrorInput, 'source' | 'message' | 'stack'>): string {
  const normMsg = String(input.message ?? '')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>')
    .replace(/\b\d[\d.,]*\b/g, '<n>')
    .replace(/'[^']*'/g, "'<v>'")
    .replace(/"[^"]*"/g, '"<v>"')
    .trim()
    .slice(0, 300);
  const normStack = String(input.stack ?? '')
    .split('\n')
    .slice(0, 3)
    .map((l) => l.replace(/:\d+:\d+/g, ':<line>').trim())
    .join(' | ')
    .slice(0, 500);
  return createHash('sha256').update(`${input.source}\u0000${normMsg}\u0000${normStack}`).digest('hex').slice(0, 32);
}

/** 같은 지문에 대해 이 간격 안에서는 알림을 다시 보내지 않는다. */
export const ALERT_WINDOW_MS = 60 * 60 * 1000;

const clip = (v: string | undefined, n: number) => {
  if (v === undefined) return null;
  const s = String(v);
  return s.length > n ? s.slice(0, n) : s;
};

export class PgOpsErrorStore {
  constructor(private readonly pool: Pool) {}

  /**
   * 오류를 기록한다. 같은 지문이면 횟수만 올린다.
   *
   * ★ 절대 던지지 않는다 — 관측 장치가 요청을 깨뜨리면 안 된다. 실패하면
   *   shouldAlert:false 로 돌려주고 로그에 남긴다.
   */
  async record(input: RecordErrorInput, now = Date.now()): Promise<RecordErrorResult | null> {
    const fingerprint = fingerprintOf(input);
    try {
      /*
         ★★ 한 번의 UPSERT 로 처리한다. 조회 후 삽입으로 나누면 동시에 들어온
           같은 오류가 UNIQUE 제약에 걸려 한쪽이 실패한다(폭주 시 정확히 그런다).

         ★ xmax = 0 은 "이번에 새로 삽입됐다" 는 뜻이다. 갱신이면 0 이 아니다.
           이 값으로 "처음 본 오류인가" 를 한 번의 왕복으로 알 수 있다.
      */
      const { rows } = await this.pool.query(
        `INSERT INTO ops_errors
           (id, fingerprint, source, message, stack, url, method, status, user_id,
            seen_count, first_seen_at, last_seen_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,1,$10,$10)
         ON CONFLICT (fingerprint) DO UPDATE
           SET seen_count = ops_errors.seen_count + 1,
               last_seen_at = $10
         RETURNING seen_count, alerted_at, (xmax = 0) AS inserted`,
        [
          randomUUID(), fingerprint, input.source,
          clip(input.message, 1000) ?? '', clip(input.stack, 4000),
          clip(input.url, 500), clip(input.method, 10),
          input.status ?? null, input.userId ?? null, now,
        ],
      );
      const r = rows[0] as { seen_count: number; alerted_at: string | number | null; inserted: boolean } | undefined;
      if (!r) return null;
      const isNew = r.inserted === true;
      const alertedAt = r.alerted_at === null ? null : Number(r.alerted_at);
      const shouldAlert = isNew || alertedAt === null || now - alertedAt >= ALERT_WINDOW_MS;
      return { fingerprint, isNew, seenCount: Number(r.seen_count), shouldAlert };
    } catch (e) {
      // ★ 삼키지만 조용히 사라지게 두지 않는다 — 관측 장치가 죽은 것도 알아야 한다.
      console.error(`[ops-error-store] 기록 실패 fp=${fingerprint} err=${(e as Error).message}`);
      return null;
    }
  }

  /** 알림을 보낸 시각을 표시한다. 실패는 삼킨다(알림은 이미 나갔다). */
  async markAlerted(fingerprint: string, now = Date.now()): Promise<void> {
    try {
      await this.pool.query('UPDATE ops_errors SET alerted_at = $2 WHERE fingerprint = $1', [fingerprint, now]);
    } catch (e) {
      console.error(`[ops-error-store] alerted_at 갱신 실패 fp=${fingerprint} err=${(e as Error).message}`);
    }
  }

  /** 최근 오류. 운영자 화면이 읽는다. */
  async recent(limit = 50): Promise<OpsErrorRow[]> {
    const n = Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 200) : 50;
    const { rows } = await this.pool.query(
      `SELECT id, fingerprint, source, message, stack, url, method, status, user_id,
              seen_count, first_seen_at, last_seen_at, alerted_at
         FROM ops_errors ORDER BY last_seen_at DESC LIMIT $1`,
      [n],
    );
    return rows.map((r) => ({
      id: String(r.id),
      fingerprint: String(r.fingerprint),
      source: r.source === 'server' ? 'server' : 'client',
      message: String(r.message),
      stack: r.stack === null ? null : String(r.stack),
      url: r.url === null ? null : String(r.url),
      method: r.method === null ? null : String(r.method),
      status: r.status === null ? null : Number(r.status),
      userId: r.user_id === null ? null : String(r.user_id),
      seenCount: Number(r.seen_count),
      firstSeenAt: Number(r.first_seen_at),
      lastSeenAt: Number(r.last_seen_at),
      alertedAt: r.alerted_at === null ? null : Number(r.alerted_at),
    }));
  }

  /** 지난 windowMs 안에 발생한 서로 다른 오류 수와 총 발생 횟수. */
  async summary(windowMs = 24 * 60 * 60 * 1000, now = Date.now()): Promise<{ distinct: number; total: number }> {
    const { rows } = await this.pool.query(
      'SELECT COUNT(*)::int AS distinct_n, COALESCE(SUM(seen_count),0)::int AS total_n FROM ops_errors WHERE last_seen_at >= $1',
      [now - windowMs],
    );
    const r = rows[0] as { distinct_n: number; total_n: number } | undefined;
    return { distinct: Number(r?.distinct_n ?? 0), total: Number(r?.total_n ?? 0) };
  }
}
