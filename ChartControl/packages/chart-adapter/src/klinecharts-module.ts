/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The ONE file permitted to use `any` (documented, ADR-0002): it adapts the real, pinned
 * klinecharts@10 module to our vendor-agnostic `KLineModule` façade. All application code depends
 * on `IChartRenderer`, never on this file directly.
 *
 * Moved here from apps/web on 2026-08-03: this package already depends on the pinned klinecharts, and a
 * second app needed the same bridge. Duplicating a vendor adapter is how two copies drift apart.
 *
 * klinecharts 10 is PULL-based. The v9 imperative data API (`applyNewData`, `applyMoreData`,
 * `updateData`, `loadMore`) was REMOVED. Data reaches the chart only through
 *
 *   chart.setDataLoader({ getBars, subscribeBar, unsubscribeBar })
 *
 * and a load is triggered by `setSymbol()` / `setPeriod()` / `resetData()` — klinecharts skips the
 * load entirely unless BOTH a symbol and a period are set. `getBars` receives a `callback(bars,
 * more)` which is how the initial history is handed over; realtime bars go through the `callback`
 * given to `subscribeBar`; teardown happens in `unsubscribeBar`.
 *
 * Required APIs are asserted up-front and throw (Fail-Fast). Optional chaining on a required API is
 * what turned the v9→v10 breaking change into a silent no-op that shipped through Phase 6 with a
 * blank chart: see docs/PHASE6-13-KNOWN-ISSUES.md. Do NOT reintroduce v9 fallbacks here.
 */
import * as klinecharts from 'klinecharts';
import type { ChartBar } from './interfaces';
import type { KLineInstance, KLineModule } from './klinechart-adapter';
import type { Timeframe } from '@quantumtrade/config';

const kc = klinecharts as any;

/** klinecharts KLineData. `volume` drives the VOL indicator. */
interface KLineData {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** klinecharts 10 Chart methods this adapter depends on. Missing any of them is unrecoverable. */
const REQUIRED_CHART_METHODS = [
  'setDataLoader',
  'setSymbol',
  'setPeriod',
  'resetData',
  'createIndicator',
  'removeIndicator',
  'createOverlay',
  'removeOverlay',
  'setStyles',
  'resize',
] as const;

/** v9-only members. Their presence means a wrong klinecharts version is installed. */
const REMOVED_V9_METHODS = ['applyNewData', 'applyMoreData', 'updateData', 'loadMore'] as const;

export class ChartEngineContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChartEngineContractError';
  }
}

function assertV10Contract(chart: any): void {
  const missing = REQUIRED_CHART_METHODS.filter((m) => typeof chart?.[m] !== 'function');
  if (missing.length > 0) {
    throw new ChartEngineContractError(
      `klinecharts instance is missing required v10 API(s): ${missing.join(', ')}. ` +
        'Expected the pinned klinecharts@10 pull-based DataLoader API.',
    );
  }
  const legacy = REMOVED_V9_METHODS.filter((m) => typeof chart?.[m] === 'function');
  if (legacy.length > 0) {
    throw new ChartEngineContractError(
      `klinecharts instance exposes removed v9 API(s): ${legacy.join(', ')}. ` +
        'A pre-10 klinecharts is installed; this adapter targets klinecharts@10 only.',
    );
  }
}

function toKLineData(b: ChartBar): KLineData {
  return {
    timestamp: b.timestamp,
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
    volume: b.volume,
  };
}

/** Timeframe (`15m`, `4h`, `1d`, `1w`) → klinecharts Period ({ type, span }). */
export function toPeriod(tf: Timeframe): { type: string; span: number } {
  const span = Number.parseInt(tf, 10);
  const unit = tf.replace(/^\d+/, '');
  const type = unit === 'm' ? 'minute' : unit === 'h' ? 'hour' : unit === 'w' ? 'week' : 'day';
  return { type, span: Number.isFinite(span) && span > 0 ? span : 1 };
}

/** Decimal places actually present in the data, so prices/volumes are not rounded away. */
export function decimalsOf(values: readonly number[], fallback: number, max: number): number {
  let d = 0;
  for (const v of values) {
    const s = String(v);
    const dot = s.indexOf('.');
    if (dot >= 0 && !s.includes('e')) d = Math.max(d, s.length - dot - 1);
    if (d >= max) return max;
  }
  return d > 0 ? d : fallback;
}

function wrapInstance(chart: any): KLineInstance {
  assertV10Contract(chart);

  let bars: KLineData[] = [];
  /** klinecharts' realtime sink, handed to us in `subscribeBar`. */
  let pushToEngine: ((d: KLineData) => void) | null = null;
  let market: { ticker: string; period: { type: string; span: number } } | null = null;
  let marketApplied = false;

  chart.setDataLoader({
    // Only the initial load carries data: the BFF/mock feed has no server-side pagination, so
    // forward/backward requests resolve empty with `more: false` to stop klinecharts from paging.
    getBars: (params: any) => {
      params.callback(params.type === 'init' ? bars : [], false);
    },
    subscribeBar: (params: any) => {
      pushToEngine = params.callback;
    },
    unsubscribeBar: () => {
      pushToEngine = null;
    },
  });

  return {
    setMarket(next) {
      const period = toPeriod(next.period);
      const same =
        market !== null &&
        market.ticker === next.ticker &&
        market.period.type === period.type &&
        market.period.span === period.span;
      if (same) return;
      market = { ticker: next.ticker, period };
      marketApplied = false;
    },

    setBars(newBars: ChartBar[]) {
      bars = newBars.map(toKLineData);
      if (market && !marketApplied) {
        // Fresh object identity on purpose: Chart.setSymbol/setPeriod bail out on reference
        // equality, and setPeriod is what actually triggers the 'init' load (symbol alone leaves
        // period null, which makes klinecharts skip the load).
        chart.setSymbol({
          ticker: market.ticker,
          pricePrecision: decimalsOf(bars.map((b) => b.close), 2, 8),
          volumePrecision: decimalsOf(bars.map((b) => b.volume), 3, 8),
        });
        chart.setPeriod({ ...market.period });
        marketApplied = true;
      } else {
        // Same market, new history — re-run the 'init' load through the data loader.
        chart.resetData();
      }
    },

    pushBar(bar: ChartBar) {
      const next = toKLineData(bar);
      const last = bars[bars.length - 1];
      if (last && last.timestamp === next.timestamp) bars[bars.length - 1] = next;
      else if (!last || next.timestamp > last.timestamp) bars.push(next);
      else return;
      // Before the first load completes klinecharts has not handed us a sink yet; the bar is
      // already in the buffer and will be delivered by the next `getBars('init')`.
      pushToEngine?.(next);
    },

    getBarCount() {
      // Prefer the engine's own view when available; fall back to our buffer.
      const list = typeof chart.getDataList === 'function' ? chart.getDataList() : null;
      return Array.isArray(list) ? list.length : bars.length;
    },

    createIndicator(name: string, isStack?: boolean) {
      try {
        return chart.createIndicator(name, isStack) ?? null;
      } catch {
        return null;
      }
    },

    removeIndicator(paneId: string) {
      try {
        // klinecharts 10 takes an IndicatorFilter, not a bare pane id.
        chart.removeIndicator({ paneId });
      } catch {
        /* noop — indicator already gone */
      }
    },

    createOverlay(overlay: unknown) {
      try {
        const r = chart.createOverlay(overlay);
        return typeof r === 'string' ? r : Array.isArray(r) ? (r[0] ?? null) : r ? String(r) : null;
      } catch {
        return null;
      }
    },

    removeAllOverlays() {
      try {
        chart.removeOverlay();
      } catch {
        /* noop — nothing to remove */
      }
    },

    resize() {
      chart.resize();
    },

    setStyles(theme) {
      try {
        chart.setStyles(theme as any);
      } catch {
        /* noop — unknown named theme leaves current styles in place */
      }
    },
  };
}

export const klineModule: KLineModule = {
  init(el: HTMLElement): KLineInstance | null {
    if (typeof kc.init !== 'function') {
      throw new ChartEngineContractError('klinecharts.init is not available (expected klinecharts@10).');
    }
    const chart = kc.init(el);
    if (!chart) {
      throw new ChartEngineContractError('klinecharts.init returned no chart instance.');
    }
    return wrapInstance(chart);
  },
  dispose(target: HTMLElement | KLineInstance) {
    if (typeof kc.dispose !== 'function') return;
    try {
      kc.dispose(target as any);
    } catch {
      /* noop — already disposed */
    }
  },
};
