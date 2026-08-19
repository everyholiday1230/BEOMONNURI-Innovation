import { describe, it, expect } from 'vitest';
import {
  BACKTEST_CAVEATS,
  DEFAULT_SLIPPAGE,
  DEFAULT_TAKER_FEE,
  barsPerYear,
  runBacktest,
  type BacktestBar,
  type StrategyRules,
} from '../backtest';
import {
  BUILT_IN_STRATEGIES,
  STRATEGY_CATALOG,
  atr,
  buyAndHold,
  donchianBreakout,
  findStrategy,
  priorRange,
  rsi,
  rsiReversion,
  sma,
  smaCross,
} from '../strategies';

/**
 * Backtester.
 *
 * The delivered design's strategy gallery showed Sharpe ratios, 30-day returns and win rates that were all
 * invented fixtures. A gallery is where a user decides where to put money, so these tests are less about
 * "does it run" and more about pinning the properties that stop a backtest from inventing returns:
 * no lookahead, fees and slippage charged, stop-before-target on an ambiguous bar, and open positions
 * force-closed.
 */

/** Bars with an explicit shape so each test states exactly the price path it is asserting about. */
const bar = (time: number, o: number, h: number, l: number, c: number, v = 1): BacktestBar => ({
  time,
  open: String(o),
  high: String(h),
  low: String(l),
  close: String(c),
  volume: String(v),
});

/** A rule set that fires once at a chosen bar, for isolating fill mechanics. */
const oneShot = (
  at: number,
  side: 'long' | 'short',
  levels: { stopLoss?: string; takeProfit?: string } = {},
): StrategyRules => ({
  id: 'test-one-shot',
  name: 'one shot',
  description: 'test',
  warmup: 0,
  evaluate: (_bars, i) => (i === at ? { barIndex: i, side, ...levels } : null),
});

const NO_COST = { takerFee: '0', slippage: '0', initialEquity: '1000', positionFraction: '1' };

describe('BT-01 no lookahead: fills use the NEXT bar open', () => {
  it('[1] a signal at bar 1 fills at bar 2 open, not bar 1 close', () => {
    const bars = [
      bar(1, 100, 100, 100, 100),
      bar(2, 100, 100, 100, 200), // signal bar: close 200
      bar(3, 150, 150, 150, 150), // fill bar: open 150
      bar(4, 150, 150, 150, 150),
    ];
    const r = runBacktest(oneShot(1, 'long'), bars, 'X', '15m', NO_COST);
    expect(r.trades).toHaveLength(1);
    // Filling at the signal bar's close (200) would be lookahead — the price is only known once the bar is
    // complete, at which point it can no longer be traded.
    expect(Number(r.trades[0]!.entryPrice)).toBe(150);
    expect(r.trades[0]!.entryBar).toBe(2);
  });

  it('[2] the rule set only ever sees history up to its own bar', () => {
    let maxSeen = -1;
    const spy: StrategyRules = {
      id: 'spy',
      name: 'spy',
      description: 'records the largest index visible',
      warmup: 0,
      evaluate: (history, i) => {
        maxSeen = Math.max(maxSeen, history.length - 1 - i);
        return null;
      },
    };
    const bars = Array.from({ length: 10 }, (_, k) => bar(k + 1, 100, 101, 99, 100));
    runBacktest(spy, bars, 'X', '15m', NO_COST);
    // history.length - 1 must equal i: not one bar of the future is reachable.
    expect(maxSeen).toBe(0);
  });
});

describe('BT-02 costs are charged, both sides', () => {
  it('[1] a flat round trip LOSES money once fees and slippage apply', () => {
    const bars = [
      bar(1, 100, 100, 100, 100),
      bar(2, 100, 100, 100, 100),
      bar(3, 100, 100, 100, 100),
      bar(4, 100, 100, 100, 100),
    ];
    const r = runBacktest(oneShot(1, 'long'), bars, 'X', '15m', { initialEquity: '1000' });
    // Price never moved. A cost-free backtest would report exactly 0 and make every scalping strategy look
    // free; with fees + slippage the same path is a real loss.
    expect(r.metrics.totalReturnPct).toBeLessThan(0);
    expect(Number(r.metrics.totalFees)).toBeGreaterThan(0);
  });

  it('[2] the defaults are not zero', () => {
    expect(Number(DEFAULT_TAKER_FEE)).toBeGreaterThan(0);
    // Zero slippage is an optimistic assumption, not a neutral one.
    expect(Number(DEFAULT_SLIPPAGE)).toBeGreaterThan(0);
  });

  it('[3] slippage moves the fill against the trader on both legs', () => {
    const bars = [bar(1, 100, 100, 100, 100), bar(2, 100, 100, 100, 100), bar(3, 100, 100, 100, 100), bar(4, 100, 100, 100, 100)];
    const long = runBacktest(oneShot(1, 'long'), bars, 'X', '15m', { takerFee: '0', slippage: '0.01', initialEquity: '1000' });
    // A long pays more than the quoted open.
    expect(Number(long.trades[0]!.entryPrice)).toBeGreaterThan(100);
    const short = runBacktest(oneShot(1, 'short'), bars, 'X', '15m', { takerFee: '0', slippage: '0.01', initialEquity: '1000' });
    // A short receives less.
    expect(Number(short.trades[0]!.entryPrice)).toBeLessThan(100);
  });
});

describe('BT-03 ambiguous bars resolve pessimistically', () => {
  it('[1] a bar spanning BOTH stop and target counts as a stop', () => {
    const bars = [
      bar(1, 100, 100, 100, 100),
      bar(2, 100, 100, 100, 100),
      // Fill at 100, then a bar whose range covers both 90 (stop) and 110 (target).
      bar(3, 100, 115, 85, 100),
      bar(4, 100, 100, 100, 100),
    ];
    const r = runBacktest(oneShot(1, 'long', { stopLoss: '90', takeProfit: '110' }), bars, 'X', '15m', NO_COST);
    expect(r.trades).toHaveLength(1);
    // The bar does not record which price came first. Assuming the target is how a backtest converts real
    // losses into fabricated wins.
    expect(r.trades[0]!.exitReason).toBe('stop');
    expect(Number(r.trades[0]!.pnl)).toBeLessThan(0);
  });

  it('[2] a target-only bar exits at the target', () => {
    const bars = [
      bar(1, 100, 100, 100, 100),
      bar(2, 100, 100, 100, 100),
      bar(3, 100, 115, 99, 110),
      bar(4, 100, 100, 100, 100),
    ];
    const r = runBacktest(oneShot(1, 'long', { stopLoss: '90', takeProfit: '110' }), bars, 'X', '15m', NO_COST);
    expect(r.trades[0]!.exitReason).toBe('target');
    expect(Number(r.trades[0]!.pnl)).toBeGreaterThan(0);
  });

  it('[3] a short is stopped by the HIGH, not the low', () => {
    const bars = [
      bar(1, 100, 100, 100, 100),
      bar(2, 100, 100, 100, 100),
      bar(3, 100, 112, 100, 105),
      bar(4, 100, 100, 100, 100),
    ];
    const r = runBacktest(oneShot(1, 'short', { stopLoss: '110', takeProfit: '90' }), bars, 'X', '15m', NO_COST);
    expect(r.trades[0]!.exitReason).toBe('stop');
  });
});

describe('BT-04 an open position cannot hide a loss', () => {
  it('[1] a position with no exit rule is force-closed at the last bar', () => {
    const bars = [
      bar(1, 100, 100, 100, 100),
      bar(2, 100, 100, 100, 100),
      bar(3, 100, 100, 100, 100),
      bar(4, 50, 50, 50, 50), // price halved
    ];
    const r = runBacktest(oneShot(1, 'long'), bars, 'X', '15m', NO_COST);
    expect(r.trades).toHaveLength(1);
    expect(r.trades[0]!.exitReason).toBe('end-of-data');
    // Leaving it open would report a flat return while the position was down 50%.
    expect(r.metrics.totalReturnPct).toBeLessThan(-40);
  });

  it('[2] an opposite signal flips the position', () => {
    const rules: StrategyRules = {
      id: 'flip',
      name: 'flip',
      description: 'long at 1, short at 3',
      warmup: 0,
      evaluate: (_b, i) => (i === 1 ? { barIndex: i, side: 'long' } : i === 3 ? { barIndex: i, side: 'short' } : null),
    };
    const bars = Array.from({ length: 7 }, (_, k) => bar(k + 1, 100, 100, 100, 100));
    const r = runBacktest(rules, bars, 'X', '15m', NO_COST);
    expect(r.trades.map((t) => t.exitReason)).toContain('signal-flip');
    expect(r.trades.some((t) => t.side === 'short')).toBe(true);
  });
});

describe('BT-05 metrics report unknown as null, never 0', () => {
  it('[1] no closed trade means no win rate', () => {
    const never: StrategyRules = { id: 'n', name: 'n', description: 'n', warmup: 0, evaluate: () => null };
    const bars = Array.from({ length: 5 }, (_, k) => bar(k + 1, 100, 100, 100, 100));
    const r = runBacktest(never, bars, 'X', '15m', NO_COST);
    expect(r.metrics.tradeCount).toBe(0);
    // 0% would read as "every trade lost".
    expect(r.metrics.winRatePct).toBeNull();
    expect(r.metrics.avgWin).toBeNull();
    expect(r.metrics.avgLoss).toBeNull();
    expect(r.metrics.profitFactor).toBeNull();
  });

  it('[2] a flat equity curve has no Sharpe', () => {
    const never: StrategyRules = { id: 'n', name: 'n', description: 'n', warmup: 0, evaluate: () => null };
    const bars = Array.from({ length: 20 }, (_, k) => bar(k + 1, 100, 100, 100, 100));
    const r = runBacktest(never, bars, 'X', '15m', NO_COST);
    // Zero variance means Sharpe is undefined, not infinite and not zero.
    expect(r.metrics.sharpe).toBeNull();
    expect(r.metrics.sharpeConventions).toBeNull();
  });

  it('[3] a reported Sharpe always carries its conventions', () => {
    const bars: BacktestBar[] = [];
    for (let k = 0; k < 300; k += 1) {
      const p = 100 + Math.sin(k / 5) * 5 + k * 0.1;
      bars.push(bar(k + 1, p, p + 1, p - 1, p));
    }
    const r = runBacktest(buyAndHold, bars, 'X', '1h', NO_COST);
    if (r.metrics.sharpe !== null) {
      // A Sharpe without a risk-free rate and an annualisation basis is not comparable to anything.
      expect(r.metrics.sharpeConventions).toEqual({
        riskFreeRate: 0,
        basis: 'per-bar equity returns',
        barsPerYear: barsPerYear('1h'),
      });
    }
  });

  it('[4] max drawdown is non-negative and reflects the trough', () => {
    const bars = [
      bar(1, 100, 100, 100, 100),
      bar(2, 100, 100, 100, 100),
      bar(3, 100, 100, 100, 100),
      bar(4, 100, 100, 50, 60),
      bar(5, 60, 60, 60, 60),
    ];
    const r = runBacktest(oneShot(1, 'long'), bars, 'X', '15m', NO_COST);
    expect(r.metrics.maxDrawdownPct).toBeGreaterThan(0);
  });

  it('[5] a short window is not annualised', () => {
    const bars = Array.from({ length: 6 }, (_, k) => bar(k + 1, 100, 101, 99, 100));
    const r = runBacktest(oneShot(1, 'long'), bars, 'X', '15m', NO_COST);
    // Six 15m bars is 90 minutes; annualising that produces a meaningless number.
    expect(r.metrics.annualizedReturnPct).toBeNull();
  });
});

describe('BT-06 inputs it cannot honestly test are refused', () => {
  it('[1] too few bars throws rather than returning a flat result', () => {
    const bars = [bar(1, 100, 100, 100, 100), bar(2, 100, 100, 100, 100)];
    // A zeroed result would render as a loss-free flat equity curve.
    expect(() => runBacktest(smaCross, bars, 'X', '15m')).toThrow(/not enough bars/u);
  });

  it('[2] the caveats travel with the result', () => {
    const bars = Array.from({ length: 10 }, (_, k) => bar(k + 1, 100, 101, 99, 100));
    const r = runBacktest(oneShot(1, 'long'), bars, 'X', '15m', NO_COST);
    // Returned as data so they cannot be dropped when a card is reformatted.
    expect(r.caveats).toEqual([...BACKTEST_CAVEATS]);
    /*
       ★ 문장이 아니라 **번역 키**를 검사한다.

         전에는 한국어 문장을 정규식으로 확인했다. 이 배열은 API 응답에 그대로
         실려 화면에 표시되는데, 서버는 요청 언어를 모르므로 한국어가 영어·
         일본어 화면에 그대로 나왔다. 그래서 키로 바꿨고, 검사도 그에 맞춘다.

       ★ 문장이 다시 들어오는 것을 막는다 — 그것이 이 회귀의 원인이었다.
    */
    for (const c of r.caveats) {
      expect(c).toMatch(/^[a-z0-9_]+$/u);
    }
    // 반드시 있어야 하는 안내: 과거 시뮬레이션이라는 사실과 lookahead 제거.
    expect(r.caveats).toContain('bt_caveat_simulation');
    expect(r.caveats).toContain('bt_caveat_next_open');
  });

  it('[3] the window actually used is reported', () => {
    const bars = Array.from({ length: 12 }, (_, k) => bar(k + 1, 100, 101, 99, 100));
    const r = runBacktest(oneShot(1, 'long'), bars, 'X', '15m', NO_COST);
    expect(r.window).toEqual({ fromTime: 1, toTime: 12, barCount: 12, warmupBars: 0 });
    expect(r.config.takerFee).toBe('0');
  });
});

describe('BT-07 indicators', () => {
  it('[1] SMA needs full history and is exact', () => {
    const bars = [bar(1, 0, 0, 0, 10), bar(2, 0, 0, 0, 20), bar(3, 0, 0, 0, 30)];
    expect(sma(bars, 1, 3)).toBeNull();
    expect(sma(bars, 2, 3)).toBe(20);
  });

  it('[2] RSI handles the all-gains case without dividing by zero', () => {
    const rising = Array.from({ length: 20 }, (_, k) => bar(k + 1, 0, 0, 0, 100 + k));
    // An average loss of 0 is RSI 100 by definition, not Infinity.
    expect(rsi(rising, 19, 14)).toBe(100);
    const flat = Array.from({ length: 20 }, (_, k) => bar(k + 1, 0, 0, 0, 100));
    expect(rsi(flat, 19, 14)).toBe(50);
  });

  it('[3] priorRange EXCLUDES the current bar', () => {
    const bars = [bar(1, 0, 10, 5, 8), bar(2, 0, 12, 6, 9), bar(3, 0, 99, 1, 50)];
    const r = priorRange(bars, 2, 2)!;
    // Including bar 2 would make every breakout trivially true.
    expect(r.hh).toBe(12);
    expect(r.ll).toBe(5);
  });

  it('[4] ATR needs a previous close', () => {
    const bars = Array.from({ length: 20 }, (_, k) => bar(k + 1, 100, 102, 98, 100));
    expect(atr(bars, 0, 14)).toBeNull();
    expect(atr(bars, 19, 14)).toBeCloseTo(4, 6);
  });
});

describe('BT-08 the catalogue carries no performance figures', () => {
  it('[1] every built-in strategy is described and findable', () => {
    expect(BUILT_IN_STRATEGIES.length).toBeGreaterThanOrEqual(4);
    for (const s of BUILT_IN_STRATEGIES) {
      expect(findStrategy(s.id)).toBe(s);
      // A strategy a user cannot read is one they cannot evaluate.
      expect(s.description.length).toBeGreaterThan(30);
      expect(s.warmup).toBeGreaterThan(0);
    }
  });

  it('[2] catalogue entries contain no metrics', () => {
    for (const e of STRATEGY_CATALOG) {
      const keys = Object.keys(e);
      // The design's cards carried pnl30 / winRate / sharpe / maxDD / followers as static fields. Metrics
      // exist only as the output of a backtest over a stated window.
      for (const forbidden of ['pnl30', 'winRate', 'sharpe', 'maxDD', 'followers', 'subscription']) {
        expect(keys).not.toContain(forbidden);
      }
      expect(e.author).toBe('built-in');
    }
  });

  it('[3] a benchmark is included so returns are comparable', () => {
    // Without one, any positive return looks like skill.
    expect(STRATEGY_CATALOG.some((e) => e.category === 'benchmark')).toBe(true);
    expect(findStrategy('buy-and-hold')).toBeTruthy();
  });

  it('[4] each rule set runs on a real-shaped series and produces coherent output', () => {
    const bars: BacktestBar[] = [];
    let p = 100;
    for (let k = 0; k < 400; k += 1) {
      // Deterministic pseudo-path: trend plus oscillation, so trend and mean-reversion both get signals.
      p = 100 + k * 0.05 + Math.sin(k / 7) * 4;
      bars.push(bar(k + 1, p, p + 1.5, p - 1.5, p + Math.cos(k / 3) * 0.5));
    }
    for (const s of [smaCross, rsiReversion, donchianBreakout, buyAndHold]) {
      const r = runBacktest(s, bars, 'BTCUSDT', '1h');
      expect(r.strategyId).toBe(s.id);
      expect(r.equityCurve).toHaveLength(bars.length);
      expect(Number.isFinite(r.metrics.totalReturnPct)).toBe(true);
      expect(r.metrics.maxDrawdownPct).toBeGreaterThanOrEqual(0);
      // Win + loss can be fewer than tradeCount (a break-even trade is neither).
      expect(r.metrics.winCount + r.metrics.lossCount).toBeLessThanOrEqual(r.metrics.tradeCount);
      // Every trade is closed.
      expect(r.trades.every((t) => t.exitBar >= t.entryBar)).toBe(true);
    }
  });

  it('[5] the same inputs produce the same result', () => {
    const bars = Array.from({ length: 200 }, (_, k) => {
      const q = 100 + Math.sin(k / 6) * 3;
      return bar(k + 1, q, q + 1, q - 1, q);
    });
    const a = runBacktest(rsiReversion, bars, 'X', '1h');
    const b = runBacktest(rsiReversion, bars, 'X', '1h');
    // Determinism is what makes a cached backtest safe to show.
    expect(JSON.stringify(a.metrics)).toBe(JSON.stringify(b.metrics));
    expect(a.trades.length).toBe(b.trades.length);
  });
});

describe('BT-09 annualisation basis', () => {
  it('[1] barsPerYear matches the timeframe', () => {
    expect(barsPerYear('1h')).toBe(365 * 24);
    expect(barsPerYear('15m')).toBe(365 * 24 * 4);
    expect(barsPerYear('1d')).toBe(365);
    // An unknown timeframe falls back rather than dividing by undefined.
    expect(barsPerYear('nope')).toBe(barsPerYear('15m'));
  });
});
