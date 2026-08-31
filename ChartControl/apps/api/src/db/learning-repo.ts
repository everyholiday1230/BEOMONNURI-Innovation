import { randomBytes, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

/**
 * 거래 학습 데이터셋 저장소.
 *
 * 무엇을 위한 것인가
 * ----------------
 * "누가 어떤 지표를 켜고, 어떤 상황에서, 어떻게 매매했고, 결과가 어땠는가" 를
 * 빠짐없이 남긴다. 나중에 이 기록으로 모델을 학습시킨다(초기에는 Bedrock).
 *
 * 불변식
 * -----
 * 1. **모든 시도를 남긴다.** 거부·차단·타임아웃도 기록한다. 성공한 주문만 남기면
 *    "무엇을 하면 안 되는가" 를 배울 수 없고, 위험 게이트가 실제로 무엇을 막았는지도
 *    사후에 확인할 수 없다.
 *
 * 2. **기록 실패가 주문을 막지 않는다.** 학습 데이터는 부수적 목적이고 주문은
 *    본래 목적이다. 여기서 예외를 던지면 DB 문제로 **주문이 나가지 않는다.**
 *    그래서 모든 쓰기는 실패를 삼키고 감사기록만 남긴다.
 *
 *    ★ 반대로, 조용히 실패하면 "데이터가 모이고 있다" 고 믿는 동안 비어 있을 수
 *      있다. 그래서 실패 횟수를 세어 노출한다(`stats()`).
 *
 * 3. **없는 값은 NULL 이다.** 지표 목록을 화면이 보내지 않았으면 비운다.
 *    기본값을 넣으면 없던 사실이 데이터에 생기고, 그 데이터로 학습한 모델은
 *    존재하지 않았던 근거를 배운다.
 *
 * 4. **시세는 서버 값만 쓴다.** 화면이 보낸 가격을 그대로 저장하면 조작된
 *    요청으로 학습 데이터를 오염시킬 수 있다.
 *
 * 5. **개인은 가명으로만 남긴다.** 내보내기에는 user_id·이메일이 들어가지 않는다.
 */

export type ExecutionMode = 'live' | 'paper';
export type MarketKind = 'futures' | 'spot';

/** 화면이 보내는 판단 문맥. 전부 선택 항목이다 — 없으면 없는 것이다. */
export interface UiContext {
  /** 그때 보고 있던 주기. */
  timeframe?: string;
  /** 켜져 있던 지표. `{id, params}` 형태를 그대로 받는다. */
  indicators?: Array<{ id: string; params?: Record<string, unknown> }>;
  /** 그려 둔 도형 개수(내용은 담지 않는다 — 메모에 개인정보가 있을 수 있다). */
  drawings?: number;
  /** 레이아웃 프리셋 id. */
  preset?: string;
  chartType?: string;
  /** 주문을 어디서 냈는가: 'order-panel' | 'chart-hotkey' | 'copilot' | 'positions' */
  source?: string;
}

export interface DecisionInput {
  userId: string;
  market: MarketKind;
  executionMode: ExecutionMode;
  symbol: string;
  side: string;
  orderType: string;
  price?: string | number | null;
  quantity: string | number;
  leverage?: string | number | null;
  marginMode?: string | null;
  reduceOnly?: boolean;
  stopPrice?: string | number | null;
  takeProfitPrice?: string | number | null;
  /**
   * 브래킷 손절가 — "이 가격에 닿으면 닫는다".
   *
   * ★ stopPrice(조건부 **진입**가)와 뜻이 정반대다. 섞으면 학습 문장이
   *   반대로 만들어진다. 그래서 칼럼도 따로 쓴다(0039).
   */
  stopLossPrice?: string | number | null;
  uiContext?: UiContext | null;
  marketSnapshot?: Record<string, unknown> | null;
  accountSnapshot?: Record<string, unknown> | null;
  riskSnapshot?: Record<string, unknown> | null;
  submitStatus: 'ACCEPTED' | 'REJECTED' | 'SUBMIT_UNKNOWN' | 'BLOCKED';
  submitReason?: string | null;
  clientOrderId?: string | null;
  exchangeOrderId?: string | null;
  correlationId?: string | null;
}

export interface OutcomeInput {
  decisionId?: string | null;
  userId: string;
  market: MarketKind;
  executionMode: ExecutionMode;
  symbol: string;
  side: string;
  outcomeKind: 'filled' | 'partial' | 'canceled' | 'expired' | 'closed' | 'liquidated';
  entryPrice?: string | number | null;
  exitPrice?: string | number | null;
  filledQuantity?: string | number | null;
  fees?: string | number | null;
  realizedPnl?: string | number | null;
  roiPct?: string | number | null;
  holdingSeconds?: number | null;
  closeReason?: 'take_profit' | 'stop_loss' | 'manual' | 'liquidation' | 'unknown';
  exitSnapshot?: Record<string, unknown> | null;
  observedFrom: 'exchange_order' | 'position_diff' | 'sim';
}

/** 숫자 칸. 빈 문자열·NaN 은 NULL 로 — 0 으로 바꾸지 않는다. */
const num = (v: unknown): string | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? String(v) : null;
};

const json = (v: unknown): string | null =>
  v === null || v === undefined ? null : JSON.stringify(v);

export class PgLearningRepo {
  /** 쓰기 실패 횟수. 조용한 유실을 알아채기 위해 센다. */
  private failures = 0;

  private lastFailure: string | null = null;

  /**
   * 가명 키 메모 캐시.
   *
   * ★ 주문 경로에서 매번 조회하면 왕복이 하나 늘어난다. 가명 키는 바뀌지
   *   않으므로 캐시해도 안전하다.
   */
  private subjectCache = new Map<string, string>();

  constructor(
    private readonly pool: Pool,
    private readonly audit?: (event: string, detail: Record<string, unknown>) => void,
  ) {}

  /**
   * 이용자의 가명 키를 얻는다(없으면 만든다).
   *
   * ★★ user_id 의 해시로 만들지 않는다.
   *
   *   해시는 후보군이 좁으면 되돌릴 수 있다. 우리 이용자 목록은 우리가 가지고
   *   있으므로, 모든 user_id 를 해시해 맞춰 보면 가명이 즉시 풀린다. 그러면
   *   가명으로 만든 의미가 없다. 무작위 값을 쓰고 매핑을 표에 둔다.
   */
  async subjectKey(userId: string): Promise<string> {
    const cached = this.subjectCache.get(userId);
    if (cached) return cached;

    const found = await this.pool.query(
      'SELECT subject_key FROM learning_subjects WHERE user_id = $1',
      [userId],
    );
    if (found.rows[0]) {
      const key = found.rows[0].subject_key as string;
      this.subjectCache.set(userId, key);
      return key;
    }

    const key = `s_${randomBytes(12).toString('hex')}`;
    /*
       ON CONFLICT — 같은 이용자가 동시에 두 주문을 내면 두 번 만들 수 있다.
       그때 먼저 들어간 값을 쓴다(가명이 두 개면 한 사람이 두 명으로 학습된다).
    */
    const ins = await this.pool.query(
      `INSERT INTO learning_subjects (subject_key, user_id) VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id
       RETURNING subject_key`,
      [key, userId],
    );
    const finalKey = (ins.rows[0]?.subject_key as string) ?? key;
    this.subjectCache.set(userId, finalKey);
    return finalKey;
  }

  /**
   * 판단을 기록한다. 기록한 행의 id 를 돌려준다(결과를 나중에 붙이기 위해).
   *
   * ★ 실패해도 예외를 던지지 않는다 — 주문 경로에서 부르기 때문이다.
   *   실패하면 null 이고, 결과 기록은 판단 없이 남는다.
   */
  async recordDecision(input: DecisionInput): Promise<string | null> {
    try {
      const subject = await this.subjectKey(input.userId);
      const id = `dec_${randomUUID()}`;
      await this.pool.query(
        `INSERT INTO trade_decisions (
           id, user_id, subject_key, market, execution_mode, symbol, side, order_type,
           price, quantity, leverage, margin_mode, reduce_only, stop_price, take_profit_price,
           stop_loss_price,
           ui_context, market_snapshot, account_snapshot, risk_snapshot,
           submit_status, submit_reason, client_order_id, exchange_order_id, correlation_id
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,
           $9,$10,$11,$12,$13,$14,$15,
           $16,
           $17,$18,$19,$20,
           $21,$22,$23,$24,$25
         )`,
        [
          id, input.userId, subject, input.market, input.executionMode,
          input.symbol, input.side, input.orderType,
          num(input.price), num(input.quantity), num(input.leverage),
          input.marginMode ?? null, input.reduceOnly === true,
          num(input.stopPrice), num(input.takeProfitPrice),
          /*
             ★ 브래킷 손절가는 stop_price 와 **다른 칼럼**이다.
               stop_price 는 "이 가격에 진입한다"(조건부 진입), 이쪽은 "이 가격에
               닫는다"(보호). 한 칼럼에 넣으면 학습 문장이 정반대로 만들어진다.
          */
          num(input.stopLossPrice),
          json(input.uiContext), json(input.marketSnapshot),
          json(input.accountSnapshot), json(input.riskSnapshot),
          input.submitStatus, input.submitReason ?? null,
          input.clientOrderId ?? null, input.exchangeOrderId ?? null,
          input.correlationId ?? null,
        ],
      );
      return id;
    } catch (e) {
      this.noteFailure('decision', e);
      return null;
    }
  }

  /** 결과를 기록한다. */
  async recordOutcome(input: OutcomeInput): Promise<string | null> {
    try {
      const subject = await this.subjectKey(input.userId);
      const id = `out_${randomUUID()}`;
      await this.pool.query(
        `INSERT INTO trade_outcomes (
           id, decision_id, user_id, subject_key, market, execution_mode, symbol, side,
           outcome_kind, entry_price, exit_price, filled_quantity, fees,
           realized_pnl, roi_pct, holding_seconds, close_reason, exit_snapshot, observed_from
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
         /*
            ★★ 같은 판단·같은 종류의 결과를 두 번 넣지 않는다.

              결과는 조회할 때마다 수집한다. 이용자가 주문 내역을 열 때마다
              거래소가 같은 체결을 돌려주므로, 막지 않으면 같은 거래가 표본
              10번·100번이 되고 학습에서 **그만큼 가중치를 갖는다.** 자주 화면을
              여는 이용자의 거래가 모델을 지배한다.

            ★ 0026 의 부분 유일 인덱스와 짝이다. 애플리케이션 검사만으로는
              동시 요청에서 새는데, 결과 수집은 여러 화면이 동시에 부른다.
         */
         ON CONFLICT (decision_id, outcome_kind) WHERE decision_id IS NOT NULL DO NOTHING`,
        [
          id, input.decisionId ?? null, input.userId, subject,
          input.market, input.executionMode, input.symbol, input.side,
          input.outcomeKind, num(input.entryPrice), num(input.exitPrice),
          num(input.filledQuantity), num(input.fees), num(input.realizedPnl),
          num(input.roiPct),
          input.holdingSeconds === null || input.holdingSeconds === undefined
            ? null
            : Math.trunc(input.holdingSeconds),
          /*
             ★ 모르면 'unknown'. 추측해서 'stop_loss' 로 적으면 모델이
               "손절이 잘 작동한다" 는 없던 사실을 배운다.
          */
          input.closeReason ?? 'unknown',
          json(input.exitSnapshot), input.observedFrom,
        ],
      );
      return id;
    } catch (e) {
      this.noteFailure('outcome', e);
      return null;
    }
  }

  /**
   * clientOrderId 로 판단 행을 찾는다 — 결과를 붙일 때 쓴다.
   *
   * ★ 같은 clientOrderId 가 여러 번 있을 수 없다(멱등성 키). 그래도 최신 하나만
   *   쓴다 — 여러 개면 데이터가 이미 어긋난 것이고, 임의로 고르면 손익이 엉뚱한
   *   판단에 붙는다.
   */
  async findDecisionByClientOrderId(clientOrderId: string): Promise<
    { id: string; userId: string | null; market: string; executionMode: string } | null
  > {
    try {
      const r = await this.pool.query(
        `SELECT id, user_id, market, execution_mode FROM trade_decisions
          WHERE client_order_id = $1 ORDER BY decided_at DESC LIMIT 1`,
        [clientOrderId],
      );
      const row = r.rows[0];
      if (!row) return null;
      return {
        id: row.id as string,
        userId: (row.user_id as string | null) ?? null,
        market: row.market as string,
        executionMode: row.execution_mode as string,
      };
    } catch (e) {
      this.noteFailure('lookup', e);
      return null;
    }
  }

  /**
   * 결과를 이을 최근 판단들을 읽는다.
   *
   * ★ 접수된 것만 가져온다 — 차단·거부된 주문에는 체결이 있을 수 없다.
   * ★ 기간을 제한한다. 전체를 읽으면 화면을 열 때마다 표 전체를 훑는다.
   */
  async recentDecisionsForOutcome(userId: string, sinceMs: number): Promise<Array<{
    id: string;
    clientOrderId: string | null;
    symbol: string;
    side: string;
    market: 'futures' | 'spot';
    executionMode: ExecutionMode;
    decidedAt: number;
  }>> {
    try {
      const r = await this.pool.query(
        `SELECT id, client_order_id, symbol, side, market, execution_mode, decided_at
           FROM trade_decisions
          WHERE user_id = $1
            AND submit_status = 'ACCEPTED'
            AND decided_at >= to_timestamp($2 / 1000.0)
          ORDER BY decided_at DESC
          LIMIT 500`,
        [userId, sinceMs],
      );
      return r.rows.map((row) => ({
        id: row.id as string,
        clientOrderId: (row.client_order_id as string | null) ?? null,
        symbol: row.symbol as string,
        side: row.side as string,
        market: ((row.market as string) === 'spot' ? 'spot' : 'futures') as 'futures' | 'spot',
        executionMode: ((row.execution_mode as string) === 'paper' ? 'paper' : 'live') as ExecutionMode,
        decidedAt: (row.decided_at as Date).getTime(),
      }));
    } catch (e) {
      this.noteFailure('recent_decisions', e);
      return [];
    }
  }

  /**
   * 이미 기록된 결과 키(`decisionId:kind`)를 읽는다.
   *
   * ★ 중복 삽입은 DB 제약이 막지만, 미리 걸러 두면 쓸데없는 왕복이 줄고
   *   "무엇이 새로 붙었는지" 를 셀 수 있다.
   */
  async existingOutcomeKeys(decisionIds: readonly string[]): Promise<Set<string>> {
    if (decisionIds.length === 0) return new Set();
    try {
      const r = await this.pool.query(
        'SELECT decision_id, outcome_kind FROM trade_outcomes WHERE decision_id = ANY($1::text[])',
        [decisionIds],
      );
      return new Set(r.rows.map((row) => `${row.decision_id as string}:${row.outcome_kind as string}`));
    } catch (e) {
      this.noteFailure('existing_outcomes', e);
      /*
         ★ 실패하면 **빈 집합**을 준다. 전부 새로운 것으로 보고 삽입을 시도하는데,
           DB 유일 제약이 중복을 막는다 — 안전한 방향의 실패다.
      */
      return new Set();
    }
  }

  /**
   * 학습용 표본을 읽는다.
   *
   * ★★ user_id 를 선택하지 않는다. SELECT 목록에 없으면 실수로 내보낼 수 없다.
   */
  async exportSamples(opts: {
    from: Date;
    to: Date;
    limit: number;
    /** 'live' 만, 'paper' 만, 또는 둘 다(undefined). */
    executionMode?: ExecutionMode;
  }): Promise<LearningSample[]> {
    const params: unknown[] = [opts.from.toISOString(), opts.to.toISOString()];
    let modeClause = '';
    if (opts.executionMode) {
      params.push(opts.executionMode);
      modeClause = ` AND d.execution_mode = $${params.length}`;
    }
    params.push(Math.max(1, Math.min(opts.limit, 50_000)));

    const r = await this.pool.query(
      `SELECT
         d.id, d.subject_key, d.market, d.execution_mode, d.symbol, d.side,
         d.order_type, d.price, d.quantity, d.leverage, d.margin_mode, d.reduce_only,
         d.stop_price, d.take_profit_price, d.stop_loss_price,
         d.ui_context, d.market_snapshot, d.account_snapshot, d.risk_snapshot,
         d.submit_status, d.submit_reason, d.decided_at,
         o.outcome_kind, o.entry_price, o.exit_price, o.filled_quantity, o.fees,
         o.realized_pnl, o.roi_pct, o.holding_seconds, o.close_reason, o.observed_at
       FROM trade_decisions d
       LEFT JOIN trade_outcomes o ON o.decision_id = d.id
       WHERE d.decided_at >= $1 AND d.decided_at < $2${modeClause}
       ORDER BY d.decided_at ASC
       LIMIT $${params.length}`,
      params,
    );

    return r.rows.map((row) => ({
      decisionId: row.id as string,
      subject: row.subject_key as string,
      market: row.market as string,
      executionMode: row.execution_mode as string,
      symbol: row.symbol as string,
      side: row.side as string,
      orderType: row.order_type as string,
      price: row.price === null ? null : String(row.price),
      quantity: String(row.quantity),
      leverage: row.leverage === null ? null : String(row.leverage),
      marginMode: (row.margin_mode as string | null) ?? null,
      reduceOnly: row.reduce_only === true,
      stopPrice: row.stop_price === null ? null : String(row.stop_price),
      takeProfitPrice: row.take_profit_price === null ? null : String(row.take_profit_price),
      stopLossPrice: row.stop_loss_price === null || row.stop_loss_price === undefined ? null : String(row.stop_loss_price),
      uiContext: (row.ui_context as UiContext | null) ?? null,
      marketSnapshot: (row.market_snapshot as Record<string, unknown> | null) ?? null,
      accountSnapshot: (row.account_snapshot as Record<string, unknown> | null) ?? null,
      riskSnapshot: (row.risk_snapshot as Record<string, unknown> | null) ?? null,
      submitStatus: row.submit_status as string,
      submitReason: (row.submit_reason as string | null) ?? null,
      decidedAt: (row.decided_at as Date).toISOString(),
      outcome: row.outcome_kind
        ? {
          kind: row.outcome_kind as string,
          entryPrice: row.entry_price === null ? null : String(row.entry_price),
          exitPrice: row.exit_price === null ? null : String(row.exit_price),
          filledQuantity: row.filled_quantity === null ? null : String(row.filled_quantity),
          fees: row.fees === null ? null : String(row.fees),
          realizedPnl: row.realized_pnl === null ? null : String(row.realized_pnl),
          roiPct: row.roi_pct === null ? null : String(row.roi_pct),
          holdingSeconds: row.holding_seconds === null ? null : Number(row.holding_seconds),
          closeReason: row.close_reason as string,
          observedAt: row.observed_at ? (row.observed_at as Date).toISOString() : null,
        }
        /*
           ★ 결과가 아직 없는 표본은 `null` 이다. "손익 0" 으로 채우지 않는다 —
             미청산과 무손익은 완전히 다른 사실이고, 섞으면 모델이 "대부분의
             거래는 손익이 0" 이라고 배운다.
        */
        : null,
    }));
  }

  /** 내보내기 이력을 남긴다. */
  async recordExport(input: {
    actorUserId: string | null;
    from: Date;
    to: Date;
    sampleCount: number;
    format: string;
    contentSha256?: string | null;
  }): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO learning_exports (id, actor_user_id, from_at, to_at, sample_count, format, content_sha256)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          `exp_${randomUUID()}`, input.actorUserId,
          input.from.toISOString(), input.to.toISOString(),
          input.sampleCount, input.format, input.contentSha256 ?? null,
        ],
      );
    } catch (e) {
      this.noteFailure('export_log', e);
    }
  }

  /**
   * 수집 현황.
   *
   * ★ 운영자가 "모이고 있는가" 를 확인할 유일한 창구다. 조용한 실패를
   *   알아채기 위해 실패 횟수를 함께 준다.
   */
  async stats(): Promise<{
    decisions: number;
    outcomes: number;
    subjects: number;
    linkedOutcomes: number;
    oldestAt: string | null;
    newestAt: string | null;
    writeFailures: number;
    lastFailure: string | null;
  }> {
    const r = await this.pool.query(
      `SELECT
         (SELECT COUNT(*) FROM trade_decisions) AS decisions,
         (SELECT COUNT(*) FROM trade_outcomes) AS outcomes,
         (SELECT COUNT(*) FROM learning_subjects) AS subjects,
         (SELECT COUNT(*) FROM trade_outcomes WHERE decision_id IS NOT NULL) AS linked,
         (SELECT MIN(decided_at) FROM trade_decisions) AS oldest,
         (SELECT MAX(decided_at) FROM trade_decisions) AS newest`,
    );
    const row = r.rows[0] ?? {};
    return {
      decisions: Number(row.decisions ?? 0),
      outcomes: Number(row.outcomes ?? 0),
      subjects: Number(row.subjects ?? 0),
      linkedOutcomes: Number(row.linked ?? 0),
      oldestAt: row.oldest ? (row.oldest as Date).toISOString() : null,
      newestAt: row.newest ? (row.newest as Date).toISOString() : null,
      writeFailures: this.failures,
      lastFailure: this.lastFailure,
    };
  }

  private noteFailure(where: string, e: unknown): void {
    this.failures += 1;
    this.lastFailure = `${where}: ${(e as Error).message}`.slice(0, 300);
    /*
       ★ 감사기록에만 남긴다. 여기서 던지면 주문 경로가 죽는다 —
         학습 데이터를 남기지 못한 것과 주문을 못 낸 것은 심각도가 다르다.
    */
    this.audit?.('learning.write_failed', { where, error: this.lastFailure });
  }
}

export interface LearningSample {
  decisionId: string;
  subject: string;
  market: string;
  executionMode: string;
  symbol: string;
  side: string;
  orderType: string;
  price: string | null;
  quantity: string;
  leverage: string | null;
  marginMode: string | null;
  reduceOnly: boolean;
  stopPrice: string | null;
  takeProfitPrice: string | null;
  /** 브래킷 손절가. stopPrice(조건부 진입가)와 뜻이 다르다. */
  stopLossPrice: string | null;
  uiContext: UiContext | null;
  marketSnapshot: Record<string, unknown> | null;
  accountSnapshot: Record<string, unknown> | null;
  riskSnapshot: Record<string, unknown> | null;
  submitStatus: string;
  submitReason: string | null;
  decidedAt: string;
  outcome: {
    kind: string;
    entryPrice: string | null;
    exitPrice: string | null;
    filledQuantity: string | null;
    fees: string | null;
    realizedPnl: string | null;
    roiPct: string | null;
    holdingSeconds: number | null;
    closeReason: string;
    observedAt: string | null;
  } | null;
}
