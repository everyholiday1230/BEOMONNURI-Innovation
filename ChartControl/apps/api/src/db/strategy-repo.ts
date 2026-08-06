import { createHash, randomUUID } from 'node:crypto';
import type { BacktestConfig, BacktestResult } from '@quantumtrade/strategy';
import type { DB } from './sqlite';

/**
 * Strategy backtest cache and follow state (G6).
 *
 * The cache key is the FULL set of inputs — strategy, symbol, timeframe, window and a hash of the config.
 * A backtest is only reproducible for identical inputs, so a partial key would serve numbers computed under
 * different fees or over a different window, which is the same class of error as a fabricated metric.
 */

export interface BacktestRow {
  id: string;
  strategy_id: string;
  symbol: string;
  timeframe: string;
  from_time: number;
  to_time: number;
  bar_count: number;
  input_hash: string;
  result_json: string;
  total_return_pct: number;
  win_rate_pct: number | null;
  max_drawdown_pct: number;
  sharpe: number | null;
  trade_count: number;
  computed_at: number;
}

export interface FollowRow {
  id: string;
  user_id: string;
  strategy_id: string;
  symbol: string;
  timeframe: string;
  note: string | null;
  created_at: number;
}

/**
 * Hash of the parameters that change the result.
 *
 * Sorted keys so an object-literal reordering does not invalidate every cached entry, and the values are
 * stringified exactly as stored — a `0.0006` vs `0.00060` difference IS a different input.
 */
export function hashConfig(config: BacktestConfig): string {
  const canonical = JSON.stringify({
    initialEquity: config.initialEquity,
    positionFraction: config.positionFraction,
    takerFee: config.takerFee,
    slippage: config.slippage,
    barsPerYear: config.barsPerYear,
  });
  return createHash('sha256').update(canonical).digest('hex').slice(0, 32);
}

export class SqliteStrategyRepo {
  constructor(private readonly db: DB) {}

  /** Cached result for exactly these inputs, or null. */
  findBacktest(q: {
    strategyId: string;
    symbol: string;
    timeframe: string;
    fromTime: number;
    toTime: number;
    inputHash: string;
  }): BacktestRow | null {
    return (
      (this.db
        .prepare(
          `SELECT * FROM strategy_backtests
           WHERE strategy_id=? AND symbol=? AND timeframe=? AND from_time=? AND to_time=? AND input_hash=?`,
        )
        .get(q.strategyId, q.symbol, q.timeframe, q.fromTime, q.toTime, q.inputHash) as BacktestRow | undefined) ?? null
    );
  }

  saveBacktest(result: BacktestResult, inputHash: string): BacktestRow {
    const m = result.metrics;
    const row: BacktestRow = {
      id: randomUUID(),
      strategy_id: result.strategyId,
      symbol: result.symbol,
      timeframe: result.timeframe,
      from_time: result.window.fromTime,
      to_time: result.window.toTime,
      bar_count: result.window.barCount,
      input_hash: inputHash,
      result_json: JSON.stringify(result),
      total_return_pct: m.totalReturnPct,
      // Preserved as NULL, not coerced to 0: no closed trade means the win rate is undefined.
      win_rate_pct: m.winRatePct,
      max_drawdown_pct: m.maxDrawdownPct,
      sharpe: m.sharpe,
      trade_count: m.tradeCount,
      computed_at: Date.now(),
    };
    this.db
      .prepare(
        `INSERT INTO strategy_backtests
           (id, strategy_id, symbol, timeframe, from_time, to_time, bar_count, input_hash, result_json,
            total_return_pct, win_rate_pct, max_drawdown_pct, sharpe, trade_count, computed_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT (strategy_id, symbol, timeframe, from_time, to_time, input_hash) DO UPDATE SET
           result_json=excluded.result_json,
           total_return_pct=excluded.total_return_pct,
           win_rate_pct=excluded.win_rate_pct,
           max_drawdown_pct=excluded.max_drawdown_pct,
           sharpe=excluded.sharpe,
           trade_count=excluded.trade_count,
           computed_at=excluded.computed_at`,
      )
      .run(
        row.id, row.strategy_id, row.symbol, row.timeframe, row.from_time, row.to_time, row.bar_count,
        row.input_hash, row.result_json, row.total_return_pct, row.win_rate_pct, row.max_drawdown_pct,
        row.sharpe, row.trade_count, row.computed_at,
      );
    return this.findBacktest({
      strategyId: row.strategy_id, symbol: row.symbol, timeframe: row.timeframe,
      fromTime: row.from_time, toTime: row.to_time, inputHash: row.input_hash,
    }) ?? row;
  }

  /** Most recent cached backtest per strategy for a symbol/timeframe, for the gallery listing. */
  latestPerStrategy(symbol: string, timeframe: string): BacktestRow[] {
    return this.db
      .prepare(
        `SELECT b.* FROM strategy_backtests b
         JOIN (SELECT strategy_id, MAX(computed_at) AS c FROM strategy_backtests
               WHERE symbol=? AND timeframe=? GROUP BY strategy_id) latest
           ON latest.strategy_id = b.strategy_id AND latest.c = b.computed_at
         WHERE b.symbol=? AND b.timeframe=?`,
      )
      .all(symbol, timeframe, symbol, timeframe) as BacktestRow[];
  }

  // ---- follows ----

  listFollows(userId: string): FollowRow[] {
    return this.db
      .prepare('SELECT * FROM strategy_follows WHERE user_id=? ORDER BY created_at DESC')
      .all(userId) as FollowRow[];
  }

  /** Idempotent: following twice is not an error and does not create a second row. */
  follow(userId: string, input: { strategyId: string; symbol: string; timeframe: string; note?: string }): FollowRow {
    const existing = this.db
      .prepare('SELECT * FROM strategy_follows WHERE user_id=? AND strategy_id=? AND symbol=? AND timeframe=?')
      .get(userId, input.strategyId, input.symbol, input.timeframe) as FollowRow | undefined;
    if (existing) return existing;
    const row: FollowRow = {
      id: randomUUID(),
      user_id: userId,
      strategy_id: input.strategyId,
      symbol: input.symbol,
      timeframe: input.timeframe,
      note: input.note ?? null,
      created_at: Date.now(),
    };
    this.db
      .prepare('INSERT INTO strategy_follows (id,user_id,strategy_id,symbol,timeframe,note,created_at) VALUES (?,?,?,?,?,?,?)')
      .run(row.id, row.user_id, row.strategy_id, row.symbol, row.timeframe, row.note, row.created_at);
    return row;
  }

  /** Ownership-scoped: a user can only unfollow their own row. */
  unfollow(userId: string, id: string): boolean {
    return this.db.prepare('DELETE FROM strategy_follows WHERE user_id=? AND id=?').run(userId, id).changes > 0;
  }

  countFollowers(strategyId: string): number {
    return (
      this.db.prepare('SELECT COUNT(*) AS n FROM strategy_follows WHERE strategy_id=?').get(strategyId) as { n: number }
    ).n;
  }
}
