import { z } from 'zod';

/**
 * Shared primitives. Prices/quantities that participate in money math are carried as
 * DECIMAL STRINGS (not JS numbers) so precision survives serialization. See @quantumtrade/domain.
 */

/** A finite, non-NaN JS number (for non-money numeric fields like timestamps, counts). */
export const FiniteNumber = z.number().finite();

/** A decimal string: optional sign, digits, optional fractional part. Rejects NaN/Infinity. */
export const DecimalString = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/u, 'must be a decimal string like "123.45"');

/** A positive decimal string ( > 0 ). */
export const PositiveDecimalString = DecimalString.refine(
  (s) => Number(s) > 0,
  'must be greater than 0',
);

/** A non-negative decimal string ( >= 0 ). */
export const NonNegativeDecimalString = DecimalString.refine(
  (s) => Number(s) >= 0,
  'must be >= 0',
);

/** Epoch milliseconds (UTC). */
export const EpochMs = z.number().int().nonnegative();

export type DecimalStringT = z.infer<typeof DecimalString>;
