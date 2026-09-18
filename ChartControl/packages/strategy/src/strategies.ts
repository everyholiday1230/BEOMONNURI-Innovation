import { D } from '@quantumtrade/domain';
import type { BacktestBar, StrategyRules, StrategySignal } from './backtest';

/**
 * Built-in strategy definitions.
 *
 * These are **code**, not fixtures. The delivered design listed eight strategies with authors (`@byrne`,
 * `@nova`), subscription tiers (Free/Pro/VIP) and follower counts (1,240 / 2,140 / …). None of that can be
 * real here: there are no user-authored strategies, no tier system, and nobody follows anything. What CAN
 * be real is a small set of deterministic rule sets whose performance is measured by running them over
 * actual historical candles.
 *
 * Each rule set is intentionally simple and fully described in its `description`, because a strategy a user
 * cannot read is one they cannot evaluate. Parameters are fixed per definition rather than user-tunable:
 * exposing parameters invites optimising them against the same window the metrics are reported on, which
 * produces impressive numbers that mean nothing.
 */

/** Simple moving average of closes over the last `n` bars ending at `i`. */
export function sma(bars: readonly BacktestBar[], i: number, n: number): number | null {
  if (i + 1 < n) return null;
  let sum = D(0);
  for (let k = i - n + 1; k <= i; k += 1) sum = sum.add(D(bars[k]!.close));
  return Number(sum.div(n));
}

/** Wilder RSI over `n` bars ending at `i`. Returns null before enough history. */
export function rsi(bars: readonly BacktestBar[], i: number, n: number): number | null {
  if (i < n) return null;
  let gain = 0;
  let loss = 0;
  for (let k = i - n + 1; k <= i; k += 1) {
    const diff = Number(bars[k]!.close) - Number(bars[k - 1]!.close);
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  const avgGain = gain / n;
  const avgLoss = loss / n;
  // All-gains is RSI 100 by definition; dividing by a zero average loss would be Infinity.
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  const rs = avgGain / avgLoss;
  return Math.round((100 - 100 / (1 + rs)) * 100) / 100;
}

/** Highest high / lowest low over the `n` bars BEFORE `i` (excluding `i` itself). */
export function priorRange(bars: readonly BacktestBar[], i: number, n: number): { hh: number; ll: number } | null {
  if (i < n) return null;
  let hh = -Infinity;
  let ll = Infinity;
  for (let k = i - n; k < i; k += 1) {
    const h = Number(bars[k]!.high);
    const l = Number(bars[k]!.low);
    if (h > hh) hh = h;
    if (l < ll) ll = l;
  }
  return Number.isFinite(hh) && Number.isFinite(ll) ? { hh, ll } : null;
}

/** Average true range over `n` bars ending at `i`, used to place stops at a volatility-aware distance. */
export function atr(bars: readonly BacktestBar[], i: number, n: number): number | null {
  if (i < n) return null;
  let sum = 0;
  for (let k = i - n + 1; k <= i; k += 1) {
    const h = Number(bars[k]!.high);
    const l = Number(bars[k]!.low);
    const pc = Number(bars[k - 1]!.close);
    sum += Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
  }
  return sum / n;
}

/** Builds SL/TP at ATR multiples, or omits them when ATR is unavailable. */
/*
   ═══════════════════════════════════════════════════════════════════
   EMA · MACD
   ═══════════════════════════════════════════════════════════════════

   ★★★ **화면 DSL(`src/formula-dsl.js`)과 숫자가 정확히 같아야 한다.**

     고객은 같은 규칙("MACD 골든크로스")을 두 곳에서 본다 — 차트 마커와 이 백테스트.
     두 곳의 교차 위치가 다르면 어느 쪽도 믿을 수 없고, 우리가 틀린 것이 된다.
     그래서 DSL 과 **같은 정의**를 쓴다:

       · EMA 씨앗 = 처음 n개의 SMA, 그 전은 null(웜업)
         ★ 첫 봉부터 값을 내놓으면 26기간 EMA 를 3번째 봉에서도 아는 척한다.
       · DIF = EMA(close, fast) - EMA(close, slow)      → slow-1 부터 유효
       · DEA = EMA(DIF, signal)                          → (slow-1)+(signal-1) 부터
         실측(fast12/slow26/signal9): DIF 25, DEA 33 부터.
       · 교차는 **처음 비교 가능한 봉을 건너뛴다.**
         ★ 그 봉에서는 직전 관계를 알 수 없다. 판정하면 DEA 씨앗값과 아직 수렴 중인
           DIF 를 비교한 유령 교차가 잡힌다(DSL 에서 실측으로 확인했다).

   ★ 계열을 **한 번만 계산해 캐시한다.** `evaluate(bars, i)` 는 봉마다 불리므로
     매번 처음부터 계산하면 O(n²) 이 된다. 같은 배열이면 같은 결과이므로 WeakMap
     으로 캐시한다(배열이 사라지면 캐시도 함께 사라진다).
*/

/** 계열 하나에 대한 EMA. 웜업 구간은 null. */
function emaSeries(values: readonly (number | null)[], n: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (n <= 0) return out;
  const k = 2 / (n + 1);
  let seed = 0;
  let count = 0;
  let prev: number | null = null;
  for (let i = 0; i < values.length; i++) {
    const v = values[i] ?? null;
    if (v === null || !Number.isFinite(v)) continue;
    if (prev === null) {
      seed += v;
      count += 1;
      if (count >= n) { prev = seed / count; out[i] = prev; }
      continue;
    }
    prev = v * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

interface MacdSeries { dif: (number | null)[]; dea: (number | null)[] }

const macdCache = new WeakMap<readonly BacktestBar[], Map<string, MacdSeries>>();

/** MACD 계열(DIF·DEA). 같은 봉 배열·같은 파라미터면 한 번만 계산한다. */
function macdSeries(
  bars: readonly BacktestBar[],
  fast: number,
  slow: number,
  signal: number,
): MacdSeries {
  let perBars = macdCache.get(bars);
  if (!perBars) { perBars = new Map(); macdCache.set(bars, perBars); }
  const key = `${fast}/${slow}/${signal}`;
  const hit = perBars.get(key);
  if (hit) return hit;

  const closes = bars.map((b) => Number(b.close));
  const ef = emaSeries(closes, fast);
  const es = emaSeries(closes, slow);
  const dif: (number | null)[] = closes.map((_, i) => {
    const a = ef[i] ?? null; const b = es[i] ?? null;
    return a === null || b === null ? null : a - b;
  });
  const dea = emaSeries(dif, signal);
  const out: MacdSeries = { dif, dea };
  perBars.set(key, out);
  return out;
}

/**
 * 봉 i 에서의 MACD 값. 아직 계산할 수 없으면 null.
 *
 * ★ 값을 지어내지 않는다 — 웜업 구간은 null 이고, 호출부는 그때 신호를 내지 않는다.
 */
export function macd(
  bars: readonly BacktestBar[],
  i: number,
  fast = 12,
  slow = 26,
  signal = 9,
): { dif: number; dea: number } | null {
  if (i < 0 || i >= bars.length) return null;
  const s = macdSeries(bars, fast, slow, signal);
  const d = s.dif[i] ?? null; const e = s.dea[i] ?? null;
  return d === null || e === null ? null : { dif: d, dea: e };
}

/**
 * 봉 i 에서 DIF 가 DEA 를 교차했는가.
 *
 * ★★ **처음 비교 가능한 봉은 교차가 아니다.** 그 봉의 직전 관계를 알 수 없다.
 *   DSL 의 CROSS_ABOVE/CROSS_BELOW 와 같은 규칙이다.
 */
function macdCrossAt(
  bars: readonly BacktestBar[],
  i: number,
  fast: number,
  slow: number,
  signal: number,
): 'up' | 'down' | null {
  const s = macdSeries(bars, fast, slow, signal);
  const firstComparable = (() => {
    for (let k = 1; k < bars.length; k++) {
      if (s.dif[k - 1] !== null && s.dea[k - 1] !== null && s.dif[k] !== null && s.dea[k] !== null) return k;
    }
    return -1;
  })();
  if (firstComparable < 0 || i <= firstComparable) return null;
  const x0 = s.dif[i - 1] ?? null; const y0 = s.dea[i - 1] ?? null;
  const x1 = s.dif[i] ?? null; const y1 = s.dea[i] ?? null;
  if (x0 === null || y0 === null || x1 === null || y1 === null) return null;
  /* ★ 표준 정의: 직전에 작거나 같았고 지금 크다. 같았다가 벌어지는 것도 교차다. */
  if (x0 <= y0 && x1 > y1) return 'up';
  if (x0 >= y0 && x1 < y1) return 'down';
  return null;
}

function protectiveLevels(
  side: 'long' | 'short',
  close: number,
  atrValue: number | null,
  stopMult: number,
  targetMult: number,
): { stopLoss?: string; takeProfit?: string } {
  if (atrValue === null || !(atrValue > 0)) return {};
  const sl = side === 'long' ? close - atrValue * stopMult : close + atrValue * stopMult;
  const tp = side === 'long' ? close + atrValue * targetMult : close - atrValue * targetMult;
  if (sl <= 0 || tp <= 0) return {};
  return { stopLoss: String(sl), takeProfit: String(tp) };
}

/**
 * SMA crossover trend follower.
 *
 * Long when the fast SMA is above the slow SMA and was not on the previous bar; short on the mirror. Stops
 * and targets at ATR multiples, so a quiet market gets a tight stop and a volatile one a wide one.
 */
export const smaCross: StrategyRules = {
  id: 'sma-cross-20-50',
  name: 'SMA 20/50 크로스',
  description:
    '20봉 단순이동평균이 50봉을 상향 돌파하면 롱, 하향 돌파하면 숏. 손절은 ATR(14)의 2배, 익절은 3배 거리에 둡니다. ' +
    '추세 추종 전략이므로 횡보장에서 연속 손실이 발생합니다.',
  nameKey: 'strat_sma_cross_20_50_name',
  descriptionKey: 'strat_sma_cross_20_50_desc',
  warmup: 50,
  evaluate(bars, i) {
    const fastNow = sma(bars, i, 20);
    const slowNow = sma(bars, i, 50);
    const fastPrev = sma(bars, i - 1, 20);
    const slowPrev = sma(bars, i - 1, 50);
    if (fastNow === null || slowNow === null || fastPrev === null || slowPrev === null) return null;
    const close = Number(bars[i]!.close);
    const a = atr(bars, i, 14);
    if (fastPrev <= slowPrev && fastNow > slowNow) {
      return { barIndex: i, side: 'long', ...protectiveLevels('long', close, a, 2, 3) };
    }
    if (fastPrev >= slowPrev && fastNow < slowNow) {
      return { barIndex: i, side: 'short', ...protectiveLevels('short', close, a, 2, 3) };
    }
    return null;
  },
};

/**
 * RSI mean reversion.
 *
 * Buys oversold and sells overbought. Mean reversion is the mirror risk of trend following: it wins often
 * and loses large, which is why the win rate and the max drawdown must be read together.
 */
export const rsiReversion: StrategyRules = {
  id: 'rsi-reversion-14',
  name: 'RSI(14) 평균회귀',
  description:
    'RSI(14)가 30 아래로 내려가면 롱, 70 위로 올라가면 숏. 손절 ATR(14)×1.5, 익절 ATR×1.5. ' +
    '승률은 높지만 추세장에서 큰 손실이 나는 구조이므로 최대낙폭과 함께 보아야 합니다.',
  nameKey: 'strat_rsi_reversion_14_name',
  descriptionKey: 'strat_rsi_reversion_14_desc',
  warmup: 20,
  evaluate(bars, i) {
    const r = rsi(bars, i, 14);
    const rPrev = rsi(bars, i - 1, 14);
    if (r === null || rPrev === null) return null;
    const close = Number(bars[i]!.close);
    const a = atr(bars, i, 14);
    if (rPrev >= 30 && r < 30) return { barIndex: i, side: 'long', ...protectiveLevels('long', close, a, 1.5, 1.5) };
    if (rPrev <= 70 && r > 70) return { barIndex: i, side: 'short', ...protectiveLevels('short', close, a, 1.5, 1.5) };
    return null;
  },
};

/**
 * Donchian breakout.
 *
 * Enters on a close beyond the prior N-bar range. The range deliberately EXCLUDES the current bar, because
 * including it makes every breakout trivially true.
 */
export const donchianBreakout: StrategyRules = {
  id: 'donchian-breakout-20',
  name: '돈치안 20봉 돌파',
  description:
    '직전 20봉의 최고가를 종가가 돌파하면 롱, 최저가를 하향 돌파하면 숏. 손절 ATR(14)×2, 익절 ATR×4. ' +
    '돌파 실패(가짜 돌파)가 잦아 승률은 낮고, 소수의 큰 추세에서 수익이 나는 구조입니다.',
  nameKey: 'strat_donchian_breakout_20_name',
  descriptionKey: 'strat_donchian_breakout_20_desc',
  warmup: 25,
  evaluate(bars, i) {
    const range = priorRange(bars, i, 20);
    if (range === null) return null;
    const close = Number(bars[i]!.close);
    const a = atr(bars, i, 14);
    if (close > range.hh) return { barIndex: i, side: 'long', ...protectiveLevels('long', close, a, 2, 4) };
    if (close < range.ll) return { barIndex: i, side: 'short', ...protectiveLevels('short', close, a, 2, 4) };
    return null;
  },
};

/**
 * Long-only buy and hold, as a benchmark.
 *
 * Included on purpose. A gallery of strategies without a benchmark lets any positive return look like skill;
 * most of these will underperform simply holding the asset over a rising window, and the user should be able
 * to see that in the same units.
 */
export const buyAndHold: StrategyRules = {
  id: 'buy-and-hold',
  name: '단순 보유 (벤치마크)',
  description:
    '첫 봉에 롱 진입 후 청산하지 않습니다. 전략이 아니라 비교 기준입니다. ' +
    '다른 전략의 수익률은 이 값과 비교해야 의미가 있습니다.',
  nameKey: 'strat_buy_and_hold_name',
  descriptionKey: 'strat_buy_and_hold_desc',
  warmup: 1,
  evaluate(_bars, i) {
    // Only the first eligible bar produces a signal; there is no exit rule, so the runner closes it at the
    // end of data.
    return i === 1 ? ({ barIndex: i, side: 'long' } satisfies StrategySignal) : null;
  },
};

export const BUILT_IN_STRATEGIES: readonly StrategyRules[] = [
  smaCross,
  rsiReversion,
  donchianBreakout,
  buyAndHold,
];

export function findStrategy(id: string): StrategyRules | undefined {
  return BUILT_IN_STRATEGIES.find((s) => s.id === id);
}

/**
 * Catalogue metadata, for the gallery listing.
 *
 * Deliberately carries NO performance figures. Metrics exist only as the output of a backtest over a stated
 * window, so a card cannot show a Sharpe without one having been run.
 */
export interface StrategyCatalogEntry {
  id: string;
  name: string;
  description: string;
  /*
     ★ Translation keys for `name` / `description`.

       The catalogue is returned by the API verbatim, and the API does not know
       the caller's language. Without keys the Korean names reached the English
       and Japanese screens (confirmed on /ai-strategies).

       Optional so a rule set without dictionary entries stays valid — the
       client falls back to the raw strings in that case.
  */
  nameKey?: string;
  descriptionKey?: string;
  warmup: number;
  /** `trend` | `mean-reversion` | `breakout` | `benchmark` */
  category: string;
  /** Always 'built-in': there is no user-authored strategy feature. */
  author: 'built-in';
}

/**
 * MACD 교차 추세 추종.
 *
 * DIF(12/26)가 신호선(9)을 상향 교차하면 롱, 하향 교차하면 숏. 손절은 ATR(14)의 2배,
 * 익절은 3배 거리에 둔다 — SMA 교차 전략과 같은 보호 기준이라 두 전략의 성과 차이가
 * **신호 차이에서만** 나오게 한다.
 *
 * ★★ 이 전략을 넣은 이유: 운영자가 가장 많이 요청한 규칙이 "MACD 골든크로스면 매수,
 *   데드크로스면 매도" 다. 고객이 직접 쓰는 신호 규칙(DSL)으로도 같은 것을 만들 수
 *   있지만, **성과를 먼저 볼 수 있어야** 판단이 된다. 백테스트가 그 자리다.
 *
 * ★★★ 교차 판정은 화면 DSL 과 **같은 정의**를 쓴다(위 macd/macdCrossAt 주석 참고).
 *   같은 규칙이 두 곳에서 다른 곳을 가리키면 둘 다 못 믿는다.
 *
 * ★ 추세 추종이므로 횡보장에서 연속 손실이 난다. 설명에 그것을 적는다 — 승률만 보고
 *   고르면 최대낙폭에서 놀란다.
 */
export const macdCross: StrategyRules = {
  id: 'macd-cross-12-26-9',
  name: 'MACD 교차 (12/26/9)',
  description:
    'MACD 선(12/26)이 신호선(9)을 상향 돌파하면 롱, 하향 돌파하면 숏. 손절은 ATR(14)의 2배, '
    + '익절은 3배 거리에 둡니다. 추세 추종 전략이므로 횡보장에서 연속 손실이 발생합니다.',
  nameKey: 'strat_macd_cross_12_26_9_name',
  descriptionKey: 'strat_macd_cross_12_26_9_desc',
  /*
     ★ 웜업 = slow + signal 여유. DIF 는 25, DEA 는 33 부터 유효하고 교차는 그 뒤부터
       가능하므로 넉넉히 잡는다. 부족하게 잡으면 백테스트가 웜업 구간을 거래 구간으로
       세어 실제보다 짧은 표본을 쓴다.
  */
  warmup: 40,
  evaluate(bars, i) {
    const cross = macdCrossAt(bars, i, 12, 26, 9);
    if (cross === null) return null;
    const close = Number(bars[i]!.close);
    const a = atr(bars, i, 14);
    const side: 'long' | 'short' = cross === 'up' ? 'long' : 'short';
    return { barIndex: i, side, ...protectiveLevels(side, close, a, 2, 3) };
  },
};

export const STRATEGY_CATALOG: readonly StrategyCatalogEntry[] = [
  { id: smaCross.id, name: smaCross.name, description: smaCross.description, nameKey: smaCross.nameKey, descriptionKey: smaCross.descriptionKey, warmup: smaCross.warmup, category: 'trend', author: 'built-in' },
  { id: rsiReversion.id, name: rsiReversion.name, description: rsiReversion.description, nameKey: rsiReversion.nameKey, descriptionKey: rsiReversion.descriptionKey, warmup: rsiReversion.warmup, category: 'mean-reversion', author: 'built-in' },
  { id: donchianBreakout.id, name: donchianBreakout.name, description: donchianBreakout.description, nameKey: donchianBreakout.nameKey, descriptionKey: donchianBreakout.descriptionKey, warmup: donchianBreakout.warmup, category: 'breakout', author: 'built-in' },
  { id: macdCross.id, name: macdCross.name, description: macdCross.description, nameKey: macdCross.nameKey, descriptionKey: macdCross.descriptionKey, warmup: macdCross.warmup, category: 'trend', author: 'built-in' },
  { id: buyAndHold.id, name: buyAndHold.name, description: buyAndHold.description, nameKey: buyAndHold.nameKey, descriptionKey: buyAndHold.descriptionKey, warmup: buyAndHold.warmup, category: 'benchmark', author: 'built-in' },
];
