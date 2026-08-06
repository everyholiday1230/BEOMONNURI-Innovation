import { CHANNELS, type Channel } from './config';

/**
 * Internal stream keys.
 *
 * A key identifies one upstream subscription. Candles **must** carry their timeframe:
 * `SubscriptionManager` de-duplicates by key, so with a bare `candle:BTCUSDT` a client asking for 1h and
 * a client asking for 1m share a single upstream, and whichever opened first decides what both receive.
 * The second client sees a chart that looks correct and is a different interval — and the candle cache,
 * which was being written with a hardcoded `'1m'`, would agree with it.
 *
 * Format:
 *   `ticker:BTCUSDT`          non-candle channels
 *   `candle@1m:BTCUSDT`       candles, timeframe-qualified
 *
 * The symbol stays in the last position so `key.split(':')[1]` keeps working for existing callers.
 */

export interface StreamKey {
  channel: Channel;
  symbol: string;
  /** Present only for `candle`. */
  timeframe?: string;
}

export function buildStreamKey(channel: Channel, symbol: string, timeframe?: string): string {
  return channel === 'candle' && timeframe !== undefined
    ? `candle@${timeframe}:${symbol}`
    : `${channel}:${symbol}`;
}

export function parseStreamKey(key: string): StreamKey | null {
  const idx = key.indexOf(':');
  if (idx <= 0) return null;
  const head = key.slice(0, idx);
  const symbol = key.slice(idx + 1);
  if (symbol === '') return null;

  const at = head.indexOf('@');
  const channel = at === -1 ? head : head.slice(0, at);
  const timeframe = at === -1 ? undefined : head.slice(at + 1);
  if (!(CHANNELS as readonly string[]).includes(channel)) return null;
  if (at !== -1 && timeframe === '') return null;
  return timeframe === undefined
    ? { channel: channel as Channel, symbol }
    : { channel: channel as Channel, symbol, timeframe };
}

/** Symbol for a key, or null. Prefer this over `split(':')[1]`. */
export function symbolOf(key: string): string | null {
  return parseStreamKey(key)?.symbol ?? null;
}
