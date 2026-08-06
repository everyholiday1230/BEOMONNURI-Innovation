import type { Candle } from '@quantumtrade/schemas';
import type { Timeframe } from '@quantumtrade/config';

/**
 * IChartRenderer — the vendor-agnostic chart contract (ADR-0002). Business logic depends only on
 * this. KLineChart lives behind KLineChartAdapter; a future official BitMart Chart SDK or a
 * klinecharts major upgrade is a new adapter, no caller changes.
 */
export interface ChartBar {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type IndicatorName = 'MA' | 'EMA' | 'BOLL' | 'MACD' | 'RSI' | 'VOL';

/** A price-line overlay to render on the chart (AI/user signal levels). */
export interface ChartOverlaySpec {
  id: string;
  price: number;
  color: 'long' | 'short' | 'ai' | 'neutral' | 'warning';
  label: string;
  locked: boolean;
}

/** Historical data loader following KLineChart's DataLoader model. */
export interface DataLoader {
  /** Fetch bars for a symbol/period, optionally before a timestamp (pagination). */
  getBars(params: {
    symbol: string;
    period: Timeframe;
    from?: number;
    to?: number;
  }): Promise<ChartBar[]>;
  /** Subscribe to realtime bar updates. Returns an unsubscribe. */
  subscribeBar(
    params: { symbol: string; period: Timeframe },
    onBar: (bar: ChartBar) => void,
  ): () => void;
}

export interface IChartRenderer {
  init(container: HTMLElement): void;
  setSymbol(symbol: string): void;
  setPeriod(period: Timeframe): void;
  setDataLoader(loader: DataLoader): void;
  setTheme(theme: 'dark' | 'light'): void;
  createIndicator(name: IndicatorName, isStack?: boolean): void;
  removeIndicator(name: IndicatorName): void;
  /** Replace all signal overlays (AI/user price lines) on the chart. Returns count applied. */
  setOverlays(overlays: ChartOverlaySpec[]): number;
  resize(): void;
  /** Remove ALL listeners + subscriptions and free the underlying instance. */
  dispose(): void;
}

/** Convert a validated domain Candle (decimal strings) to a numeric chart bar. */
export function candleToBar(c: Candle): ChartBar {
  return {
    timestamp: c.time,
    open: Number(c.open),
    high: Number(c.high),
    low: Number(c.low),
    close: Number(c.close),
    volume: Number(c.volume),
  };
}
