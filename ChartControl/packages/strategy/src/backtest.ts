import Decimal from 'decimal.js';
import { D } from '@quantumtrade/domain';

/**
 * Deterministic strategy backtester.
 *
 * This exists because the delivered design showed a strategy gallery with Sharpe ratios, 30-day returns,
 * win rates and follower counts that were **all invented fixtures** (`sharpe: 4.8`, `winRate: 92`,
 * `followers: 1240`). A gallery is the screen where a user decides where to put money, so a fabricated
 * Sharpe there is not a cosmetic problem — it is the most consequential number in the product.
 *
 * Everything this module reports is computed from real historical candles. Where a figure cannot be
 * computed honestly it is `null`, and the caveats that make a backtest different from a track record are
 * returned as data (`caveats`) rather than left to a footnote someone might drop.
 *
 * Modelling decisions, all of which make results WORSE than the naive version and are therefore the
 * conservative choice:
 *
 *  1. **Fills happen at the next bar's open, never at the signal bar's close.** A signal computed from a
 *     bar's close cannot be executed at that same close — that is lookahead, and it is the single most
 *     common way a backtest invents returns that never existed.
 *  2. **Fees are charged on both legs** at a configurable taker rate, defaulting to BitMart's published
 *     futures taker fee. A fee-free backtest overstates every high-frequency strategy enormously.
 *  3. **Slippage is charged** as a configurable fraction of the fill price. Zero slippage is not a neutral
 *     assumption; it is an optimistic one.
 *  4. **Stops and targets are evaluated intrabar with the pessimistic ordering**: when a bar's range spans
 *     both the stop and the target, the STOP is taken. The bar does not record which came first, and
 *     assuming the favourable one is how a backtest turns losses into wins.
 *  5. **Positions are closed at the final bar** so an open position cannot hide an unrealised loss.
 */

export interface BacktestBar {
  time: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}

/** A long/short entry decision produced by a rule set. */
export type SignalSide = 'long' | 'short';

export interface StrategySignal {
  /** Index of the bar whose CLOSE produced this signal. The fill is at index + 1. */
  barIndex: number;
  side: SignalSide;
  /** Optional protective levels, as decimal strings in price units. */
  stopLoss?: string;
  takeProfit?: string;
}

/**
 * A strategy is a pure function from bars to signals.
 *
 * It receives the bars up to and including `i` only — the slice is enforced by the runner, so a rule set
 * cannot accidentally read the future.
 */
export interface StrategyRules {
  id: string;
  name: string;
  /** Human description of the entry/exit logic. Shown to users verbatim. */
  description: string;
  /*
     ★★ Translation keys for the two fields above.

       `name` and `description` hold Korean prose. The API does not know the
       caller's language, so that Korean reached the English and Japanese
       screens verbatim (confirmed on /ai-strategies).

       The client renders `t(nameKey)` / `t(descriptionKey)` and only falls back
       to the raw strings when a key is absent. Keeping both means a strategy
       added without translations still shows something rather than a bare key.

     ★ These are optional so third-party or user-authored rule sets (which have
       no dictionary entry) remain valid.
  */
  nameKey?: string;
  descriptionKey?: string;
  /** Minimum bars needed before the first signal can be produced. */
  warmup: number;
  /** Called for each bar index >= warmup with the history up to that bar inclusive. */
  evaluate(history: readonly BacktestBar[], i: number): StrategySignal | null;
}

export interface BacktestConfig {
  /** Starting equity in quote currency. */
  initialEquity: string;
  /** Fraction of equity risked per trade position notional, e.g. '1' = 100% of equity as notional. */
  positionFraction: string;
  /** Taker fee per side as a fraction (0.0006 = 0.06%). */
  takerFee: string;
  /** Slippage per side as a fraction of price. */
  slippage: string;
  /** Bars per year, for annualising. Derived from the timeframe by `barsPerYear`. */
  barsPerYear: number;
}

/** BitMart published USD-M futures taker fee (0.06%) — the conservative default. */
export const DEFAULT_TAKER_FEE = '0.0006';
/** One tick of slippage on a liquid perp, expressed as a fraction. Not zero, on purpose. */
export const DEFAULT_SLIPPAGE = '0.0002';

export const DEFAULT_CONFIG: BacktestConfig = {
  initialEquity: '10000',
  positionFraction: '1',
  takerFee: DEFAULT_TAKER_FEE,
  slippage: DEFAULT_SLIPPAGE,
  barsPerYear: 365 * 24 * 4, // 15m default; callers should pass the real value
};

export interface BacktestTrade {
  side: SignalSide;
  entryBar: number;
  exitBar: number;
  entryTime: number;
  exitTime: number;
  entryPrice: string;
  exitPrice: string;
  quantity: string;
  /** Net of fees and slippage. */
  pnl: string;
  feesPaid: string;
  /** Why the position closed. */
  exitReason: 'stop' | 'target' | 'signal-flip' | 'end-of-data';
}

export interface BacktestMetrics {
  /** Net return over the tested window, in percent. */
  totalReturnPct: number;
  /** Annualised return, or null when the window is shorter than a bar-year fraction we can annualise. */
  annualizedReturnPct: number | null;
  /** Wins / decided trades, in percent. Null when no trade closed. */
  winRatePct: number | null;
  tradeCount: number;
  winCount: number;
  lossCount: number;
  /** Largest peak-to-trough equity decline, in percent. Always >= 0. */
  maxDrawdownPct: number;
  /**
   * Annualised Sharpe with a ZERO risk-free rate, computed on per-bar equity returns.
   *
   * Null when there are fewer than 2 returns or the return series has no variance. The conventions are
   * returned alongside because a Sharpe without them is not comparable to anything.
   */
  sharpe: number | null;
  sharpeConventions: { riskFreeRate: 0; basis: 'per-bar equity returns'; barsPerYear: number } | null;
  /** Sum of fees and slippage paid, in quote currency. */
  totalFees: string;
  finalEquity: string;
  /** Average win and average loss magnitudes; null when that side has no trades. */
  avgWin: string | null;
  avgLoss: string | null;
  /** Reward-to-risk from the averages. Null unless BOTH sides have trades. */
  profitFactor: number | null;
}

export interface BacktestResult {
  strategyId: string;
  symbol: string;
  timeframe: string;
  /** The window actually used, after warmup. */
  window: { fromTime: number; toTime: number; barCount: number; warmupBars: number };
  config: BacktestConfig;
  trades: BacktestTrade[];
  metrics: BacktestMetrics;
  /** Equity after each bar, for a curve. Decimal strings. */
  equityCurve: { time: number; equity: string }[];
  /**
   * Statements a reader must have to interpret the numbers.
   *
   * Returned as data so they travel with the result into the API response and the UI, instead of living in
   * a footnote that gets dropped when someone reformats a card.
   */
  caveats: string[];
}

/** Bars per year for a timeframe, used to annualise. */
export function barsPerYear(timeframe: string): number {
  const minutes: Record<string, number> = {
    '1m': 1, '3m': 3, '5m': 5, '15m': 15, '30m': 30,
    '1h': 60, '2h': 120, '4h': 240, '1d': 1440, '1w': 10080,
  };
  const m = minutes[timeframe] ?? 15;
  return Math.round((365 * 24 * 60) / m);
}

/*
   백테스트 주의문.

   ★★ 문장이 아니라 **번역 키**를 둔다.

     전에는 한국어 문장 배열이었다. 이 목록은 API 응답에 그대로 실려 화면에
     표시되는데, 서버는 요청 언어를 모른다. 그래서 영어·일본어 화면에도
     한국어가 나왔다(실측으로 /ai-strategies 에서 확인).

     이 문구들은 "과거 시뮬레이션이며 미래 성과가 아니다" 를 알리는 위험
     안내다. 읽지 못하는 언어로 나오면 안내를 하지 않은 것과 같다.

   ★ 키 이름은 순서를 담지 않는다(bt_caveat_1 같은 형태를 쓰지 않는다).
     중간에 하나를 지우면 나머지 번호가 밀려 다른 문장이 표시된다.
*/
export const BACKTEST_CAVEATS: readonly string[] = [
  'bt_caveat_simulation',
  'bt_caveat_next_open',
  'bt_caveat_fees',
  'bt_caveat_stop_first',
  'bt_caveat_no_funding',
  'bt_caveat_force_close',
  'bt_caveat_window_bound',
];


/**
 * Runs a strategy over bars.
 *
 * Throws on inputs it cannot honestly test rather than returning a zeroed result that would render as a
 * flat, loss-free equity curve.
 */
export function runBacktest(
  rules: StrategyRules,
  bars: readonly BacktestBar[],
  symbol: string,
  timeframe: string,
  configIn: Partial<BacktestConfig> = {},
): BacktestResult {
  const config: BacktestConfig = { ...DEFAULT_CONFIG, barsPerYear: barsPerYear(timeframe), ...configIn };

  if (bars.length <= rules.warmup + 1) {
    throw new Error(
      `not enough bars: ${bars.length} supplied, strategy needs more than ${rules.warmup + 1} (warmup ${rules.warmup} + 1 fill bar)`,
    );
  }

  const fee: Decimal = D(config.takerFee);
  const slip: Decimal = D(config.slippage);
  const fraction: Decimal = D(config.positionFraction);

  // Annotated explicitly: `equity` is reassigned inside `closeAt`, which itself reads the open position's
  // decimals, and TypeScript reports that loop as a circular inference (TS7022) without the annotation.
  let equity: Decimal = D(config.initialEquity);
  let feesTotal: Decimal = D(0);
  const trades: BacktestTrade[] = [];
  const equityCurve: { time: number; equity: string }[] = [];

  interface Open {
    side: SignalSide;
    entryBar: number;
    entryTime: number;
    entryPrice: Decimal;
    quantity: Decimal;
    stopLoss: Decimal | null;
    takeProfit: Decimal | null;
  }
  let open: Open | null = null;

  const closeAt = (
    exitPriceRaw: Decimal,
    i: number,
    reason: BacktestTrade['exitReason'],
  ): void => {
    if (!open) return;
    // Slippage always works against us on both entry and exit.
    const exitPrice = open.side === 'long' ? exitPriceRaw.mul(D(1).sub(slip)) : exitPriceRaw.mul(D(1).add(slip));
    const gross =
      open.side === 'long'
        ? exitPrice.sub(open.entryPrice).mul(open.quantity)
        : open.entryPrice.sub(exitPrice).mul(open.quantity);
    const exitFee = exitPrice.mul(open.quantity).mul(fee);
    const entryFee = open.entryPrice.mul(open.quantity).mul(fee);
    const net = gross.sub(exitFee).sub(entryFee);
    feesTotal = feesTotal.add(exitFee).add(entryFee);
    equity = equity.add(net);
    trades.push({
      side: open.side,
      entryBar: open.entryBar,
      exitBar: i,
      entryTime: open.entryTime,
      exitTime: bars[i]!.time,
      entryPrice: open.entryPrice.toString(),
      exitPrice: exitPrice.toString(),
      quantity: open.quantity.toString(),
      pnl: net.toString(),
      feesPaid: entryFee.add(exitFee).toString(),
      exitReason: reason,
    });
    open = null;
  };

  /** Signal produced at bar i, to be filled at bar i+1's open. */
  let pending: StrategySignal | null = null;

  for (let i = 0; i < bars.length; i += 1) {
    const bar = bars[i]!;

    // --- 1) fill any pending signal at THIS bar's open (never the signal bar's close).
    if (pending !== null) {
      const fillRaw: Decimal = D(bar.open);
      const side = pending.side;
      if (open !== null && open.side !== side) {
        // Opposite signal closes the existing position first, at the same open.
        closeAt(fillRaw, i, 'signal-flip');
      }
      if (open === null) {
        const entryPrice: Decimal = side === 'long' ? fillRaw.mul(D(1).add(slip)) : fillRaw.mul(D(1).sub(slip));
        const notional: Decimal = equity.mul(fraction);
        const quantity: Decimal = entryPrice.gt(0) ? notional.div(entryPrice) : D(0);
        if (quantity.gt(0)) {
          open = {
            side,
            entryBar: i,
            entryTime: bar.time,
            entryPrice,
            quantity,
            stopLoss: pending.stopLoss === undefined ? null : D(pending.stopLoss),
            takeProfit: pending.takeProfit === undefined ? null : D(pending.takeProfit),
          };
        }
      }
      pending = null;
    }

    // --- 2) intrabar stop/target, pessimistic ordering.
    if (open !== null) {
      const high = D(bar.high);
      const low = D(bar.low);
      const hitStop =
        open.stopLoss !== null &&
        (open.side === 'long' ? low.lte(open.stopLoss) : high.gte(open.stopLoss));
      const hitTarget =
        open.takeProfit !== null &&
        (open.side === 'long' ? high.gte(open.takeProfit) : low.lte(open.takeProfit));

      if (hitStop) {
        // Stop wins the tie. The bar does not say which price came first, and assuming the target would
        // convert real losses into fabricated wins.
        closeAt(open.stopLoss!, i, 'stop');
      } else if (hitTarget) {
        closeAt(open.takeProfit!, i, 'target');
      }
    }

    // --- 3) mark equity AFTER any close, using this bar's close for an open position.
    const marked =
      open === null
        ? equity
        : open.side === 'long'
          ? equity.add(D(bar.close).sub(open.entryPrice).mul(open.quantity))
          : equity.add(open.entryPrice.sub(D(bar.close)).mul(open.quantity));
    equityCurve.push({ time: bar.time, equity: marked.toString() });

    // --- 4) evaluate the rules on history up to and including i. The slice is what prevents lookahead.
    if (i >= rules.warmup && i < bars.length - 1) {
      pending = rules.evaluate(bars.slice(0, i + 1), i);
    }
  }

  // Force-close at the end so an open position cannot hide an unrealised loss.
  if (open !== null) {
    closeAt(D(bars[bars.length - 1]!.close), bars.length - 1, 'end-of-data');
    const last = equityCurve[equityCurve.length - 1];
    if (last) last.equity = equity.toString();
  }

  const metrics = computeMetrics(equityCurve, trades, config, feesTotal.toString(), equity.toString());

  return {
    strategyId: rules.id,
    symbol,
    timeframe,
    window: {
      fromTime: bars[0]!.time,
      toTime: bars[bars.length - 1]!.time,
      barCount: bars.length,
      warmupBars: rules.warmup,
    },
    config,
    trades,
    metrics,
    equityCurve,
    caveats: [...BACKTEST_CAVEATS],
  };
}

export function computeMetrics(
  equityCurve: readonly { time: number; equity: string }[],
  trades: readonly BacktestTrade[],
  config: BacktestConfig,
  totalFees: string,
  finalEquity: string,
): BacktestMetrics {
  const initial = D(config.initialEquity);
  const final = D(finalEquity);
  const totalReturnPct = initial.gt(0)
    ? Number(final.sub(initial).div(initial).mul(100).toFixed(4))
    : 0;

  // Max drawdown from the equity curve, peak-to-trough.
  let peak = initial;
  let maxDD = 0;
  for (const p of equityCurve) {
    const e = D(p.equity);
    if (e.gt(peak)) peak = e;
    if (peak.gt(0)) {
      const dd = Number(peak.sub(e).div(peak).mul(100).toFixed(4));
      if (dd > maxDD) maxDD = dd;
    }
  }

  const wins = trades.filter((t) => Number(t.pnl) > 0);
  const losses = trades.filter((t) => Number(t.pnl) < 0);
  const decided = wins.length + losses.length;

  const sumOf = (rows: readonly BacktestTrade[]) => rows.reduce((a, t) => a.add(D(t.pnl)), D(0));
  const avgWin = wins.length > 0 ? sumOf(wins).div(wins.length).toString() : null;
  // Magnitude, so the UI does not have to decide whether a "loss" is negative.
  const avgLoss = losses.length > 0 ? sumOf(losses).abs().div(losses.length).toString() : null;

  // Per-bar returns for Sharpe. Fewer than 2 points, or zero variance, means no Sharpe — not zero.
  const rets: number[] = [];
  for (let i = 1; i < equityCurve.length; i += 1) {
    const prev = Number(equityCurve[i - 1]!.equity);
    const cur = Number(equityCurve[i]!.equity);
    if (prev > 0 && Number.isFinite(cur)) rets.push(cur / prev - 1);
  }
  let sharpe: number | null = null;
  if (rets.length >= 2) {
    const mean = rets.reduce((a, r) => a + r, 0) / rets.length;
    const variance = rets.reduce((a, r) => a + (r - mean) ** 2, 0) / (rets.length - 1);
    const sd = Math.sqrt(variance);
    if (sd > 0) {
      // Risk-free rate 0, annualised by sqrt(barsPerYear). Both stated in `sharpeConventions`.
      sharpe = Math.round((mean / sd) * Math.sqrt(config.barsPerYear) * 100) / 100;
    }
  }

  // Annualise only when the window is long enough for it to mean anything.
  const years = equityCurve.length / config.barsPerYear;
  let annualizedReturnPct: number | null = null;
  if (years >= 1 / 12 && initial.gt(0) && final.gt(0)) {
    annualizedReturnPct = Math.round((Math.pow(Number(final.div(initial)), 1 / years) - 1) * 100 * 100) / 100;
  }

  const profitFactor =
    avgWin !== null && avgLoss !== null && Number(avgLoss) > 0
      ? Math.round((Number(avgWin) / Number(avgLoss)) * 100) / 100
      : null;

  return {
    totalReturnPct,
    annualizedReturnPct,
    // Null, not 0: no closed trade means the win rate is undefined, and 0% would read as "every trade lost".
    winRatePct: decided > 0 ? Math.round((wins.length / decided) * 10000) / 100 : null,
    tradeCount: trades.length,
    winCount: wins.length,
    lossCount: losses.length,
    maxDrawdownPct: maxDD,
    sharpe,
    sharpeConventions:
      sharpe === null ? null : { riskFreeRate: 0, basis: 'per-bar equity returns', barsPerYear: config.barsPerYear },
    totalFees,
    finalEquity,
    avgWin,
    avgLoss,
    profitFactor,
  };
}
