import { describe, it, expect, vi } from 'vitest';
import {
  KLineChartAdapter,
  candleToBar,
  isValidBar,
  normalizeBars,
  type ChartBar,
  type DataLoader,
  type KLineInstance,
  type KLineModule,
} from '../index';
import type { Candle } from '@quantumtrade/schemas';

/**
 * Fake chart engine implementing the vendor-agnostic façade (`setMarket` / `setBars` / `pushBar`).
 * It deliberately does NOT expose klinecharts' removed v9 API (`applyNewData`, `updateData`,
 * `applyMoreData`, `loadMore`) — the adapter must never reach for those. See
 * docs/PHASE6-13-KNOWN-ISSUES.md for the silent-no-op defect this guards against.
 */
function fakeModule(): {
  module: KLineModule;
  instance: KLineInstance;
  disposed: () => number;
  bars: () => ChartBar[];
  markets: () => { ticker: string; period: string }[];
} {
  let disposeCount = 0;
  let held: ChartBar[] = [];
  const markets: { ticker: string; period: string }[] = [];
  const instance: KLineInstance = {
    setMarket: vi.fn((m) => {
      markets.push({ ticker: m.ticker, period: m.period });
    }),
    setBars: vi.fn((b: ChartBar[]) => {
      held = [...b];
    }),
    pushBar: vi.fn((b: ChartBar) => {
      const last = held[held.length - 1];
      if (last && last.timestamp === b.timestamp) held[held.length - 1] = b;
      else held.push(b);
    }),
    getBarCount: vi.fn(() => held.length),
    createIndicator: vi.fn(() => 'pane-1'),
    removeIndicator: vi.fn(),
    createOverlay: vi.fn(() => 'ov-1'),
    removeAllOverlays: vi.fn(),
    resize: vi.fn(),
    setStyles: vi.fn(),
  };
  const module: KLineModule = {
    init: () => instance,
    dispose: () => {
      disposeCount++;
    },
  };
  return { module, instance, disposed: () => disposeCount, bars: () => held, markets: () => markets };
}

const bar = (timestamp: number, close = 100): ChartBar => ({
  timestamp,
  open: close,
  high: close + 1,
  low: close - 1,
  close,
  volume: 10,
});

function fakeLoader(bars: ChartBar[] = [bar(1_000)]): {
  loader: DataLoader;
  unsubCalls: () => number;
  subCalls: () => number;
  emit: (b: ChartBar) => void;
  getBarsCalls: () => { symbol: string; period: string }[];
} {
  let unsub = 0;
  let sub = 0;
  const calls: { symbol: string; period: string }[] = [];
  let sink: ((b: ChartBar) => void) | null = null;
  const loader: DataLoader = {
    getBars: async ({ symbol, period }) => {
      calls.push({ symbol, period });
      return bars;
    },
    subscribeBar: (_params, onBar) => {
      sub++;
      sink = onBar;
      return () => {
        unsub++;
        sink = null;
      };
    },
  };
  return {
    loader,
    unsubCalls: () => unsub,
    subCalls: () => sub,
    emit: (b) => sink?.(b),
    getBarsCalls: () => calls,
  };
}

/** Two microtask turns: getBars await + the status/subscribe continuation. */
async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('bar validation (isValidBar)', () => {
  it('accepts a well-formed bar', () => {
    expect(isValidBar(bar(1))).toBe(true);
  });

  it.each([
    ['null', null],
    ['non-finite close', { ...bar(1), close: Number.NaN }],
    ['infinite high', { ...bar(1), high: Number.POSITIVE_INFINITY }],
    ['non-positive timestamp', { ...bar(1), timestamp: 0 }],
    ['negative timestamp', { ...bar(1), timestamp: -5 }],
    ['zero price', { ...bar(1), close: 0 }],
    ['negative volume', { ...bar(1), volume: -1 }],
    ['high below low', { ...bar(1), high: 90, low: 110 }],
    ['high below open', { ...bar(1), open: 200, high: 150, low: 90, close: 100 }],
    ['low above close', { ...bar(1), open: 100, high: 210, low: 105, close: 100 }],
    ['string close', { ...bar(1), close: '100' as unknown as number }],
  ])('rejects %s', (_label, candidate) => {
    expect(isValidBar(candidate as ChartBar | null)).toBe(false);
  });
});

describe('bar normalization (normalizeBars)', () => {
  it('sorts ascending by timestamp', () => {
    const { bars } = normalizeBars([bar(3_000), bar(1_000), bar(2_000)]);
    expect(bars.map((b) => b.timestamp)).toEqual([1_000, 2_000, 3_000]);
  });

  it('de-duplicates timestamps, last occurrence wins', () => {
    const { bars, duplicates } = normalizeBars([bar(1_000, 100), bar(1_000, 111), bar(2_000, 120)]);
    expect(bars).toHaveLength(2);
    expect(duplicates).toBe(1);
    expect(bars[0]!.close).toBe(111);
  });

  it('drops invalid bars and counts them', () => {
    const { bars, rejected } = normalizeBars([
      bar(1_000),
      { ...bar(2_000), high: 1, low: 999 },
      null,
      { ...bar(3_000), volume: -3 },
      bar(4_000),
    ]);
    expect(bars.map((b) => b.timestamp)).toEqual([1_000, 4_000]);
    expect(rejected).toBe(3);
  });

  it('returns an empty result for empty input', () => {
    expect(normalizeBars([])).toEqual({ bars: [], rejected: 0, duplicates: 0 });
  });
});

describe('KLineChartAdapter — v10 pull-based data flow', () => {
  it('declares the market before handing over bars (pull-based engines need symbol+period)', async () => {
    const { module, instance, markets } = fakeModule();
    const { loader } = fakeLoader([bar(1_000), bar(2_000)]);
    const adapter = new KLineChartAdapter(module);
    adapter.init({} as unknown as HTMLElement);
    adapter.setDataLoader(loader);
    adapter.setSymbol('BTCUSDT');
    await settle();

    expect(markets()).toEqual([{ ticker: 'BTCUSDT', period: '15m' }]);
    const setMarketOrder = (instance.setMarket as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]!;
    const setBarsOrder = (instance.setBars as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]!;
    expect(setMarketOrder).toBeLessThan(setBarsOrder);
  });

  it('passes the initial history to the engine and reports it as ready', async () => {
    const { module, bars } = fakeModule();
    const { loader } = fakeLoader([bar(2_000), bar(1_000), bar(3_000)]);
    const adapter = new KLineChartAdapter(module);
    adapter.init({} as unknown as HTMLElement);
    adapter.setDataLoader(loader);
    adapter.setSymbol('BTCUSDT');
    await settle();

    expect(bars().map((b) => b.timestamp)).toEqual([1_000, 2_000, 3_000]);
    const s = adapter.getStatus();
    expect(s.state).toBe('ready');
    expect(s.barCount).toBe(3);
    // The engine's own view must agree — a façade that swallows data is a defect, not a no-op.
    expect(s.engineBarCount).toBe(3);
    expect(s.firstTimestamp).toBe(1_000);
    expect(s.lastTimestamp).toBe(3_000);
    expect(s.error).toBeNull();
  });

  it('sorts and de-duplicates loader output before it reaches the engine', async () => {
    const { module, bars } = fakeModule();
    const { loader } = fakeLoader([bar(2_000, 20), bar(1_000, 10), bar(2_000, 22)]);
    const adapter = new KLineChartAdapter(module);
    adapter.init({} as unknown as HTMLElement);
    adapter.setDataLoader(loader);
    adapter.setSymbol('BTCUSDT');
    await settle();

    expect(bars().map((b) => b.timestamp)).toEqual([1_000, 2_000]);
    expect(bars()[1]!.close).toBe(22);
    expect(adapter.getStatus().duplicateCount).toBe(1);
  });

  it('rejects malformed OHLCV from the loader and counts the rejections', async () => {
    const { module, bars } = fakeModule();
    const { loader } = fakeLoader([bar(1_000), { ...bar(2_000), high: 1, low: 5_000 }, bar(3_000)]);
    const adapter = new KLineChartAdapter(module);
    adapter.init({} as unknown as HTMLElement);
    adapter.setDataLoader(loader);
    adapter.setSymbol('BTCUSDT');
    await settle();

    expect(bars().map((b) => b.timestamp)).toEqual([1_000, 3_000]);
    expect(adapter.getStatus().rejectedCount).toBe(1);
    expect(adapter.getStatus().state).toBe('ready');
  });

  it('reports the empty state when the loader returns no bars', async () => {
    const { module, bars } = fakeModule();
    const { loader } = fakeLoader([]);
    const adapter = new KLineChartAdapter(module);
    adapter.init({} as unknown as HTMLElement);
    adapter.setDataLoader(loader);
    adapter.setSymbol('BTCUSDT');
    await settle();

    expect(bars()).toHaveLength(0);
    const s = adapter.getStatus();
    expect(s.state).toBe('empty');
    expect(s.barCount).toBe(0);
    expect(s.engineBarCount).toBe(0);
    expect(s.firstTimestamp).toBeNull();
  });

  it('reports the error state when the loader throws', async () => {
    const { module } = fakeModule();
    const adapter = new KLineChartAdapter(module);
    adapter.init({} as unknown as HTMLElement);
    adapter.setDataLoader({
      getBars: async () => {
        throw new Error('bff unavailable');
      },
      subscribeBar: () => () => {},
    });
    adapter.setSymbol('BTCUSDT');
    await settle();

    const s = adapter.getStatus();
    expect(s.state).toBe('error');
    expect(s.error).toBe('bff unavailable');
    expect(s.barCount).toBe(0);
    expect(s.engineBarCount).toBe(0);
  });
});

describe('KLineChartAdapter — realtime subscription', () => {
  it('pushes a realtime bar to the engine and advances the last timestamp', async () => {
    const { module, bars } = fakeModule();
    const { loader, emit } = fakeLoader([bar(1_000)]);
    const adapter = new KLineChartAdapter(module);
    adapter.init({} as unknown as HTMLElement);
    adapter.setDataLoader(loader);
    adapter.setSymbol('BTCUSDT');
    await settle();

    emit(bar(2_000));
    expect(bars().map((b) => b.timestamp)).toEqual([1_000, 2_000]);
    expect(adapter.getStatus().barCount).toBe(2);
    expect(adapter.getStatus().lastTimestamp).toBe(2_000);
  });

  it('replaces (does not append) a tick for the current bar', async () => {
    const { module, bars } = fakeModule();
    const { loader, emit } = fakeLoader([bar(1_000, 100)]);
    const adapter = new KLineChartAdapter(module);
    adapter.init({} as unknown as HTMLElement);
    adapter.setDataLoader(loader);
    adapter.setSymbol('BTCUSDT');
    await settle();

    emit(bar(1_000, 105));
    expect(bars()).toHaveLength(1);
    expect(bars()[0]!.close).toBe(105);
    expect(adapter.getStatus().barCount).toBe(1);
  });

  it('drops malformed realtime ticks instead of corrupting history', async () => {
    const { module, bars } = fakeModule();
    const { loader, emit } = fakeLoader([bar(1_000)]);
    const adapter = new KLineChartAdapter(module);
    adapter.init({} as unknown as HTMLElement);
    adapter.setDataLoader(loader);
    adapter.setSymbol('BTCUSDT');
    await settle();

    emit({ ...bar(2_000), close: Number.NaN });
    expect(bars()).toHaveLength(1);
    expect(adapter.getStatus().rejectedCount).toBe(1);
  });

  it('ignores a tick older than the current history', async () => {
    const { module, bars } = fakeModule();
    const { loader, emit } = fakeLoader([bar(5_000)]);
    const adapter = new KLineChartAdapter(module);
    adapter.init({} as unknown as HTMLElement);
    adapter.setDataLoader(loader);
    adapter.setSymbol('BTCUSDT');
    await settle();

    emit(bar(1_000));
    expect(bars().map((b) => b.timestamp)).toEqual([5_000]);
  });

  it('unsubscribes the previous realtime stream when the symbol changes', async () => {
    const { module } = fakeModule();
    const { loader, unsubCalls, subCalls } = fakeLoader();
    const adapter = new KLineChartAdapter(module);
    adapter.init({} as unknown as HTMLElement);
    adapter.setDataLoader(loader);

    adapter.setSymbol('BTCUSDT');
    await settle();
    expect(subCalls()).toBe(1);

    adapter.setSymbol('ETHUSDT');
    await settle();
    expect(unsubCalls()).toBe(1);
    expect(subCalls()).toBe(2);
  });

  it('reloads and re-subscribes when the period changes', async () => {
    const { module, instance } = fakeModule();
    const { loader, getBarsCalls, unsubCalls, subCalls } = fakeLoader();
    const adapter = new KLineChartAdapter(module);
    adapter.init({} as unknown as HTMLElement);
    adapter.setDataLoader(loader);
    adapter.setSymbol('BTCUSDT');
    await settle();

    adapter.setPeriod('1h');
    await settle();

    expect(getBarsCalls()).toEqual([
      { symbol: 'BTCUSDT', period: '15m' },
      { symbol: 'BTCUSDT', period: '1h' },
    ]);
    expect(unsubCalls()).toBe(1);
    expect(subCalls()).toBe(2);
    // The engine is re-pointed at the new market before the new history is applied.
    expect(instance.setMarket).toHaveBeenLastCalledWith({ ticker: 'BTCUSDT', period: '1h' });
    expect(adapter.getStatus().period).toBe('1h');
  });

  it('does not reload when the symbol or period is set to the current value', async () => {
    const { module } = fakeModule();
    const { loader, getBarsCalls } = fakeLoader();
    const adapter = new KLineChartAdapter(module);
    adapter.init({} as unknown as HTMLElement);
    adapter.setDataLoader(loader);
    adapter.setSymbol('BTCUSDT');
    await settle();

    adapter.setSymbol('BTCUSDT');
    adapter.setPeriod('15m');
    await settle();
    expect(getBarsCalls()).toHaveLength(1);
  });
});

describe('KLineChartAdapter — teardown', () => {
  it('dispose tears down subscription and frees the instance', async () => {
    const { module, disposed } = fakeModule();
    const { loader, unsubCalls } = fakeLoader();
    const adapter = new KLineChartAdapter(module);
    adapter.init({} as unknown as HTMLElement);
    adapter.setDataLoader(loader);
    adapter.setSymbol('BTCUSDT');
    await settle();
    adapter.dispose();
    expect(unsubCalls()).toBe(1);
    expect(disposed()).toBe(1);
  });

  it('blocks realtime callbacks that fire after dispose', async () => {
    const { module, instance } = fakeModule();
    const { loader, emit } = fakeLoader([bar(1_000)]);
    const adapter = new KLineChartAdapter(module);
    adapter.init({} as unknown as HTMLElement);
    adapter.setDataLoader(loader);
    adapter.setSymbol('BTCUSDT');
    await settle();
    const pushed = (instance.pushBar as ReturnType<typeof vi.fn>).mock.calls.length;

    adapter.dispose();
    emit(bar(2_000));
    expect((instance.pushBar as ReturnType<typeof vi.fn>).mock.calls.length).toBe(pushed);
  });

  it('blocks an in-flight history load that resolves after dispose', async () => {
    const { module, instance } = fakeModule();
    let release: (b: ChartBar[]) => void = () => {};
    const adapter = new KLineChartAdapter(module);
    adapter.init({} as unknown as HTMLElement);
    adapter.setDataLoader({
      getBars: () =>
        new Promise<ChartBar[]>((resolve) => {
          release = resolve;
        }),
      subscribeBar: () => () => {},
    });
    adapter.setSymbol('BTCUSDT');
    await settle();

    adapter.dispose();
    release([bar(1_000)]);
    await settle();
    expect(instance.setBars).not.toHaveBeenCalled();
  });

  it('does not duplicate indicators', () => {
    const { module, instance } = fakeModule();
    const adapter = new KLineChartAdapter(module);
    adapter.init({} as unknown as HTMLElement);
    adapter.createIndicator('VOL', true);
    adapter.createIndicator('VOL', true);
    expect((instance.createIndicator as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });
});

describe('KLineChartAdapter — engine contract', () => {
  it('does not call any removed klinecharts v9 data API', async () => {
    const { module, instance } = fakeModule();
    const legacy = { applyNewData: vi.fn(), applyMoreData: vi.fn(), updateData: vi.fn(), loadMore: vi.fn() };
    Object.assign(instance, legacy);
    const { loader, emit } = fakeLoader([bar(1_000)]);
    const adapter = new KLineChartAdapter(module);
    adapter.init({} as unknown as HTMLElement);
    adapter.setDataLoader(loader);
    adapter.setSymbol('BTCUSDT');
    await settle();
    emit(bar(2_000));
    adapter.setPeriod('1h');
    await settle();

    for (const [name, spy] of Object.entries(legacy)) {
      expect(spy, `adapter must not call removed v9 API ${name}`).not.toHaveBeenCalled();
    }
  });

  it('reports engineBarCount 0 when the façade accepts bars but drops them (silent no-op)', async () => {
    const { module, instance } = fakeModule();
    // Reproduce the Phase 6 defect shape: setBars is a no-op, so the engine holds nothing.
    (instance.setBars as ReturnType<typeof vi.fn>).mockImplementation(() => {});
    (instance.getBarCount as ReturnType<typeof vi.fn>).mockImplementation(() => 0);
    const { loader } = fakeLoader([bar(1_000), bar(2_000)]);
    const adapter = new KLineChartAdapter(module);
    adapter.init({} as unknown as HTMLElement);
    adapter.setDataLoader(loader);
    adapter.setSymbol('BTCUSDT');
    await settle();

    const s = adapter.getStatus();
    expect(s.barCount).toBe(2);
    // The discrepancy is observable: this is what the render E2E asserts against.
    expect(s.engineBarCount).toBe(0);
  });

  it('surfaces a null engine instead of pretending data was applied', async () => {
    const nullModule: KLineModule = { init: () => null, dispose: () => {} };
    const { loader } = fakeLoader();
    const adapter = new KLineChartAdapter(nullModule);
    adapter.init({} as unknown as HTMLElement);
    adapter.setDataLoader(loader);
    adapter.setSymbol('BTCUSDT');
    await settle();
    expect(adapter.getStatus().state).toBe('idle');
    expect(adapter.getStatus().barCount).toBe(0);
  });

  it('emits status updates to subscribers and stops after unsubscribe', async () => {
    const { module } = fakeModule();
    const { loader } = fakeLoader([bar(1_000)]);
    const adapter = new KLineChartAdapter(module);
    adapter.init({} as unknown as HTMLElement);
    adapter.setDataLoader(loader);
    const seen: string[] = [];
    const off = adapter.onStatus((s) => seen.push(s.state));
    adapter.setSymbol('BTCUSDT');
    await settle();
    expect(seen).toContain('loading');
    expect(seen).toContain('ready');

    off();
    const before = seen.length;
    adapter.setPeriod('1h');
    await settle();
    expect(seen).toHaveLength(before);
  });
});

describe('candleToBar', () => {
  it('converts decimal-string candles to numeric bars', () => {
    const candle: Candle = {
      time: 1_700_000_000_000,
      open: '68000.00',
      high: '68100.50',
      low: '67900.25',
      close: '68050.75',
      volume: '312.189',
      closed: true,
    };
    expect(candleToBar(candle)).toEqual({
      timestamp: 1_700_000_000_000,
      open: 68_000,
      high: 68_100.5,
      low: 67_900.25,
      close: 68_050.75,
      volume: 312.189,
    });
    expect(isValidBar(candleToBar(candle))).toBe(true);
  });
});
