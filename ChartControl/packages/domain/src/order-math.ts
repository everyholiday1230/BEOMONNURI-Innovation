import { D, Decimal } from './money';

export interface OrderMathInput {
  side: 'long' | 'short';
  entryPrice: string;
  quantity: string;
  leverage: number;
  /** taker fee rate, e.g. 0.0006 for 0.06%. */
  feeRate?: string;
  /** maintenance margin rate for liquidation estimate, e.g. 0.005. */
  maintenanceMarginRate?: string;
  stopLoss?: string;
  takeProfit?: string;
}

export interface OrderMathResult {
  positionValue: string;
  initialMargin: string;
  estFee: string;
  estLiquidationPrice?: string;
  riskReward?: string;
  maxEstLoss?: string;
}

/**
 * Decimal-based derivatives order math. Linear USDT-margined perpetual approximation.
 * All money is Decimal; never JS float. Liquidation is an ESTIMATE (isolated-margin model).
 */
export function computeOrderMath(input: OrderMathInput): OrderMathResult {
  const entry = D(input.entryPrice);
  const qty = D(input.quantity);
  const lev = D(input.leverage);
  const feeRate = D(input.feeRate ?? '0.0006');
  const mmr = D(input.maintenanceMarginRate ?? '0.005');

  const positionValue = entry.times(qty);
  const initialMargin = lev.gt(0) ? positionValue.dividedBy(lev) : positionValue;
  const estFee = positionValue.times(feeRate);

  const result: OrderMathResult = {
    positionValue: positionValue.toString(),
    initialMargin: initialMargin.toString(),
    estFee: estFee.toString(),
  };

  // Isolated-margin liquidation estimate.
  // long:  liq = entry * (1 - 1/lev + mmr)
  // short: liq = entry * (1 + 1/lev - mmr)
  if (lev.gt(0)) {
    const invLev = D(1).dividedBy(lev);
    const liq =
      input.side === 'long'
        ? entry.times(D(1).minus(invLev).plus(mmr))
        : entry.times(D(1).plus(invLev).minus(mmr));
    if (liq.gt(0)) result.estLiquidationPrice = liq.toString();
  }

  // Risk / reward and max estimated loss from SL/TP.
  if (input.stopLoss) {
    const sl = D(input.stopLoss);
    const riskPerUnit =
      input.side === 'long' ? entry.minus(sl) : sl.minus(entry);
    const maxLoss = riskPerUnit.times(qty).plus(estFee);
    result.maxEstLoss = maxLoss.toString();

    if (input.takeProfit) {
      const tp = D(input.takeProfit);
      const rewardPerUnit =
        input.side === 'long' ? tp.minus(entry) : entry.minus(tp);
      if (!riskPerUnit.eq(0)) {
        const rr = rewardPerUnit.dividedBy(riskPerUnit.abs());
        result.riskReward = rr.toString();
      }
    }
  }

  return result;
}

/** Compute R:R from an entry, stop and first take-profit (Decimal-safe). */
export function riskReward(
  side: 'long' | 'short',
  entry: string,
  stop: string,
  takeProfit: string,
): string {
  const e = D(entry);
  const s = D(stop);
  const t = D(takeProfit);
  const risk = (side === 'long' ? e.minus(s) : s.minus(e)).abs();
  const reward = (side === 'long' ? t.minus(e) : e.minus(t)).abs();
  if (risk.eq(0)) return '0';
  return reward.dividedBy(risk).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString();
}
