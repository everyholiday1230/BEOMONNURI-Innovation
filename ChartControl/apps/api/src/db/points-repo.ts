/**
 * 포인트 저장소 (Postgres).
 *
 * 이 파일이 지키는 불변식
 * --------------------
 * 1. **원장은 추가만 한다.** 행을 수정·삭제하지 않는다. 잘못된 적립은 반대
 *    부호 항목으로 상쇄한다. 그래야 언제 잘못됐고 언제 고쳤는지가 남는다.
 *
 * 2. **잔액을 저장하지 않는다.** SUM(delta) 로 구한다. 별도 컬럼을 두면
 *    원장과 어긋나는 순간이 생기고, 어느 쪽이 맞는지 알 수 없게 된다.
 *
 * 3. **차감은 행 잠금 안에서 한다.** 잠금 없이 "잔액 확인 → 차감" 을 하면
 *    동시 요청 두 개가 같은 잔액을 보고 각각 차감해 잔액이 음수가 된다
 *    (이중 사용). SELECT … FOR UPDATE 로 사용자 단위 직렬화한다.
 *
 * 4. **잔액은 음수가 될 수 없다.** DB CHECK 로도 막는다 — 애플리케이션 버그가
 *    통과해도 여기서 걸린다.
 *
 * 5. **같은 근거로 두 번 적립하지 않는다.** DB UNIQUE 인덱스가 막는다.
 *
 * ★ 포인트는 현금이 아니다. 이 파일에 출금·환전 함수가 없는 것은 의도적이다.
 *   현금으로 바꿔주면 자금 이동업이 되고 우리는 그 자격이 없다.
 */

import { randomUUID } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

export type PointReason =
  | 'referral_signup'
  | 'event_reward'
  | 'competition_prize'
  | 'admin_grant'
  | 'admin_revoke'
  | 'bug_bounty'
  | 'purchase'
  | 'redeem'
  | 'refund'
  | 'expiry';

export type CatalogKind = 'ai_run' | 'competition' | 'feature';

export interface PointSettings {
  enabled: boolean;
  unitName: string;
  purchaseEnabled: boolean;
  expiryDays: number;
  referralAsPoints: boolean;
  referralPoints: number;
  version: number;
  updatedBy: string | null;
  updatedAt: number;
}

export interface LedgerEntry {
  id: string;
  userId: string;
  delta: number;
  balanceAfter: number;
  reason: PointReason;
  refType: string | null;
  refId: string | null;
  memo: string | null;
  createdAt: number;
  createdBy: string | null;
}

export interface CatalogItem {
  id: string;
  nameKey: string;
  descKey: string | null;
  kind: CatalogKind;
  cost: number;
  grants: number;
  enabled: boolean;
  sortOrder: number;
}

export interface Redemption {
  id: string;
  userId: string;
  catalogId: string;
  ledgerId: string;
  cost: number;
  remaining: number;
  expiresAt: number | null;
  createdAt: number;
}

/** 정수 변환. 원장은 정수만 다룬다 — 소수 포인트는 반올림 분쟁을 만든다. */
/**
 * 포인트 수량은 정수만 받는다.
 *
 * ★ 소수를 조용히 버리거나 반올림하지 않는다.
 *   10.7 을 10 으로 만들면 사용자는 왜 줄었는지 모르고, 11 로 만들면 우리가
 *   요청보다 많은 부채를 진다. 어느 쪽도 설명할 수 없으므로 거부한다 —
 *   호출자가 무엇을 의도했는지 분명히 하게 만드는 것이 맞다.
 */
function int(v: unknown): number {
  const n = Number(v);
  if (!Number.isInteger(n)) throw new Error('POINTS_MUST_BE_INTEGER');
  return n;
}

function ms(v: unknown): number | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  const t = d.getTime();
  return Number.isFinite(t) ? t : null;
}

const L_COLS = `id, user_id, delta, balance_after, reason, ref_type, ref_id, memo, created_at, created_by`;
const C_COLS = `id, name_key, desc_key, kind, cost, grants, enabled, sort_order`;
const R_COLS = `id, user_id, catalog_id, ledger_id, cost, remaining, expires_at, created_at`;

function mapEntry(x: Record<string, unknown>): LedgerEntry {
  return {
    id: String(x.id),
    userId: String(x.user_id),
    delta: int(x.delta),
    balanceAfter: int(x.balance_after),
    reason: String(x.reason) as PointReason,
    refType: x.ref_type === null || x.ref_type === undefined ? null : String(x.ref_type),
    refId: x.ref_id === null || x.ref_id === undefined ? null : String(x.ref_id),
    memo: x.memo === null || x.memo === undefined ? null : String(x.memo),
    createdAt: ms(x.created_at) ?? 0,
    createdBy: x.created_by === null || x.created_by === undefined ? null : String(x.created_by),
  };
}

function mapItem(x: Record<string, unknown>): CatalogItem {
  return {
    id: String(x.id),
    nameKey: String(x.name_key),
    descKey: x.desc_key === null || x.desc_key === undefined ? null : String(x.desc_key),
    kind: String(x.kind) as CatalogKind,
    cost: int(x.cost),
    grants: int(x.grants),
    enabled: Boolean(x.enabled),
    sortOrder: int(x.sort_order),
  };
}

function mapRedemption(x: Record<string, unknown>): Redemption {
  return {
    id: String(x.id),
    userId: String(x.user_id),
    catalogId: String(x.catalog_id),
    ledgerId: String(x.ledger_id),
    cost: int(x.cost),
    remaining: int(x.remaining),
    expiresAt: ms(x.expires_at),
    createdAt: ms(x.created_at) ?? 0,
  };
}

/** 중복 적립(UNIQUE 위반) 여부. Postgres 코드 23505. */
function isDuplicate(e: unknown): boolean {
  return Boolean(e && typeof e === 'object' && (e as { code?: string }).code === '23505');
}

export class PgPointsRepo {
  constructor(private readonly pool: Pool) {}

  // ---- 제도 조건 ----

  /** 행이 없으면 **꺼진 상태**를 돌려준다. null 을 주면 호출자가 검사를 잊는다. */
  async getSettings(): Promise<PointSettings> {
    const r = await this.pool.query(
      `SELECT enabled, unit_name, purchase_enabled, expiry_days,
              referral_as_points, referral_points, version, updated_by, updated_at
         FROM point_settings WHERE id = 'default'`,
    );
    if (!r.rowCount) {
      return {
        enabled: false, unitName: 'Points', purchaseEnabled: false, expiryDays: 0,
        referralAsPoints: false, referralPoints: 0, version: 0, updatedBy: null, updatedAt: 0,
      };
    }
    const x = r.rows[0]!;
    return {
      enabled: Boolean(x.enabled),
      unitName: String(x.unit_name),
      purchaseEnabled: Boolean(x.purchase_enabled),
      expiryDays: int(x.expiry_days),
      referralAsPoints: Boolean(x.referral_as_points),
      referralPoints: int(x.referral_points),
      version: int(x.version),
      updatedBy: x.updated_by === null ? null : String(x.updated_by),
      updatedAt: ms(x.updated_at) ?? 0,
    };
  }

  async updateSettings(input: {
    enabled: boolean;
    unitName: string;
    purchaseEnabled: boolean;
    expiryDays: number;
    referralAsPoints: boolean;
    referralPoints: number;
  }, actorId: string | null): Promise<PointSettings> {
    await this.pool.query(
      `INSERT INTO point_settings
         (id, enabled, unit_name, purchase_enabled, expiry_days, referral_as_points, referral_points, version, updated_by, updated_at)
       VALUES ('default', $1,$2,$3,$4,$5,$6, 1, $7, now())
       ON CONFLICT (id) DO UPDATE SET
         enabled = excluded.enabled,
         unit_name = excluded.unit_name,
         purchase_enabled = excluded.purchase_enabled,
         expiry_days = excluded.expiry_days,
         referral_as_points = excluded.referral_as_points,
         referral_points = excluded.referral_points,
         version = point_settings.version + 1,
         updated_by = excluded.updated_by,
         updated_at = now()`,
      [
        input.enabled, input.unitName, input.purchaseEnabled, input.expiryDays,
        input.referralAsPoints, input.referralPoints, actorId,
      ],
    );
    return this.getSettings();
  }

  // ---- 잔액 ----

  /**
   * 잔액 = 원장 합계.
   *
   * 별도 컬럼을 두지 않는 이유: 원장과 어긋나는 순간이 생기고 어느 쪽이
   * 맞는지 알 수 없게 된다. 합계는 인덱스가 있어 충분히 빠르다.
   */
  async balanceOf(userId: string): Promise<number> {
    const r = await this.pool.query<{ bal: string }>(
      'SELECT COALESCE(SUM(delta), 0) AS bal FROM point_ledger WHERE user_id = $1',
      [userId],
    );
    return int(r.rows[0]?.bal);
  }

  /**
   * 원장 항목 추가 (트랜잭션 내부용).
   *
   * ★ 반드시 사용자 행을 잠근 상태에서 불러야 한다. 잠금 없이 부르면
   *   동시 요청이 같은 잔액을 보고 각각 차감해 잔액이 음수가 된다.
   */
  private async appendLocked(
    client: PoolClient,
    input: {
      userId: string; delta: number; reason: PointReason;
      refType?: string | null; refId?: string | null; memo?: string | null;
      actorId?: string | null;
    },
  ): Promise<LedgerEntry> {
    const cur = await client.query<{ bal: string }>(
      'SELECT COALESCE(SUM(delta), 0) AS bal FROM point_ledger WHERE user_id = $1',
      [input.userId],
    );
    const balance = int(cur.rows[0]?.bal);
    const after = balance + input.delta;
    if (after < 0) {
      // 애플리케이션 단계에서 먼저 막는다. DB CHECK 는 마지막 방어선이다.
      throw new Error('INSUFFICIENT_POINTS');
    }

    const id = randomUUID();
    await client.query(
      `INSERT INTO point_ledger
         (id, user_id, delta, balance_after, reason, ref_type, ref_id, memo, created_at, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now(), $9)`,
      [
        id, input.userId, input.delta, after, input.reason,
        input.refType ?? null, input.refId ?? null, input.memo ?? null, input.actorId ?? null,
      ],
    );
    const r = await client.query(`SELECT ${L_COLS} FROM point_ledger WHERE id = $1`, [id]);
    return mapEntry(r.rows[0]!);
  }

  /**
   * 사용자 단위 직렬화.
   *
   * 왜 users 행을 잠그는가
   * -------------------
   * 포인트 잔액은 원장 여러 행의 합계다. 합계를 잠글 수는 없으므로, 그 사용자를
   * 대표하는 행(users)을 잠가 같은 사용자에 대한 포인트 변경을 한 줄로 세운다.
   * 다른 사용자끼리는 서로 막지 않는다.
   */
  private async withUserLock<T>(userId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const u = await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
      if (!u.rowCount) throw new Error('USER_NOT_FOUND');
      const out = await fn(client);
      await client.query('COMMIT');
      return out;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  /**
   * 적립.
   *
   * 같은 근거(refType+refId)로 두 번 적립하면 null 을 돌려준다 — 예외가 아니다.
   * 중복 호출은 흔한 정상 상황이고(재시도·중복 이벤트), 예외로 만들면 호출자가
   * 매번 감싸야 한다.
   */
  async grant(input: {
    userId: string; amount: number; reason: PointReason;
    refType?: string | null; refId?: string | null; memo?: string | null;
    actorId?: string | null;
  }): Promise<LedgerEntry | null> {
    // int() 가 소수를 거부한다 — 조용히 버리면 사용자가 왜 줄었는지 알 수 없다.
    const amount = int(input.amount);
    if (amount <= 0) throw new Error('AMOUNT_MUST_BE_POSITIVE');
    try {
      return await this.withUserLock(input.userId, (c) =>
        this.appendLocked(c, { ...input, delta: amount }),
      );
    } catch (e) {
      if (isDuplicate(e)) return null;
      throw e;
    }
  }

  /**
   * 회수 (오적립 상쇄).
   *
   * 원래 항목을 지우지 않는다 — 반대 부호 항목을 넣는다. 그래야 잘못이
   * 있었다는 사실과 고쳤다는 사실이 모두 남는다.
   */
  async revoke(input: {
    userId: string; amount: number; memo?: string | null; actorId?: string | null;
    refType?: string | null; refId?: string | null;
  }): Promise<LedgerEntry> {
    const amount = int(input.amount);
    if (amount <= 0) throw new Error('AMOUNT_MUST_BE_POSITIVE');
    return this.withUserLock(input.userId, (c) =>
      this.appendLocked(c, {
        userId: input.userId,
        delta: -amount,
        reason: 'admin_revoke',
        refType: input.refType ?? null,
        refId: input.refId ?? null,
        memo: input.memo ?? null,
        actorId: input.actorId ?? null,
      }),
    );
  }

  /**
   * 사용량 기반 차감(AI 실행 등). 실행 1건(refType/refId)당 한 번만 반영(멱등).
   * 요청 금액이 잔액보다 크면 남은 잔액까지만 차감한다(음수 방지). 차감액과 잔액을 돌려준다.
   * 이미 차감된 실행(중복 웹훅/재시도)은 null.
   */
  async spendMetered(input: { userId: string; amount: number; refType: string; refId: string; memo?: string | null }): Promise<{ deducted: number; balanceAfter: number } | null> {
    const amount = int(input.amount);
    if (amount <= 0) return null;
    try {
      return await this.withUserLock(input.userId, async (c) => {
        const cur = await c.query<{ bal: string }>('SELECT COALESCE(SUM(delta), 0) AS bal FROM point_ledger WHERE user_id = $1', [input.userId]);
        const bal = int(cur.rows[0]?.bal);
        const spend = Math.min(amount, bal);
        if (spend <= 0) return { deducted: 0, balanceAfter: bal };
        const entry = await this.appendLocked(c, {
          userId: input.userId, delta: -spend, reason: 'redeem',
          refType: input.refType, refId: input.refId, memo: input.memo ?? null,
        });
        return { deducted: spend, balanceAfter: entry.balanceAfter };
      });
    } catch (e) {
      if (isDuplicate(e)) return null; // 같은 실행에 대한 중복 차감 방지(uq_points_ref)
      throw e;
    }
  }

  /** 내역. 최근 순. */
  async history(userId: string, limit = 100): Promise<LedgerEntry[]> {    const r = await this.pool.query(
      // seq 는 삽입 순서를 보장한다. created_at 은 같은 값이 나올 수 있어 순서가 흔들린다.
      `SELECT ${L_COLS} FROM point_ledger WHERE user_id = $1 ORDER BY seq DESC LIMIT $2`,
      [userId, Math.min(Math.max(limit, 1), 500)],
    );
    return r.rows.map(mapEntry);
  }

  /**
   * 전체 적립·사용 합계.
   *
   * ★ 화면 KPI 가 최근 100건(history)만 합산해 전체 적립/사용을 틀리게 보여줬다.
   *   원장 전체를 서버에서 집계해 정확한 값을 준다(내역 페이지네이션과 무관).
   */
  async userTotals(userId: string): Promise<{ earned: number; spent: number }> {
    const r = await this.pool.query(
      `SELECT
         COALESCE(SUM(CASE WHEN delta > 0 THEN delta ELSE 0 END), 0) AS earned,
         COALESCE(SUM(CASE WHEN delta < 0 THEN -delta ELSE 0 END), 0) AS spent
       FROM point_ledger WHERE user_id = $1`,
      [userId],
    );
    const row = r.rows[0] || {};
    return { earned: Number(row.earned) || 0, spent: Number(row.spent) || 0 };
  }

  async listCatalog(includeDisabled = false): Promise<CatalogItem[]> {
    const r = await this.pool.query(
      `SELECT ${C_COLS} FROM point_catalog
        ${includeDisabled ? '' : 'WHERE enabled = TRUE'}
        ORDER BY sort_order ASC, cost ASC`,
    );
    return r.rows.map(mapItem);
  }

  async upsertCatalog(item: {
    id: string; nameKey: string; descKey?: string | null; kind: CatalogKind;
    cost: number; grants: number; enabled: boolean; sortOrder?: number;
  }): Promise<CatalogItem> {
    await this.pool.query(
      `INSERT INTO point_catalog (id, name_key, desc_key, kind, cost, grants, enabled, sort_order, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())
       ON CONFLICT (id) DO UPDATE SET
         name_key = excluded.name_key, desc_key = excluded.desc_key, kind = excluded.kind,
         cost = excluded.cost, grants = excluded.grants, enabled = excluded.enabled,
         sort_order = excluded.sort_order, updated_at = now()`,
      [
        item.id, item.nameKey, item.descKey ?? null, item.kind,
        Math.trunc(item.cost), Math.trunc(item.grants), item.enabled, item.sortOrder ?? 0,
      ],
    );
    const r = await this.pool.query(`SELECT ${C_COLS} FROM point_catalog WHERE id = $1`, [item.id]);
    return mapItem(r.rows[0]!);
  }

  // ---- 사용 ----

  /**
   * 상품 사용 (차감 + 이용권 발급).
   *
   * ★ 잔액 확인과 차감을 **같은 잠금 안에서** 한다. 나누면 동시 요청 두 개가
   *   같은 잔액을 보고 각각 통과해 이중 사용이 된다.
   *
   * 잔액이 부족하면 INSUFFICIENT_POINTS 를 던진다 — 조용히 0 을 차감하거나
   * 부분 차감하지 않는다. 부분 차감은 사용자가 무엇을 받았는지 알 수 없게 만든다.
   */
  async redeem(userId: string, catalogId: string): Promise<{ entry: LedgerEntry; redemption: Redemption }> {
    return this.withUserLock(userId, async (c) => {
      const ci = await c.query(`SELECT ${C_COLS} FROM point_catalog WHERE id = $1`, [catalogId]);
      if (!ci.rowCount) throw new Error('ITEM_NOT_FOUND');
      const item = mapItem(ci.rows[0]!);
      if (!item.enabled) throw new Error('ITEM_DISABLED');

      const entry = await this.appendLocked(c, {
        userId,
        delta: -item.cost,
        reason: 'redeem',
        refType: 'catalog',
        /*
           ref 에 상품 ID 만 넣으면 UNIQUE 인덱스가 같은 상품의 재구매를 막는다.
           사용은 여러 번 할 수 있어야 하므로 고유값을 붙인다.
        */
        refId: `${catalogId}:${randomUUID()}`,
        memo: item.nameKey,
      });

      /*
         이용권.

         feature 는 기간제이므로 만료 시각을 둔다(grants = 일수).
         ai_run 은 횟수제이므로 remaining 에 횟수를 넣는다.
         competition 은 1회성이라 remaining=1 이고 만료가 없다.
      */
      const id = randomUUID();
      const isPeriod = item.kind === 'feature';
      await c.query(
        `INSERT INTO point_redemptions (id, user_id, catalog_id, ledger_id, cost, remaining, expires_at, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7, now())`,
        [
          id, userId, catalogId, entry.id, item.cost,
          isPeriod ? 1 : item.grants,
          isPeriod ? new Date(Date.now() + item.grants * 86400_000) : null,
        ],
      );
      const rr = await c.query(`SELECT ${R_COLS} FROM point_redemptions WHERE id = $1`, [id]);
      return { entry, redemption: mapRedemption(rr.rows[0]!) };
    });
  }

  /**
   * 이용권 1회 사용 (AI 실행 등).
   *
   * 가장 먼저 만료되는 것부터 쓴다 — 나중에 산 것을 먼저 쓰면 앞의 것이
   * 만료되어 사라진다(사용자 손해).
   * 남은 것이 없으면 false. 그때 호출자는 기능을 실행하지 않아야 한다.
   */
  async consume(userId: string, catalogId: string): Promise<boolean> {
    return this.withUserLock(userId, async (c) => {
      const r = await c.query<{ id: string }>(
        `SELECT id FROM point_redemptions
          WHERE user_id = $1 AND catalog_id = $2 AND remaining > 0
            AND (expires_at IS NULL OR expires_at > now())
          ORDER BY expires_at ASC NULLS LAST, created_at ASC, id ASC
          LIMIT 1
          FOR UPDATE`,
        [userId, catalogId],
      );
      if (!r.rowCount) return false;
      await c.query('UPDATE point_redemptions SET remaining = remaining - 1 WHERE id = $1', [r.rows[0]!.id]);
      return true;
    });
  }

  /** 사용 가능한 이용권 수. 만료된 것은 세지 않는다. */
  async entitlementsOf(userId: string): Promise<Record<string, number>> {
    const r = await this.pool.query<{ catalog_id: string; n: string }>(
      `SELECT catalog_id, COALESCE(SUM(remaining), 0) AS n
         FROM point_redemptions
        WHERE user_id = $1 AND remaining > 0 AND (expires_at IS NULL OR expires_at > now())
        GROUP BY catalog_id`,
      [userId],
    );
    const out: Record<string, number> = {};
    for (const x of r.rows) out[String(x.catalog_id)] = int(x.n);
    return out;
  }

  async listRedemptions(userId: string, limit = 50): Promise<Redemption[]> {
    const r = await this.pool.query(
      `SELECT ${R_COLS} FROM point_redemptions WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [userId, Math.min(Math.max(limit, 1), 200)],
    );
    return r.rows.map(mapRedemption);
  }

  // ---- 운영 집계 ----

  /**
   * 미사용 포인트 총액 = **부채**.
   *
   * 운영자가 반드시 봐야 하는 숫자다. 적립만 늘리고 이 값을 보지 않으면
   * 감당할 수 없는 의무가 쌓인다.
   */
  async totals(): Promise<{
    outstanding: number; holders: number;
    grantedTotal: number; redeemedTotal: number;
    byReason: Array<{ reason: string; total: number; entries: number }>;
  }> {
    const [bal, byReason] = await Promise.all([
      this.pool.query<{ outstanding: string; holders: string }>(
        `SELECT COALESCE(SUM(bal), 0) AS outstanding, COUNT(*) AS holders FROM (
           SELECT SUM(delta) AS bal FROM point_ledger GROUP BY user_id HAVING SUM(delta) > 0
         ) t`,
      ),
      this.pool.query<{ reason: string; total: string; entries: string }>(
        `SELECT reason, SUM(delta) AS total, COUNT(*) AS entries
           FROM point_ledger GROUP BY reason ORDER BY reason`,
      ),
    ]);
    const rows = byReason.rows.map((x) => ({
      reason: String(x.reason), total: int(x.total), entries: int(x.entries),
    }));
    return {
      outstanding: int(bal.rows[0]?.outstanding),
      holders: int(bal.rows[0]?.holders),
      // 적립 합계와 사용 합계를 분리해 보여준다 — 순액만 보면 규모를 알 수 없다.
      grantedTotal: rows.filter((x) => x.total > 0).reduce((a, x) => a + x.total, 0),
      redeemedTotal: Math.abs(rows.filter((x) => x.total < 0).reduce((a, x) => a + x.total, 0)),
      byReason: rows,
    };
  }

  /**
   * 원장 정합성 검사.
   *
   * balance_after 가 앞 항목 + delta 와 어긋나는 지점을 찾는다. 잠금이 제대로
   * 동작하면 하나도 없어야 한다 — 나오면 동시성 결함이 있다는 뜻이다.
   */
  async audit(limit = 20): Promise<Array<{ id: string; userId: string; expected: number; stored: number }>> {
    const r = await this.pool.query(
      `SELECT id, user_id, balance_after,
              SUM(delta) OVER (PARTITION BY user_id ORDER BY seq) AS running
         FROM point_ledger`,
    );
    const bad: Array<{ id: string; userId: string; expected: number; stored: number }> = [];
    for (const x of r.rows) {
      const expected = int(x.running);
      const stored = int(x.balance_after);
      if (expected !== stored) {
        bad.push({ id: String(x.id), userId: String(x.user_id), expected, stored });
        if (bad.length >= limit) break;
      }
    }
    return bad;
  }
}
