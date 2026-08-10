/**
 * 전략 백테스트 캐시 + 팔로우 (Postgres).
 *
 * 왜 있어야 하는가
 * --------------
 * SqliteStrategyRepo 만 있던 상태에서 Postgres 배포를 돌리면, 사용자는
 * Postgres 에 있는데 팔로우는 SQLite 에 쓰려 해서 외래키가 깨졌다
 * (FOREIGN KEY constraint failed → 500). 화면에서 Follow 를 눌러도 아무 일이
 * 일어나지 않았고, 오류는 서버 로그에만 남아 눈에 띄지 않았다.
 *
 * 메서드 이름과 반환 모양을 SqliteStrategyRepo 와 **동일하게** 맞춘다.
 * 라우터가 둘을 구분하지 않고 쓸 수 있어야 하고, 모양이 다르면 저장소를
 * 갈아끼울 때 조용히 어긋난다.
 *
 * 단위 주의
 * --------
 * 시각은 epoch ms 정수다(SQLite 구현과 동일). Postgres 의 BIGINT 는
 * node-postgres 가 **문자열**로 돌려주므로 반드시 Number 로 되돌린다 —
 * 문자열이 그대로 흘러가면 화면에서 날짜 계산이 NaN 이 된다.
 */

import { randomUUID } from 'node:crypto';

import type { Pool } from 'pg';

import type { BacktestResult } from '@quantumtrade/strategy';

import type { BacktestRow, FollowRow } from './strategy-repo';

/** BIGINT(문자열) → number. null 은 그대로 둔다. */
function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** DOUBLE PRECISION 은 null 일 수 있다. 0 으로 강제하지 않는다 — 계산 불가와 0 은 다르다. */
function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

type DbBacktest = Record<string, unknown>;

/**
 * result_json 정규화.
 *
 * ★ 이 컬럼은 Postgres 에서 **jsonb** 다(0011 마이그레이션). node-postgres 가
 *   jsonb 를 파싱해서 **객체**로 돌려주는데, SQLite 구현은 문자열을 담았다.
 *   호출부가 JSON.parse(row.result_json) 를 하므로 객체를 그대로 넘기면
 *   `SyntaxError: "[object Object]" is not valid JSON` 으로 500 이 난다
 *   (실제로 겪었다 — 전략 상세가 열리지 않았다).
 *
 *   그래서 여기서 항상 문자열로 되돌린다. 저장소 계약이 "문자열" 이므로
 *   구현이 그 계약을 지켜야 한다. 호출부를 고치면 SQLite 구현과 어긋난다.
 */
function toJsonText(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v === null || v === undefined) return 'null';
  return JSON.stringify(v);
}

function mapBacktest(r: DbBacktest): BacktestRow {
  return {
    id: String(r.id),
    strategy_id: String(r.strategy_id),
    symbol: String(r.symbol),
    timeframe: String(r.timeframe),
    from_time: num(r.from_time),
    to_time: num(r.to_time),
    bar_count: num(r.bar_count),
    input_hash: String(r.input_hash),
    result_json: toJsonText(r.result_json),
    total_return_pct: num(r.total_return_pct),
    win_rate_pct: numOrNull(r.win_rate_pct),
    max_drawdown_pct: num(r.max_drawdown_pct),
    sharpe: numOrNull(r.sharpe),
    trade_count: num(r.trade_count),
    computed_at: num(r.computed_at),
  };
}

function mapFollow(r: Record<string, unknown>): FollowRow {
  return {
    id: String(r.id),
    user_id: String(r.user_id),
    strategy_id: String(r.strategy_id),
    symbol: String(r.symbol),
    timeframe: String(r.timeframe),
    note: r.note === null || r.note === undefined ? null : String(r.note),
    created_at: num(r.created_at),
  };
}

const B_COLS = `id, strategy_id, symbol, timeframe, from_time, to_time, bar_count, input_hash,
                result_json, total_return_pct, win_rate_pct, max_drawdown_pct, sharpe,
                trade_count, computed_at`;
const F_COLS = 'id, user_id, strategy_id, symbol, timeframe, note, created_at';

export class PgStrategyRepo {
  constructor(private readonly pool: Pool) {}

  /** 정확히 이 입력으로 계산된 결과. 없으면 null. */
  async findBacktest(q: {
    strategyId: string;
    symbol: string;
    timeframe: string;
    fromTime: number;
    toTime: number;
    inputHash: string;
  }): Promise<BacktestRow | null> {
    const r = await this.pool.query<DbBacktest>(
      `SELECT ${B_COLS} FROM strategy_backtests
        WHERE strategy_id=$1 AND symbol=$2 AND timeframe=$3
          AND from_time=$4 AND to_time=$5 AND input_hash=$6`,
      [q.strategyId, q.symbol, q.timeframe, q.fromTime, q.toTime, q.inputHash],
    );
    return r.rowCount ? mapBacktest(r.rows[0]!) : null;
  }

  async saveBacktest(result: BacktestResult, inputHash: string): Promise<BacktestRow> {
    const m = result.metrics;
    const row = {
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
      // NULL 로 보존한다. 종료된 거래가 없으면 승률은 정의되지 않는다 — 0% 가 아니다.
      win_rate_pct: m.winRatePct,
      max_drawdown_pct: m.maxDrawdownPct,
      sharpe: m.sharpe,
      trade_count: m.tradeCount,
      computed_at: Date.now(),
    };

    await this.pool.query(
      `INSERT INTO strategy_backtests
         (id, strategy_id, symbol, timeframe, from_time, to_time, bar_count, input_hash, result_json,
          total_return_pct, win_rate_pct, max_drawdown_pct, sharpe, trade_count, computed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (strategy_id, symbol, timeframe, input_hash, from_time, to_time) DO UPDATE SET
         result_json = excluded.result_json,
         total_return_pct = excluded.total_return_pct,
         win_rate_pct = excluded.win_rate_pct,
         max_drawdown_pct = excluded.max_drawdown_pct,
         sharpe = excluded.sharpe,
         trade_count = excluded.trade_count,
         computed_at = excluded.computed_at`,
      [
        row.id, row.strategy_id, row.symbol, row.timeframe, row.from_time, row.to_time, row.bar_count,
        row.input_hash, row.result_json, row.total_return_pct, row.win_rate_pct, row.max_drawdown_pct,
        row.sharpe, row.trade_count, row.computed_at,
      ],
    );

    // 삽입 후 다시 읽는다 — ON CONFLICT 로 갱신된 경우 id 가 기존 행의 것이다.
    const found = await this.findBacktest({
      strategyId: row.strategy_id, symbol: row.symbol, timeframe: row.timeframe,
      fromTime: row.from_time, toTime: row.to_time, inputHash: row.input_hash,
    });
    return found ?? mapBacktest(row as unknown as DbBacktest);
  }

  /**
   * 심볼·주기별로 전략마다 가장 최근 결과 하나.
   *
   * DISTINCT ON 을 쓰는 이유: SQLite 구현은 MAX(computed_at) 서브쿼리로
   * 조인하는데, 같은 시각에 두 행이 있으면 중복이 나온다. Postgres 에서는
   * DISTINCT ON 이 정확히 하나를 보장한다.
   */
  async latestPerStrategy(symbol: string, timeframe: string): Promise<BacktestRow[]> {
    const r = await this.pool.query<DbBacktest>(
      `SELECT DISTINCT ON (strategy_id) ${B_COLS}
         FROM strategy_backtests
        WHERE symbol=$1 AND timeframe=$2
        ORDER BY strategy_id, computed_at DESC`,
      [symbol, timeframe],
    );
    return r.rows.map(mapBacktest);
  }

  // ---- 팔로우 ----

  async listFollows(userId: string): Promise<FollowRow[]> {
    const r = await this.pool.query(
      `SELECT ${F_COLS} FROM strategy_follows WHERE user_id=$1 ORDER BY created_at DESC`,
      [userId],
    );
    return r.rows.map(mapFollow);
  }

  /** 멱등: 두 번 팔로우해도 오류가 아니고 행이 하나만 생긴다. */
  async follow(
    userId: string,
    input: { strategyId: string; symbol: string; timeframe: string; note?: string },
  ): Promise<FollowRow> {
    const id = randomUUID();
    const now = Date.now();
    await this.pool.query(
      `INSERT INTO strategy_follows (id, user_id, strategy_id, symbol, timeframe, note, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (user_id, strategy_id, symbol, timeframe) DO NOTHING`,
      [id, userId, input.strategyId, input.symbol, input.timeframe, input.note ?? null, now],
    );

    /*
       삽입했든 이미 있었든 현재 행을 읽어서 돌려준다.

       INSERT 의 RETURNING 을 쓰지 않는 이유: DO NOTHING 이면 아무것도
       반환되지 않아 호출자가 null 을 받는다. 그러면 화면이 "실패" 로 보고
       사용자에게 다시 누르라고 한다 — 이미 성공한 상태인데.
    */
    const r = await this.pool.query(
      `SELECT ${F_COLS} FROM strategy_follows
        WHERE user_id=$1 AND strategy_id=$2 AND symbol=$3 AND timeframe=$4`,
      [userId, input.strategyId, input.symbol, input.timeframe],
    );
    return mapFollow(r.rows[0]!);
  }

  /** 소유 범위 안에서만 해제한다. 남의 팔로우를 지울 수 없다. */
  async unfollow(userId: string, id: string): Promise<boolean> {
    const r = await this.pool.query('DELETE FROM strategy_follows WHERE user_id=$1 AND id=$2', [userId, id]);
    return (r.rowCount ?? 0) > 0;
  }

  async countFollowers(strategyId: string): Promise<number> {
    const r = await this.pool.query<{ n: string }>(
      'SELECT COUNT(*) AS n FROM strategy_follows WHERE strategy_id=$1',
      [strategyId],
    );
    return num(r.rows[0]?.n);
  }
}
