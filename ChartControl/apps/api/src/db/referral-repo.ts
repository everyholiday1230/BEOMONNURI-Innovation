/**
 * 친구 초대(리퍼럴) 저장소 (Postgres).
 *
 * 이 파일이 지키는 것
 * -----------------
 * 1. **제도가 꺼져 있으면 아무것도 만들지 않는다.** 코드도 귀속도 없다.
 *    조건을 정하기 전에 코드를 뿌리면 이미 초대된 건에 소급 적용 문제가 생긴다.
 *
 * 2. **적립액을 계산하지 않는다.** 우리 수익은 거래소가 산정한 리베이트이고
 *    그 금액은 거래소 대시보드에만 있다. 우리가 추정해서 보여주면 실제 지급액과
 *    어긋나 분쟁이 된다. 잔액은 **운영자가 입력한 지급 기록의 합계**뿐이다.
 *
 * 3. **자기 자신 초대와 중복 귀속을 막는다.** 둘 다 보상 이중 지급으로 이어진다.
 *
 * 4. **가입 시점에만 귀속한다.** 소급 귀속을 허용하면 검증할 근거가 없다.
 */

import { randomBytes, randomUUID } from 'node:crypto';

import type { Pool } from 'pg';

export interface ReferralSettings {
  enabled: boolean;
  sharePct: number;
  minPayout: number;
  payoutCurrency: string;
  payoutNote: string | null;
  version: number;
  updatedBy: string | null;
  updatedAt: number;
}

export interface ReferralCodeRow {
  code: string;
  userId: string;
  createdAt: number;
  disabled: boolean;
}

export interface ReferralSignupRow {
  id: string;
  code: string;
  referrerUserId: string | null;
  referredUserId: string;
  signedUpAt: number;
  emailVerifiedAt: number | null;
  keysConnectedAt: number | null;
  firstTradeAt: number | null;
  sharePctAtSignup: number;
  /** 초대받은 사람의 이메일. 목록 표시용. */
  referredEmail?: string | null;
}

export interface ReferralPayoutRow {
  id: string;
  referrerUserId: string;
  amount: number;
  currency: string;
  method: string;
  reference: string | null;
  periodStart: number | null;
  periodEnd: number | null;
  note: string | null;
  paidAt: number;
  recordedBy: string | null;
}

/** NUMERIC 은 node-postgres 가 문자열로 준다. 반드시 되돌린다. */
function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function ms(v: unknown): number | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  const t = d.getTime();
  return Number.isFinite(t) ? t : null;
}

/*
   코드 문자
   --------
   혼동하기 쉬운 글자를 뺀다: 0/O, 1/I/L. 사용자가 코드를 말로 전달하거나
   손으로 적는 경우가 있고, 한 글자만 틀리면 귀속이 안 된다.
*/
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;

function generateCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    out += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length];
  }
  return out;
}

/** 입력된 코드를 정규화. 소문자·공백·하이픈을 허용한다(사용자가 그렇게 적는다). */
export function normalizeCode(raw: string): string {
  return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

const S_COLS = `enabled, share_pct, min_payout, payout_currency, payout_note, version, updated_by, updated_at`;
const C_COLS = `code, user_id, created_at, disabled`;
const G_COLS = `id, code, referrer_user_id, referred_user_id, signed_up_at,
                email_verified_at, keys_connected_at, first_trade_at, share_pct_at_signup`;
const P_COLS = `id, referrer_user_id, amount, currency, method, reference,
                period_start, period_end, note, paid_at, recorded_by`;

export class PgReferralRepo {
  constructor(private readonly pool: Pool) {}

  // ---- 제도 조건 ----

  /**
   * 현재 조건. 행이 없으면 **꺼진 상태**를 돌려준다.
   *
   * null 을 돌려주지 않는 이유: 호출자가 null 검사를 잊으면 예외가 나거나
   * 조건이 있는 것처럼 진행된다. "꺼짐" 이라는 명확한 상태를 준다.
   */
  async getSettings(): Promise<ReferralSettings> {
    const r = await this.pool.query(`SELECT ${S_COLS} FROM referral_settings WHERE id = 'default'`);
    if (!r.rowCount) {
      return {
        enabled: false, sharePct: 0, minPayout: 0, payoutCurrency: 'USDT',
        payoutNote: null, version: 0, updatedBy: null, updatedAt: 0,
      };
    }
    const x = r.rows[0]!;
    return {
      enabled: Boolean(x.enabled),
      sharePct: num(x.share_pct),
      minPayout: num(x.min_payout),
      payoutCurrency: String(x.payout_currency),
      payoutNote: x.payout_note === null ? null : String(x.payout_note),
      version: num(x.version),
      updatedBy: x.updated_by === null ? null : String(x.updated_by),
      updatedAt: ms(x.updated_at) ?? 0,
    };
  }

  /**
   * 조건 변경.
   *
   * ★ 제도를 켤 때 payoutNote 를 요구한다. 지급 방법을 밝히지 않고 제도를
   *   켜면 사용자는 자동 지급을 기대한다 — 우리는 자동 지급을 할 수 없다.
   *   그 검증은 라우트가 한다(여기서는 저장만 한다).
   */
  async updateSettings(input: {
    enabled: boolean;
    sharePct: number;
    minPayout: number;
    payoutCurrency: string;
    payoutNote: string | null;
  }, actorId: string | null): Promise<ReferralSettings> {
    await this.pool.query(
      `INSERT INTO referral_settings (id, enabled, share_pct, min_payout, payout_currency, payout_note, version, updated_by, updated_at)
       VALUES ('default', $1, $2, $3, $4, $5, 1, $6, now())
       ON CONFLICT (id) DO UPDATE SET
         enabled = excluded.enabled,
         share_pct = excluded.share_pct,
         min_payout = excluded.min_payout,
         payout_currency = excluded.payout_currency,
         payout_note = excluded.payout_note,
         -- 변경 횟수를 센다. 조건이 몇 번 바뀌었는지가 분쟁의 근거가 된다.
         version = referral_settings.version + 1,
         updated_by = excluded.updated_by,
         updated_at = now()`,
      [input.enabled, input.sharePct, input.minPayout, input.payoutCurrency, input.payoutNote, actorId],
    );
    return this.getSettings();
  }

  // ---- 코드 ----

  /** 이 사용자의 코드. 없으면 null (발급하지 않는다). */
  async findCodeByUser(userId: string): Promise<ReferralCodeRow | null> {
    const r = await this.pool.query(`SELECT ${C_COLS} FROM referral_codes WHERE user_id = $1`, [userId]);
    if (!r.rowCount) return null;
    const x = r.rows[0]!;
    return { code: String(x.code), userId: String(x.user_id), createdAt: ms(x.created_at) ?? 0, disabled: Boolean(x.disabled) };
  }

  async findCode(code: string): Promise<ReferralCodeRow | null> {
    const norm = normalizeCode(code);
    if (!norm) return null;
    const r = await this.pool.query(`SELECT ${C_COLS} FROM referral_codes WHERE code = $1`, [norm]);
    if (!r.rowCount) return null;
    const x = r.rows[0]!;
    return { code: String(x.code), userId: String(x.user_id), createdAt: ms(x.created_at) ?? 0, disabled: Boolean(x.disabled) };
  }

  /**
   * 코드 발급 (멱등).
   *
   * ★ 제도가 꺼져 있으면 발급하지 않고 null 을 돌려준다.
   *   코드를 먼저 뿌리면 조건 없이 초대가 일어난다.
   *
   * 충돌은 재시도한다 — 8자 31진이라 충돌 확률은 낮지만 0 이 아니고,
   * 충돌 시 예외를 그대로 던지면 사용자가 코드를 못 받는다.
   */
  async issueCode(userId: string): Promise<ReferralCodeRow | null> {
    const settings = await this.getSettings();
    if (!settings.enabled) return null;

    const existing = await this.findCodeByUser(userId);
    if (existing) return existing;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = generateCode();
      const r = await this.pool.query(
        `INSERT INTO referral_codes (code, user_id, created_at)
         VALUES ($1, $2, now())
         ON CONFLICT (code) DO NOTHING
         RETURNING ${C_COLS}`,
        [code, userId],
      );
      if (r.rowCount) {
        const x = r.rows[0]!;
        return { code: String(x.code), userId: String(x.user_id), createdAt: ms(x.created_at) ?? 0, disabled: false };
      }
      /*
         코드 충돌이거나, 그 사이 다른 요청이 이 사용자의 코드를 만들었다.
         후자를 먼저 확인한다 — 그렇다면 재시도할 필요가 없다.
      */
      const now = await this.findCodeByUser(userId);
      if (now) return now;
    }
    return null;
  }

  // ---- 귀속 ----

  /**
   * 가입 귀속.
   *
   * 막는 것
   * ------
   * · 제도가 꺼져 있으면 귀속하지 않는다.
   * · 없거나 비활성인 코드는 무시한다.
   * · **자기 자신 초대**를 막는다.
   * · 이미 귀속된 사용자는 다시 귀속하지 않는다(중복 보상 방지).
   *
   * 실패를 예외로 던지지 않는다 — 회원가입이 리퍼럴 때문에 실패하면 안 된다.
   * 귀속되지 않았음을 false 로 알린다.
   */
  async attribute(rawCode: string, referredUserId: string): Promise<boolean> {
    const settings = await this.getSettings();
    if (!settings.enabled) return false;

    const code = await this.findCode(rawCode);
    if (!code || code.disabled) return false;
    // 자기 코드로 가입할 수 없다.
    if (code.userId === referredUserId) return false;

    const r = await this.pool.query(
      `INSERT INTO referral_signups
         (id, code, referrer_user_id, referred_user_id, signed_up_at, share_pct_at_signup)
       VALUES ($1, $2, $3, $4, now(), $5)
       ON CONFLICT (referred_user_id) DO NOTHING`,
      [randomUUID(), code.code, code.userId, referredUserId, settings.sharePct],
    );
    return (r.rowCount ?? 0) > 0;
  }

  /**
   * 단계 도달 기록.
   *
   * 이미 시각이 있으면 덮지 않는다(COALESCE) — 최초 도달 시각이 근거다.
   * 두 번째 거래로 first_trade_at 이 밀리면 언제부터 수익이 발생했는지 알 수 없다.
   */
  async markMilestone(
    referredUserId: string,
    milestone: 'email_verified' | 'keys_connected' | 'first_trade',
  ): Promise<boolean> {
    const col = milestone === 'email_verified' ? 'email_verified_at'
      : milestone === 'keys_connected' ? 'keys_connected_at' : 'first_trade_at';
    const r = await this.pool.query(
      `UPDATE referral_signups SET ${col} = COALESCE(${col}, now()) WHERE referred_user_id = $1`,
      [referredUserId],
    );
    return (r.rowCount ?? 0) > 0;
  }

  /** 내가 초대한 사람들. 이메일을 함께 준다(목록 표시용). */
  async listByReferrer(referrerUserId: string, limit = 100): Promise<ReferralSignupRow[]> {
    const r = await this.pool.query(
      `SELECT ${G_COLS.split(',').map((c) => 's.' + c.trim()).join(', ')}, u.email AS referred_email
         FROM referral_signups s
         LEFT JOIN users u ON u.id = s.referred_user_id
        WHERE s.referrer_user_id = $1
        ORDER BY s.signed_up_at DESC
        LIMIT $2`,
      [referrerUserId, Math.min(Math.max(limit, 1), 500)],
    );
    return r.rows.map((x) => ({
      id: String(x.id),
      code: String(x.code),
      referrerUserId: x.referrer_user_id === null ? null : String(x.referrer_user_id),
      referredUserId: String(x.referred_user_id),
      signedUpAt: ms(x.signed_up_at) ?? 0,
      emailVerifiedAt: ms(x.email_verified_at),
      keysConnectedAt: ms(x.keys_connected_at),
      firstTradeAt: ms(x.first_trade_at),
      sharePctAtSignup: num(x.share_pct_at_signup),
      referredEmail: x.referred_email === null || x.referred_email === undefined ? null : String(x.referred_email),
    }));
  }

  /**
   * 초대자별 요약 (관리자 목록).
   *
   * 지급액 합계를 함께 낸다 — 운영자가 "누구에게 얼마를 보냈는지" 를 한눈에
   * 봐야 다음 지급을 판단할 수 있다.
   */
  async listReferrers(limit = 100): Promise<Array<{
    userId: string; email: string | null; code: string | null;
    signups: number; keysConnected: number; traded: number;
    paidTotal: number; currency: string | null;
  }>> {
    const r = await this.pool.query(
      `SELECT c.user_id, u.email, c.code,
              COUNT(s.id) AS signups,
              COUNT(s.keys_connected_at) AS keys_connected,
              COUNT(s.first_trade_at) AS traded,
              COALESCE((SELECT SUM(p.amount) FROM referral_payouts p WHERE p.referrer_user_id = c.user_id), 0) AS paid_total,
              (SELECT p.currency FROM referral_payouts p WHERE p.referrer_user_id = c.user_id ORDER BY p.paid_at DESC LIMIT 1) AS currency
         FROM referral_codes c
         LEFT JOIN users u ON u.id = c.user_id
         LEFT JOIN referral_signups s ON s.referrer_user_id = c.user_id
        GROUP BY c.user_id, u.email, c.code
        ORDER BY COUNT(s.id) DESC, u.email ASC
        LIMIT $1`,
      [Math.min(Math.max(limit, 1), 500)],
    );
    return r.rows.map((x) => ({
      userId: String(x.user_id),
      email: x.email === null ? null : String(x.email),
      code: x.code === null ? null : String(x.code),
      signups: num(x.signups),
      keysConnected: num(x.keys_connected),
      traded: num(x.traded),
      paidTotal: num(x.paid_total),
      currency: x.currency === null ? null : String(x.currency),
    }));
  }

  // ---- 지급 ----

  /** 지급 기록. 운영자가 실제로 보낸 것만 입력한다. */
  async recordPayout(input: {
    referrerUserId: string;
    amount: number;
    currency: string;
    method: string;
    reference?: string | null;
    periodStart?: number | null;
    periodEnd?: number | null;
    note?: string | null;
  }, actorId: string | null): Promise<ReferralPayoutRow> {
    const id = randomUUID();
    const toDate = (v: number | null | undefined) => {
      if (v === null || v === undefined) return null;
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? new Date(n) : null;
    };
    await this.pool.query(
      `INSERT INTO referral_payouts
         (id, referrer_user_id, amount, currency, method, reference, period_start, period_end, note, paid_at, recorded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now(), $10)`,
      [
        id, input.referrerUserId, input.amount, input.currency, input.method,
        input.reference ?? null, toDate(input.periodStart), toDate(input.periodEnd),
        input.note ?? null, actorId,
      ],
    );
    const r = await this.pool.query(`SELECT ${P_COLS} FROM referral_payouts WHERE id = $1`, [id]);
    const x = r.rows[0]!;
    return {
      id: String(x.id),
      referrerUserId: String(x.referrer_user_id),
      amount: num(x.amount),
      currency: String(x.currency),
      method: String(x.method),
      reference: x.reference === null ? null : String(x.reference),
      periodStart: ms(x.period_start),
      periodEnd: ms(x.period_end),
      note: x.note === null ? null : String(x.note),
      paidAt: ms(x.paid_at) ?? 0,
      recordedBy: x.recorded_by === null ? null : String(x.recorded_by),
    };
  }

  async listPayouts(referrerUserId: string, limit = 50): Promise<ReferralPayoutRow[]> {
    const r = await this.pool.query(
      `SELECT ${P_COLS} FROM referral_payouts WHERE referrer_user_id = $1 ORDER BY paid_at DESC LIMIT $2`,
      [referrerUserId, Math.min(Math.max(limit, 1), 200)],
    );
    return r.rows.map((x) => ({
      id: String(x.id),
      referrerUserId: String(x.referrer_user_id),
      amount: num(x.amount),
      currency: String(x.currency),
      method: String(x.method),
      reference: x.reference === null ? null : String(x.reference),
      periodStart: ms(x.period_start),
      periodEnd: ms(x.period_end),
      note: x.note === null ? null : String(x.note),
      paidAt: ms(x.paid_at) ?? 0,
      recordedBy: x.recorded_by === null ? null : String(x.recorded_by),
    }));
  }

  /**
   * 내 요약.
   *
   * ★ '적립 예정액' 을 계산하지 않는다.
   *   우리 수익은 거래소가 산정하고 우리 DB 에 없다. 추정치를 보여주면
   *   실제 지급액과 어긋나 분쟁이 된다. 단계별 인원과 **실제 지급 합계**만 준다.
   */
  async summaryFor(userId: string): Promise<{
    signups: number; emailVerified: number; keysConnected: number; traded: number;
    paidTotal: number; payoutCount: number; lastPaidAt: number | null;
  }> {
    const [sg, py] = await Promise.all([
      this.pool.query(
        `SELECT COUNT(*) AS n,
                COUNT(email_verified_at) AS ev,
                COUNT(keys_connected_at) AS kc,
                COUNT(first_trade_at) AS ft
           FROM referral_signups WHERE referrer_user_id = $1`,
        [userId],
      ),
      this.pool.query(
        `SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS n, MAX(paid_at) AS last_at
           FROM referral_payouts WHERE referrer_user_id = $1`,
        [userId],
      ),
    ]);
    const a = sg.rows[0]!;
    const b = py.rows[0]!;
    return {
      signups: num(a.n),
      emailVerified: num(a.ev),
      keysConnected: num(a.kc),
      traded: num(a.ft),
      paidTotal: num(b.total),
      payoutCount: num(b.n),
      lastPaidAt: ms(b.last_at),
    };
  }
}
