import type { Pool } from 'pg';
import type { ResourceRepo } from './resource-repo';

/**
 * R5 / BL-10 — repository contract with SQLite (dev/test) and PostgreSQL (production) implementations.
 *
 * The audit's core finding: the app runtime persists everything via synchronous better-sqlite3 repos, so
 * even after RDS is provisioned production would still write to SQLite. The correct fix is a
 * backend-abstracted, ASYNC repository contract with two implementations selected by the server (never
 * by client input). The auth layer already works this way (IUserRepository etc.); this file establishes
 * the same pattern for the Prompt 5 domains, using FAVOURITES as the reference implementation.
 *
 * Both implementations must satisfy the SAME contract test (`favorites-contract.test.ts`), which is the
 * proof that a cutover preserves behaviour: ownership isolation, de-duplication, optimistic version
 * (If-Match), the max-favourites cap, and stable ordering.
 *
 * The remaining Prompt 5 domains (preferences, notifications, order-drafts, mfa, lockouts, admin ops,
 * gateway state, ai policy) follow this exact pattern and are tracked as BL-10 (P1). This reference
 * establishes that the pattern is real and both backends pass one contract.
 */

export const MAX_FAVORITES = 64;

export interface FavoritesSet {
  symbols: string[];
  version: number;
  updatedAt: number | null;
}

export type ReplaceResult =
  | { ok: true; version: number; symbols: string[] }
  | { ok: false; reason: 'conflict' | 'tooMany'; currentVersion: number };

export interface IFavoritesRepo {
  list(userId: string): Promise<FavoritesSet>;
  replace(userId: string, symbols: readonly string[], expectedVersion?: number): Promise<ReplaceResult>;
}

/** Normalize + de-duplicate preserving caller order. Shared by both backends so the rule cannot drift. */
export function normalizeFavorites(symbols: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of symbols) {
    const s = String(raw).trim().toUpperCase();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

/**
 * Development / test implementation. Delegates to the existing synchronous ResourceRepo and wraps the
 * result in a resolved promise — the same "async interface over sync better-sqlite3" pattern the auth
 * repos use. Production must NOT use this (the startup guard refuses SQLite in production).
 */
export class SqliteFavoritesRepo implements IFavoritesRepo {
  constructor(private readonly resource: ResourceRepo) {}
  async list(userId: string): Promise<FavoritesSet> {
    return this.resource.listFavorites(userId);
  }
  async replace(userId: string, symbols: readonly string[], expectedVersion?: number): Promise<ReplaceResult> {
    return this.resource.replaceFavorites(userId, symbols, expectedVersion);
  }
}

/**
 * Production implementation — real PostgreSQL over the 0007 `user_favorites` / `user_favorites_meta`
 * tables. Parameterized queries throughout; the whole replace runs in ONE transaction; the set version
 * implements optimistic concurrency; ownership is `user_id = $1` on every statement.
 */
export class PgFavoritesRepo implements IFavoritesRepo {
  constructor(private readonly pool: Pool) {}

  async list(userId: string): Promise<FavoritesSet> {
    const rows = await this.pool.query(
      'SELECT symbol FROM user_favorites WHERE user_id=$1 ORDER BY sort_index, symbol',
      [userId],
    );
    const meta = await this.pool.query(
      'SELECT version, updated_at FROM user_favorites_meta WHERE user_id=$1',
      [userId],
    );
    return {
      symbols: rows.rows.map((r) => r.symbol as string),
      version: meta.rows[0] ? Number(meta.rows[0].version) : 0,
      updatedAt: meta.rows[0] ? Number(meta.rows[0].updated_at) : null,
    };
  }

  async replace(userId: string, symbols: readonly string[], expectedVersion?: number): Promise<ReplaceResult> {
    const ordered = normalizeFavorites(symbols);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Lock/read the current version inside the transaction so a concurrent replace cannot interleave.
      const cur = await client.query('SELECT version FROM user_favorites_meta WHERE user_id=$1 FOR UPDATE', [userId]);
      const currentVersion = cur.rows[0] ? Number(cur.rows[0].version) : 0;
      if (expectedVersion !== undefined && expectedVersion !== currentVersion) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'conflict', currentVersion };
      }
      if (ordered.length > MAX_FAVORITES) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'tooMany', currentVersion };
      }
      const now = Date.now();
      const nextVersion = currentVersion + 1;
      await client.query('DELETE FROM user_favorites WHERE user_id=$1', [userId]);
      for (let i = 0; i < ordered.length; i += 1) {
        await client.query(
          'INSERT INTO user_favorites (user_id,symbol,sort_index,created_at) VALUES ($1,$2,$3,$4)',
          [userId, ordered[i], i, now],
        );
      }
      await client.query(
        `INSERT INTO user_favorites_meta (user_id,version,updated_at) VALUES ($1,$2,$3)
         ON CONFLICT (user_id) DO UPDATE SET version=EXCLUDED.version, updated_at=EXCLUDED.updated_at`,
        [userId, nextVersion, now],
      );
      await client.query('COMMIT');
      return { ok: true, version: nextVersion, symbols: ordered };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }
}
