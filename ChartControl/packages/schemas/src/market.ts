import { z } from 'zod';
import { TIMEFRAMES } from '@quantumtrade/config';
import { DecimalString, EpochMs, FiniteNumber, NonNegativeDecimalString } from './primitives';

export const TimeframeSchema = z.enum(TIMEFRAMES);

export const MarketTypeSchema = z.enum(['spot', 'futures', 'paper']);
export type MarketType = z.infer<typeof MarketTypeSchema>;

/**
 * Symbol / market metadata — the precision rules that all order validation depends on.
 * Sourced (in BITMART_PUBLIC mode) from BitMart contract details, normalized here.
 */
export const SymbolSchema = z.object({
  id: z.string().min(1), // e.g. "BTCUSDT"
  base: z.string().min(1), // "BTC"
  quote: z.string().min(1), // "USDT"
  contractType: z.enum(['perpetual', 'spot']).default('perpetual'),
  pricePrecision: z.number().int().nonnegative(),
  quantityPrecision: z.number().int().nonnegative(),
  tickSize: DecimalString,
  stepSize: DecimalString,
  minQty: NonNegativeDecimalString,
  maxLeverage: z.number().positive().default(20),
});
export type SymbolInfo = z.infer<typeof SymbolSchema>;

/**
 * Candle / OHLCV. Prices as decimal strings for lossless transport; `time` is the bucket open ms.
 * `closed` distinguishes a finalized candle from the in-progress one.
 */
export const CandleSchema = z
  .object({
    time: EpochMs,
    open: DecimalString,
    high: DecimalString,
    low: DecimalString,
    close: DecimalString,
    volume: NonNegativeDecimalString,
    closed: z.boolean().default(true),
  })
  .refine(
    (c) => {
      const o = Number(c.open);
      const h = Number(c.high);
      const l = Number(c.low);
      const cl = Number(c.close);
      // OHLC sanity: high is the max, low is the min, all finite & non-negative.
      return (
        [o, h, l, cl].every((n) => Number.isFinite(n) && n >= 0) &&
        h >= Math.max(o, cl, l) &&
        l <= Math.min(o, cl, h)
      );
    },
    { message: 'invalid OHLC relationship' },
  );
export type Candle = z.infer<typeof CandleSchema>;

export const TradeSideSchema = z.enum(['buy', 'sell']);

export const TradeSchema = z.object({
  id: z.string().min(1),
  price: DecimalString,
  size: NonNegativeDecimalString,
  side: TradeSideSchema, // taker side (maker/taker direction)
  ts: EpochMs,
});
export type Trade = z.infer<typeof TradeSchema>;

/** One order-book level: [price, size] as decimal strings. */
export const BookLevelSchema = z.tuple([DecimalString, NonNegativeDecimalString]);

export const OrderBookSchema = z.object({
  symbol: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  bids: z.array(BookLevelSchema),
  asks: z.array(BookLevelSchema),
  asOf: EpochMs,
  isSnapshot: z.boolean().default(false),
});
export type OrderBook = z.infer<typeof OrderBookSchema>;

export const TickerSchema = z.object({
  symbol: z.string().min(1),
  last: DecimalString,
  changePct: FiniteNumber,
  markPrice: DecimalString.optional(),
  indexPrice: DecimalString.optional(),
  fundingRate: FiniteNumber.optional(),
  nextFundingAt: EpochMs.optional(),
  high24h: DecimalString.optional(),
  low24h: DecimalString.optional(),
  vol24h: NonNegativeDecimalString.optional(),
});
export type Ticker = z.infer<typeof TickerSchema>;

/**
 * `/wallet/transactions` query — BitMart futures transaction history.
 *
 * `.strict()` so a typo'd parameter is a 400 rather than a silently ignored filter that returns the wrong
 * rows. Times are epoch MILLISECONDS here: this upstream endpoint differs from the kline endpoints, which
 * take seconds.
 */
export const ExchangeTransactionQuerySchema = z
  .object({
    symbol: z.string().min(1).max(32).optional(),
    flowType: z.coerce.number().int().min(0).max(5).optional(),
    startTime: z.coerce.number().int().positive().optional(),
    endTime: z.coerce.number().int().positive().optional(),
    pageSize: z.coerce.number().int().min(1).max(1000).optional(),
  })
  .strict()
  .refine((q) => q.startTime === undefined || q.endTime === undefined || q.startTime <= q.endTime, {
    message: 'startTime must be <= endTime',
    path: ['startTime'],
  });

export type ExchangeTransactionQueryInput = z.infer<typeof ExchangeTransactionQuerySchema>;
