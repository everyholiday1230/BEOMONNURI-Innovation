import type { OutcomeInput } from '../db/learning-repo';

/**
 * 거래 결과 수집 — 관측된 주문·체결·손익을 판단 기록에 잇는다.
 *
 * 왜 필요한가
 * ---------
 * 판단(`trade_decisions`)만 쌓이면 학습에 쓸 수 없다. 지도학습에는 정답이
 * 있어야 하고, 여기서 정답은 "그래서 어떻게 됐는가" 다.
 *
 * ★★ 실측으로 확인한 상태: 판단 5건 / 결과 0건.
 *   `recordOutcome` 을 부르는 코드가 아무 데도 없었다. 표본이 아무리 쌓여도
 *   학습에 들어가지 못하는 상태였다.
 *
 * ★★ 왜 배경 작업(cron)이 아니라 조회 시점에 모으는가
 *
 *   배경 작업으로 하려면 모든 이용자의 거래소 자격증명을 주기적으로 복호화해서
 *   거래소를 두드려야 한다. 그 자체가 큰 위험(키를 상시 메모리에 올린다)이고,
 *   이용자가 쓰지 않는 계정까지 상류 한도를 소모한다.
 *
 *   대신 **이미 인증된 조회 경로**에 얹는다. 화면이 주문 내역·체결을 불러올 때
 *   그 데이터가 이미 서버 손에 있으므로, 추가 왕복 없이 결과를 잇는다.
 *
 *   ★ 정직한 한계: **한 번도 접속하지 않은 이용자의 결과는 수집되지 않는다.**
 *     그 사람의 거래는 판단만 남고 정답이 비어 있다. 청산 감시에도 같은 한계가
 *     있고, 해결하려면 서버가 대신 조회하는 구조가 필요하다.
 *
 * 불변식
 * -----
 * 1. **없는 값을 만들지 않는다.** 체결가만 알고 손익을 모르면 손익은 null 이다.
 * 2. **연결 방법을 밝힌다.** clientOrderId 로 정확히 맞춘 것과 추정으로 이은
 *    것을 `observedFrom` 으로 구분한다 — 학습에서 걸러낼 수 있어야 한다.
 * 3. **같은 결과를 두 번 넣지 않는다.** 판단×종류로 유일하게 만든다(DB 제약).
 * 4. 순수 함수다. DB·네트워크를 만지지 않으므로 검사가 쉽다.
 */

/** 거래소/DB 에서 관측된 주문 한 건 (정규 스키마). */
export interface ObservedOrder {
  clientOrderId: string;
  exchangeOrderId?: string | undefined;
  symbol: string;
  side: 'long' | 'short';
  price?: string | undefined;
  quantity: string;
  filledQuantity: string;
  status: string;
  updatedAt: number;
  createdAt: number;
}

/** 관측된 체결 한 건. */
export interface ObservedFill {
  orderId?: string | undefined;
  clientOrderId?: string | undefined;
  symbol: string;
  price: string;
  quantity: string;
  fee?: string | null | undefined;
  at: number;
}

/** 이미 기록된 판단 (연결 대상). */
export interface KnownDecision {
  id: string;
  clientOrderId: string | null;
  symbol: string;
  side: string;
  market: 'futures' | 'spot';
  executionMode: 'live' | 'paper';
  decidedAt: number;
}

/**
 * 주문 상태 → 결과 종류.
 *
 * ★ 모르는 상태는 null 이다 — 임의로 'filled' 로 만들면 체결되지 않은 주문이
 *   체결로 학습된다.
 */
export function outcomeKindOf(status: string, filled: number, quantity: number):
  OutcomeInput['outcomeKind'] | null {
  const s = String(status || '').toLowerCase();
  if (/(^|_)(filled|done|deal|closed)$/.test(s) || s === 'filled' || s === 'done') {
    // 부분 체결과 전량 체결을 구분한다. 수량이 다르면 결과가 다르다.
    return filled > 0 && quantity > 0 && filled < quantity ? 'partial' : 'filled';
  }
  if (s.includes('cancel')) {
    /*
       ★ 일부 체결 후 취소된 주문은 'partial' 이다 — 'canceled' 로만 적으면
         체결된 수량이 데이터에서 사라진다.
    */
    return filled > 0 ? 'partial' : 'canceled';
  }
  if (s.includes('expire')) return 'expired';
  if (s.includes('liquidat')) return 'liquidated';
  // open/new/active/pending — 아직 끝나지 않았다. 결과가 아니다.
  return null;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * 관측된 주문들을 판단에 이어 결과를 만든다.
 *
 * @param decisions clientOrderId 를 가진 판단들
 * @param orders    거래소/DB 에서 읽은 주문들
 * @param fills     체결들 (수수료·평균가를 여기서만 알 수 있다)
 * @param already   이미 기록된 `${decisionId}:${kind}` 집합 — 중복을 막는다
 */
export function buildOrderOutcomes(input: {
  decisions: readonly KnownDecision[];
  orders: readonly ObservedOrder[];
  fills?: readonly ObservedFill[];
  already?: ReadonlySet<string>;
  userId: string;
}): OutcomeInput[] {
  const { decisions, orders, userId } = input;
  const fills = input.fills ?? [];
  const already = input.already ?? new Set<string>();

  // clientOrderId → 판단. 같은 키가 둘일 수 없다(멱등성 키).
  const byCoid = new Map<string, KnownDecision>();
  for (const d of decisions) {
    if (d.clientOrderId) byCoid.set(d.clientOrderId, d);
  }

  /*
     주문별 수수료 합계. 체결에만 있는 값이다.

     ★ 수수료를 모르는 체결이 하나라도 섞이면 합계도 모르는 것이다 — 0 으로
       세면 "수수료가 없었다" 가 되고, 순손익 계산이 낙관적으로 틀어진다.
  */
  const feeByOrder = new Map<string, number | null>();
  const qtyByOrder = new Map<string, { qty: number; notional: number }>();
  for (const f of fills) {
    const key = f.clientOrderId || f.orderId;
    if (!key) continue;
    const fee = f.fee === null || f.fee === undefined || f.fee === '' ? null : Number(f.fee);
    const prev = feeByOrder.has(key) ? feeByOrder.get(key)! : 0;
    feeByOrder.set(key, prev === null || fee === null || !Number.isFinite(fee) ? null : prev + fee);

    const q = num(f.quantity);
    const p = num(f.price);
    const agg = qtyByOrder.get(key) ?? { qty: 0, notional: 0 };
    agg.qty += q;
    agg.notional += q * p;
    qtyByOrder.set(key, agg);
  }

  const out: OutcomeInput[] = [];
  for (const o of orders) {
    const d = byCoid.get(o.clientOrderId);
    if (!d) continue;   // 우리 화면을 거치지 않은 주문 — 판단이 없다

    const filled = num(o.filledQuantity);
    const qty = num(o.quantity);
    const kind = outcomeKindOf(o.status, filled, qty);
    if (!kind) continue;   // 아직 진행 중

    if (already.has(`${d.id}:${kind}`)) continue;

    /*
       진입가.

       ★ 체결 평균가를 쓴다. 지정가 주문의 `price` 는 **요청한 가격**이고 실제
         체결가와 다를 수 있다(시장가는 price 가 아예 없다). 요청가를 체결가로
         기록하면 슬리피지가 데이터에서 사라진다.
    */
    const agg = qtyByOrder.get(o.clientOrderId);
    const avg = agg && agg.qty > 0 ? String(agg.notional / agg.qty) : null;

    const fee = feeByOrder.has(o.clientOrderId) ? feeByOrder.get(o.clientOrderId)! : null;

    out.push({
      decisionId: d.id,
      userId,
      market: d.market,
      executionMode: d.executionMode,
      symbol: o.symbol,
      side: o.side,
      outcomeKind: kind,
      entryPrice: avg ?? o.price ?? null,
      // 체결만으로는 청산가·손익을 알 수 없다. 만들지 않는다.
      exitPrice: null,
      filledQuantity: filled > 0 ? String(filled) : null,
      fees: fee === null ? null : String(fee),
      realizedPnl: null,
      roiPct: null,
      /*
         보유 시간. 주문 접수 → 종료까지다.
         ★ 포지션 보유 시간이 아니다(청산을 아직 모른다). 값을 넣되 의미를
           혼동하지 않도록, 청산 결과가 붙으면 그때 다시 계산한다.
      */
      holdingSeconds: o.updatedAt > o.createdAt
        ? Math.round((o.updatedAt - o.createdAt) / 1000)
        : null,
      // 왜 끝났는지는 주문 상태만으로 알 수 없다. 추측하지 않는다.
      closeReason: 'unknown',
      exitSnapshot: null,
      // clientOrderId 로 정확히 맞췄다.
      observedFrom: d.executionMode === 'paper' ? 'sim' : 'exchange_order',
    });
  }
  return out;
}

/** 원장에서 읽은 실현손익 한 건. */
export interface ObservedRealizedPnl {
  symbol: string;
  amount: string;
  at: number;
  /** 원장 항목 종류 (REALIZED_PNL / LIQUIDATION 등). */
  kind?: string | undefined;
}

/**
 * 실현손익을 판단에 **추정으로** 잇는다.
 *
 * ★★ 거래소 원장은 "이 손익이 어느 주문에서 나왔는지" 를 알려주지 않는다.
 *   그래서 종목이 같고, 체결된 판단 중 아직 청산이 붙지 않은 **가장 최근 것**에
 *   잇는다. 이것은 추정이다.
 *
 * ★ 그래서 `observedFrom: 'position_diff'` 로 표시한다. 학습에서 정확히 맞춘
 *   표본만 쓰고 싶을 때 걸러낼 수 있어야 한다 — 구분하지 않으면 추정이 사실로
 *   섞여 들어간다.
 *
 * ★ 이을 판단이 없으면 **버리지 않고** `decisionId: null` 로 남긴다. 같은 계정의
 *   손익 총합이 앞뒤가 맞아야 하고, 근거 없는 표본이라는 사실은 그 자체로 정보다.
 */
export function attributeRealizedPnl(input: {
  decisions: readonly KnownDecision[];
  /** 이미 청산이 붙은 판단 id */
  closedDecisionIds: ReadonlySet<string>;
  /** 체결이 관측된 판단 id (진입이 있었던 것만 청산될 수 있다) */
  filledDecisionIds: ReadonlySet<string>;
  entries: readonly ObservedRealizedPnl[];
  userId: string;
  market: 'futures' | 'spot';
  executionMode: 'live' | 'paper';
}): OutcomeInput[] {
  const used = new Set<string>(input.closedDecisionIds);
  const out: OutcomeInput[] = [];

  // 오래된 손익부터 처리한다 — 그래야 오래된 진입에 먼저 붙는다.
  const entries = [...input.entries].sort((a, b) => a.at - b.at);

  for (const e of entries) {
    const amount = Number(e.amount);
    if (!Number.isFinite(amount)) continue;   // 숫자가 아니면 버린다(0 으로 만들지 않는다)

    const candidates = input.decisions
      .filter((d) => d.symbol === e.symbol
        && input.filledDecisionIds.has(d.id)
        && !used.has(d.id)
        && d.decidedAt <= e.at)
      // 가장 최근 진입에 붙인다.
      .sort((a, b) => b.decidedAt - a.decidedAt);

    const hit = candidates[0];
    if (hit) used.add(hit.id);

    const liquidated = /liquidat/i.test(String(e.kind ?? ''));
    out.push({
      decisionId: hit ? hit.id : null,
      userId: input.userId,
      market: hit ? hit.market : input.market,
      executionMode: hit ? hit.executionMode : input.executionMode,
      symbol: e.symbol,
      side: hit ? hit.side : 'unknown',
      outcomeKind: liquidated ? 'liquidated' : 'closed',
      entryPrice: null,
      exitPrice: null,
      filledQuantity: null,
      fees: null,
      realizedPnl: e.amount,
      // 수익률은 진입 명목가를 알아야 계산된다. 모르면 만들지 않는다.
      roiPct: null,
      holdingSeconds: hit ? Math.round((e.at - hit.decidedAt) / 1000) : null,
      /*
         ★ 왜 끝났는지는 원장이 청산만 구분해 준다. 익절·손절은 알 수 없으므로
           'unknown' 이다 — 손익 부호로 추측하면 "손절이 잘 작동한다" 는 없던
           사실을 학습한다(이익이 나도 손절 주문일 수 있다).
      */
      closeReason: liquidated ? 'liquidation' : 'unknown',
      exitSnapshot: null,
      observedFrom: 'position_diff',
    });
  }
  return out;
}
