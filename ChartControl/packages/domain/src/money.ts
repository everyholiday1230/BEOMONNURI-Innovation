import Decimal from 'decimal.js';
import type { SymbolInfo } from '@quantumtrade/schemas';

// Configure Decimal for financial precision.
Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export { Decimal };

export function D(v: string | number | Decimal): Decimal {
  return v instanceof Decimal ? v : new Decimal(v);
}

/** Count decimal places implied by a step/tick string ("0.01" -> 2, "1" -> 0). */
export function precisionOf(step: string): number {
  const dot = step.indexOf('.');
  if (dot === -1) return 0;
  return step.length - dot - 1;
}

/** Round a value DOWN to the nearest multiple of step (used for quantity/step size). */
export function floorToStep(value: Decimal, step: string): Decimal {
  const s = D(step);
  if (s.lte(0)) return value;
  return value.dividedToIntegerBy(s).times(s);
}

/** Round a price to the nearest tick. */
export function roundToTick(value: Decimal, tick: string): Decimal {
  const t = D(tick);
  if (t.lte(0)) return value;
  return value.dividedBy(t).round().times(t);
}

export interface PrecisionCheck {
  ok: boolean;
  errors: string[];
}

/**
 * Validate a price/quantity pair against symbol precision rules:
 * tick size, step size, min quantity, and precision digits. Rejects zero/negative/NaN.
 */
export function checkPrecision(
  symbol: SymbolInfo,
  price: string | undefined,
  quantity: string,
): PrecisionCheck {
  const errors: string[] = [];
  const qty = D(quantity);
  if (!qty.isFinite() || qty.lte(0)) errors.push('quantity must be a finite value > 0');
  else {
    if (qty.lt(D(symbol.minQty))) errors.push(`quantity below minQty ${symbol.minQty}`);
    if (!floorToStep(qty, symbol.stepSize).equals(qty))
      errors.push(`quantity not a multiple of stepSize ${symbol.stepSize}`);
    if (qty.decimalPlaces() > symbol.quantityPrecision)
      errors.push(`quantity exceeds ${symbol.quantityPrecision} decimals`);
  }
  if (price !== undefined) {
    const p = D(price);
    if (!p.isFinite() || p.lte(0)) errors.push('price must be a finite value > 0');
    else {
      if (!roundToTick(p, symbol.tickSize).equals(p))
        errors.push(`price not aligned to tickSize ${symbol.tickSize}`);
      if (p.decimalPlaces() > symbol.pricePrecision)
        errors.push(`price exceeds ${symbol.pricePrecision} decimals`);
    }
  }
  return { ok: errors.length === 0, errors };
}
