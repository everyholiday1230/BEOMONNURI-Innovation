import type { Timeframe } from '@quantumtrade/config';
import type { ChartBar, ChartOverlaySpec, DataLoader, IChartRenderer, IndicatorName } from './interfaces';

const OVERLAY_COLOR: Record<ChartOverlaySpec['color'], string> = {
  long: '#2bd9b4',
  short: '#ff5c8a',
  ai: '#a78bfa',
  neutral: '#9aa4b2',
  warning: '#f2c14e',
};

/**
 * Minimal typed façade over the klinecharts module. We depend on THIS, not on klinecharts' exact
 * exported types, so a klinecharts API/version change is absorbed in one thin wrapper in the web
 * app (see apps/web/src/chart/klineModule.ts). klinecharts is a PINNED npm dependency (10.0.0),
 * never a CDN script (ADR-0002).
 *
 * The method names deliberately do NOT mirror klinecharts' own API. klinecharts 10 removed the v9
 * imperative data API (`applyNewData` / `applyMoreData` / `updateData` / `loadMore`) in favour of a
 * pull-based `setDataLoader` + `setSymbol` / `setPeriod` flow, and reusing the old names here is
 * what allowed a silent no-op to survive Phase 6 (see docs/PHASE6-13-KNOWN-ISSUES.md).
 */
export interface KLineInstance {
  /**
   * Declare the market the next `setBars` call belongs to. Pull-based engines need a symbol AND a
   * period before they will request data at all.
   */
  setMarket(market: { ticker: string; period: Timeframe }): void;
  /** Replace the full history. Bars are already validated, sorted ascending and de-duplicated. */
  setBars(bars: ChartBar[]): void;
  /** Append or replace the most recent bar (realtime tick). */
  pushBar(bar: ChartBar): void;
  /** Bars the engine currently holds. Used for load-state reporting and render assertions. */
  getBarCount(): number;
  createIndicator(name: string, isStack?: boolean, options?: { id?: string }): string | null;
  removeIndicator(paneId: string): void;
  /** Create a single overlay (klinecharts overlay spec). Returns an id or null. */
  createOverlay(overlay: unknown): string | null;
  /** Remove all overlays. */
  removeAllOverlays(): void;
  resize(): void;
  setStyles(theme: 'dark' | 'light' | Record<string, unknown>): void;
}

export interface KLineModule {
  init(el: HTMLElement): KLineInstance | null;
  dispose(target: HTMLElement | KLineInstance): void;
}

/** Observable load state, exposed so the UI can render empty/error states and E2E can assert. */
export type ChartLoadState = 'idle' | 'loading' | 'ready' | 'empty' | 'error';

export interface ChartStatus {
  state: ChartLoadState;
  /** Bars accepted after validation/normalization. */
  barCount: number;
  /**
   * Bars the ENGINE reports holding. This is deliberately separate from `barCount`: a façade that
   * accepts data and drops it on the floor (the Phase 6 v9→v10 silent no-op) keeps `barCount`
   * correct while `engineBarCount` stays 0, which is exactly the case that shipped a blank chart.
   */
  engineBarCount: number;
  /** Bars dropped by validation (malformed OHLCV) — surfaced instead of silently ignored. */
  rejectedCount: number;
  /** Bars dropped as duplicate timestamps. */
  duplicateCount: number;
  firstTimestamp: number | null;
  lastTimestamp: number | null;
  symbol: string;
  period: Timeframe;
  error: string | null;
}

/**
 * A bar is usable only if every field is a finite number, the timestamp is positive, prices are
 * positive, volume is non-negative and the high/low envelope actually contains open/close.
 * Malformed bars are DROPPED (never passed to the engine) and counted in `ChartStatus`.
 */
export function isValidBar(bar: ChartBar | null | undefined): boolean {
  if (!bar) return false;
  const { timestamp, open, high, low, close, volume } = bar;
  for (const n of [timestamp, open, high, low, close, volume]) {
    if (typeof n !== 'number' || !Number.isFinite(n)) return false;
  }
  if (timestamp <= 0) return false;
  if (open <= 0 || high <= 0 || low <= 0 || close <= 0) return false;
  if (volume < 0) return false;
  if (high < low) return false;
  if (high < open || high < close) return false;
  if (low > open || low > close) return false;
  return true;
}

export interface NormalizedBars {
  bars: ChartBar[];
  rejected: number;
  duplicates: number;
}

/**
 * Validate → sort ascending by timestamp → de-duplicate (last occurrence wins, since a later
 * payload for the same timestamp is the more recent snapshot of that bar).
 */
export function normalizeBars(input: readonly (ChartBar | null | undefined)[]): NormalizedBars {
  let rejected = 0;
  const valid: ChartBar[] = [];
  for (const bar of input) {
    if (isValidBar(bar)) valid.push(bar as ChartBar);
    else rejected += 1;
  }
  // Stable sort keeps the original relative order of equal timestamps, so "last wins" below is
  // deterministic with respect to the input order.
  valid.sort((a, b) => a.timestamp - b.timestamp);
  const byTimestamp = new Map<number, ChartBar>();
  for (const bar of valid) byTimestamp.set(bar.timestamp, bar);
  const duplicates = valid.length - byTimestamp.size;
  return { bars: [...byTimestamp.values()], rejected, duplicates };
}

/**
 * KLineChartAdapter — the ONLY place that talks to klinecharts. Implements IChartRenderer.
 * Guarantees: symbol/period changes tear down the previous realtime subscription + listeners
 * before establishing new ones (prevents leaks), and dispose() frees everything and blocks any
 * in-flight loader callback from reaching a disposed engine.
 */
export class KLineChartAdapter implements IChartRenderer {
  private chart: KLineInstance | null = null;
  private container: HTMLElement | null = null;
  private loader: DataLoader | null = null;
  private symbol = '';
  private period: Timeframe = '15m';
  private unsub: (() => void) | null = null;
  private indicatorPanes = new Map<IndicatorName, string>();
  private disposed = false;
  private status: ChartStatus = {
    state: 'idle',
    barCount: 0,
    engineBarCount: 0,
    rejectedCount: 0,
    duplicateCount: 0,
    firstTimestamp: null,
    lastTimestamp: null,
    symbol: '',
    period: '15m',
    error: null,
  };
  private statusListeners = new Set<(s: ChartStatus) => void>();
  /** Guards against a stale (superseded) reload writing its result over a newer one. */
  private loadSeq = 0;

  constructor(private readonly module: KLineModule) {}

  init(container: HTMLElement): void {
    this.container = container;
    this.chart = this.module.init(container);
  }

  setDataLoader(loader: DataLoader): void {
    this.loader = loader;
  }

  setSymbol(symbol: string): void {
    if (symbol === this.symbol) return;
    this.symbol = symbol;
    void this.reload();
  }

  setPeriod(period: Timeframe): void {
    if (period === this.period) return;
    this.period = period;
    void this.reload();
  }

  /** Current load state (bar count, rejected/duplicate counts, timestamps, error). */
  getStatus(): ChartStatus {
    return { ...this.status };
  }

  /** Subscribe to load-state changes. Returns an unsubscribe. */
  onStatus(listener: (s: ChartStatus) => void): () => void {
    this.statusListeners.add(listener);
    listener(this.getStatus());
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  private setStatus(patch: Partial<ChartStatus>): void {
    this.status = { ...this.status, ...patch, symbol: this.symbol, period: this.period };
    const snapshot = this.getStatus();
    for (const l of this.statusListeners) l(snapshot);
  }

  /** Load history then (re)subscribe realtime. Always tears down the previous subscription first. */
  private async reload(): Promise<void> {
    this.teardownSubscription();
    if (!this.chart || !this.loader || !this.symbol) return;
    const seq = ++this.loadSeq;
    this.setStatus({ state: 'loading', error: null });
    let raw: ChartBar[];
    try {
      raw = await this.loader.getBars({ symbol: this.symbol, period: this.period });
    } catch (err) {
      // A superseded or post-dispose failure must not clobber the current state.
      if (this.disposed || seq !== this.loadSeq) return;
      this.setStatus({
        state: 'error',
        barCount: 0,
        engineBarCount: 0,
        firstTimestamp: null,
        lastTimestamp: null,
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    if (this.disposed || !this.chart || seq !== this.loadSeq) return;

    const { bars, rejected, duplicates } = normalizeBars(raw ?? []);
    // Declare the market BEFORE the data: pull-based engines need symbol+period to request bars.
    this.chart.setMarket({ ticker: this.symbol, period: this.period });
    this.chart.setBars(bars);
    this.setStatus({
      state: bars.length === 0 ? 'empty' : 'ready',
      barCount: bars.length,
      engineBarCount: this.chart.getBarCount(),
      rejectedCount: rejected,
      duplicateCount: duplicates,
      firstTimestamp: bars.length > 0 ? bars[0]!.timestamp : null,
      lastTimestamp: bars.length > 0 ? bars[bars.length - 1]!.timestamp : null,
      error: null,
    });
    this.subscribeRealtime();
  }

  private subscribeRealtime(): void {
    if (!this.chart || !this.loader) return;
    const seq = this.loadSeq;
    this.unsub = this.loader.subscribeBar(
      { symbol: this.symbol, period: this.period },
      (bar: ChartBar) => {
        // Drop ticks that arrive after dispose or after the market moved on, and malformed ticks.
        if (this.disposed || !this.chart || seq !== this.loadSeq) return;
        if (!isValidBar(bar)) {
          this.setStatus({ rejectedCount: this.status.rejectedCount + 1 });
          return;
        }
        // Never let a realtime tick move history backwards.
        const last = this.status.lastTimestamp;
        if (last !== null && bar.timestamp < last) return;
        this.chart.pushBar(bar);
        const isNewBar = last === null || bar.timestamp > last;
        this.setStatus({
          state: 'ready',
          barCount: isNewBar ? this.status.barCount + 1 : this.status.barCount,
          engineBarCount: this.chart.getBarCount(),
          firstTimestamp: this.status.firstTimestamp ?? bar.timestamp,
          lastTimestamp: bar.timestamp,
        });
      },
    );
  }

  private teardownSubscription(): void {
    if (this.unsub) {
      this.unsub();
      this.unsub = null;
    }
  }

  setTheme(theme: 'dark' | 'light'): void {
    this.chart?.setStyles(theme);
  }

  createIndicator(name: IndicatorName, isStack = false): void {
    if (!this.chart || this.indicatorPanes.has(name)) return;
    const paneId = this.chart.createIndicator(name, isStack);
    if (paneId) this.indicatorPanes.set(name, paneId);
  }

  removeIndicator(name: IndicatorName): void {
    const paneId = this.indicatorPanes.get(name);
    if (paneId && this.chart) {
      this.chart.removeIndicator(paneId);
      this.indicatorPanes.delete(name);
    }
  }

  /**
   * Render signal overlays as klinecharts horizontal price lines. Replaces the previous set.
   * Best-effort against klinecharts' overlay API (guarded in the module wrapper); returns the
   * number successfully created so callers/tests can assert overlays were applied.
   */
  setOverlays(overlays: ChartOverlaySpec[]): number {
    if (!this.chart) return 0;
    this.chart.removeAllOverlays();
    let applied = 0;
    for (const o of overlays) {
      const id = this.chart.createOverlay({
        name: 'horizontalStraightLine',
        points: [{ value: o.price }],
        lock: o.locked,
        styles: { line: { color: OVERLAY_COLOR[o.color] } },
        extendData: { id: o.id, label: o.label },
      });
      if (id) applied += 1;
    }
    return applied;
  }

  resize(): void {
    this.chart?.resize();
  }

  dispose(): void {
    this.disposed = true;
    this.loadSeq += 1;
    this.teardownSubscription();
    this.indicatorPanes.clear();
    if (this.container) this.module.dispose(this.container);
    else if (this.chart) this.module.dispose(this.chart);
    this.chart = null;
    this.container = null;
    this.loader = null;
    this.statusListeners.clear();
  }
}
