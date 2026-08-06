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
  } else {
    add('metadata', 'Symbol · market metadata', 'fail', 'symbol metadata unavailable');
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
