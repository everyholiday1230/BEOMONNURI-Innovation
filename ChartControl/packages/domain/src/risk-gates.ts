import type { SymbolInfo } from '@quantumtrade/schemas';
import { D, floorToStep, roundToTick } from './money';

/**
 * Pre-submission Risk Gates (docs section 3). Pure, Decimal-safe, unit-tested. The UI renders each
 * gate and DISABLES the final submit button when any gate is `fail`. `warn` does not block.
 */
export type GateStatus = 'ok' | 'warn' | 'fail';

export interface RiskGate {
  id: string;
  label: string;
  status: GateStatus;
  detail: string;
}

export interface RiskGateInput {
  symbol?: SymbolInfo;
  /*
     ★★ 심볼 규격이 없을 때 **누구의 문제인지** 구분하기 위한 값.

       실서비스 사고: 카탈로그 적재가 실패한 동안 고객 주문 9건이
       'symbol metadata unavailable' 로 막혔다. 그 문구는 **고객이 심볼을 잘못
       골랐다는 뜻으로 읽힌다.** 그래서 고객은 90분간 8번 다시 눌렀다.

       실제로는 우리 쪽 데이터가 없던 것이다. 두 상황은 고객이 취할 행동이
       완전히 다르다 — 하나는 "다른 심볼을 고르세요", 다른 하나는
       "잠시 뒤 다시 시도하세요, 고객님 잘못이 아닙니다".

     false = 카탈로그가 아직 적재되지 않았다(우리 문제)
     true  = 카탈로그는 있는데 그 심볼이 없다(심볼 문제)
  */
  catalogueLoaded?: boolean;
  side: 'long' | 'short';
  orderType: 'market' | 'limit' | 'stop' | 'tp_sl';
  price?: string;
  quantity: string;
  leverage: number;
  stopLoss?: string;
  takeProfit?: string;
  riskReward?: string;
  maxEstLoss?: string;
  /** connection/market-data status; anything other than LIVE blocks submission. */
  marketDataStatus?: string;
  /** minimum acceptable R:R before warning (default 1.0). */
  minRiskReward?: number;
}

export interface RiskGateResult {
  gates: RiskGate[];
  failCount: number;
  warnCount: number;
  pass: boolean;
}

function finitePos(s?: string): boolean {
  if (s === undefined) return false;
  const d = D(s);
  return d.isFinite() && d.gt(0);
}

export function evaluateRiskGates(input: RiskGateInput): RiskGateResult {
  const gates: RiskGate[] = [];
  const add = (id: string, label: string, status: GateStatus, detail: string) =>
    gates.push({ id, label, status, detail });

  const sym = input.symbol;
  const needPrice = input.orderType !== 'market';
  const priceOk = needPrice ? finitePos(input.price) : true;
  const qtyOk = finitePos(input.quantity);

  // 1. Symbol & market metadata present.
  if (sym && sym.tickSize && sym.stepSize && sym.minQty) {
    add('metadata', 'Symbol · market metadata', 'ok', `${sym.id} · tick ${sym.tickSize} · step ${sym.stepSize}`);
  } else if (input.catalogueLoaded === false) {
    /*
       ★★ 우리 쪽 문제임을 분명히 말한다. 고객이 자기 입력을 의심하며 반복
         시도하는 것을 막는 것이 목적이다.
    */
    add(
      'metadata',
      'Symbol · market metadata',
      'fail',
      'exchange symbol catalogue not loaded yet on our side — not your input; retry shortly',
    );
  } else {
    add('metadata', 'Symbol · market metadata', 'fail', `no specification for this symbol${sym?.id ? ` (${sym.id})` : ''} — pick another market`);
  }

  // 2. Price / quantity validity (finite, > 0).
  add(
    'priceQty',
    'Price · quantity valid',
    priceOk && qtyOk ? 'ok' : 'fail',
    priceOk && qtyOk ? 'finite, > 0' : `invalid ${[!priceOk && 'price', !qtyOk && 'quantity'].filter(Boolean).join(' & ')}`,
  );

  // 3. Tick size / step size alignment.
  if (sym && priceOk && qtyOk) {
    const errs: string[] = [];
    if (needPrice && input.price) {
      const p = D(input.price);
      if (!roundToTick(p, sym.tickSize).equals(p)) errs.push(`price not aligned to tick ${sym.tickSize}`);
    }
    const q = D(input.quantity);
    if (!floorToStep(q, sym.stepSize).equals(q)) errs.push(`qty not a multiple of step ${sym.stepSize}`);
    add('tickStep', 'Tick size · step size', errs.length ? 'fail' : 'ok', errs.length ? errs.join('; ') : 'aligned');
  } else {
    add('tickStep', 'Tick size · step size', 'warn', 'skipped (invalid metadata/price/qty)');
  }

  // 4. Minimum quantity.
  if (sym && qtyOk) {
    const q = D(input.quantity);
    const ok = q.gte(D(sym.minQty));
    add('minQty', 'Minimum quantity', ok ? 'ok' : 'fail', ok ? `>= ${sym.minQty}` : `below minQty ${sym.minQty}`);
  } else {
    add('minQty', 'Minimum quantity', 'warn', 'skipped');
  }

  // 5. Entry / Stop Loss direction.
  if (input.stopLoss && priceOk && input.price) {
    const e = D(input.price);
    const sl = D(input.stopLoss);
    const good = input.side === 'long' ? sl.lt(e) : sl.gt(e);
    add('slDir', 'Entry · Stop Loss direction', good ? 'ok' : 'fail', good ? `SL ${input.side === 'long' ? 'below' : 'above'} entry` : `SL on the wrong side for ${input.side}`);
  } else {
    add('slDir', 'Entry · Stop Loss direction', 'warn', 'no stop loss set');
  }

  // 6. Entry / Take Profit direction.
  if (input.takeProfit && priceOk && input.price) {
    const e = D(input.price);
    const tp = D(input.takeProfit);
    const good = input.side === 'long' ? tp.gt(e) : tp.lt(e);
    add('tpDir', 'Entry · Take Profit direction', good ? 'ok' : 'fail', good ? `TP ${input.side === 'long' ? 'above' : 'below'} entry` : `TP on the wrong side for ${input.side}`);
  } else {
    add('tpDir', 'Entry · Take Profit direction', 'warn', 'no take profit set');
  }

  // 7. Risk / Reward.
  const minRR = input.minRiskReward ?? 1;
  if (input.riskReward !== undefined && D(input.riskReward).isFinite()) {
    const rr = D(input.riskReward);
    add('rr', 'Risk / Reward', rr.gte(minRR) ? 'ok' : 'warn', `R:R ${rr.toDecimalPlaces(2).toString()} (min ${minRR})`);
  } else {
    add('rr', 'Risk / Reward', 'warn', 'not computable (needs SL & TP)');
  }

  // 8. Estimated maximum loss.
  if (input.maxEstLoss !== undefined && D(input.maxEstLoss).isFinite()) {
    add('maxLoss', 'Estimated maximum loss', 'ok', `max est. loss ${input.maxEstLoss}`);
  } else {
    add('maxLoss', 'Estimated maximum loss', 'warn', 'not computable (needs SL)');
  }

  // 9. Stale / offline market data — BLOCKS submission.
  const st = input.marketDataStatus ?? 'LIVE';
  const fresh = st === 'LIVE';
  add('freshness', 'Market data fresh (not stale/offline)', fresh ? 'ok' : 'fail', fresh ? `connection ${st}` : `blocked — connection ${st}`);

  const failCount = gates.filter((g) => g.status === 'fail').length;
  const warnCount = gates.filter((g) => g.status === 'warn').length;
  return { gates, failCount, warnCount, pass: failCount === 0 };
}
