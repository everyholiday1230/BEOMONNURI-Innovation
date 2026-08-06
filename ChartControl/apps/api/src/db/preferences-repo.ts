import type { Pool } from 'pg';
import { ResourceRepo } from './resource-repo';

/**
 * BATCH_2 / BL-10 — user preferences repository contract with SQLite (dev/test) and PostgreSQL
 * (production) implementations, following the Batch 1 pattern (async interface, server-selected backend,
 * NO production SQLite fallback).
 *
 * Preferences are an ALLOW-LISTED set of scalar keys (theme/brand/density/longshort/locale). Arbitrary
 * JSON is never stored — the route validates with a strict zod schema and this layer only ever writes the
 * fixed columns, so a request cannot pollute the row with keys the server does not read, and there is no
 * prototype-pollution surface. Both backends satisfy the same `preferences-contract.test.ts`: partial
 * patch (a `{theme}` update must not erase locale), optimistic version, and per-user isolation.
 */

export interface PreferencesRow {
  theme: string | null;
  brand: string | null;
  density: string | null;
  longshort: string | null;
  locale: string | null;
  version: number;
  updatedAt: number | null;
}

export type PreferencesUpsertResult =
  | { ok: true; version: number }
  | { ok: false; reason: 'conflict'; currentVersion: number };

export interface IPreferencesRepo {
  get(userId: string): Promise<PreferencesRow | null>;
  upsert(
    userId: string,
    patch: Record<string, string | undefined>,
    expectedVersion?: number,
  ): Promise<PreferencesUpsertResult>;
}

/** The single source of truth for which preference keys may be persisted. */
export const PREFERENCE_KEYS = ResourceRepo.PREFERENCE_KEYS;

/**
 * Development / test implementation — delegates to the synchronous better-sqlite3 ResourceRepo and wraps
 * the result in a resolved promise (the same async-over-sync pattern the auth/favorites repos use).
 * Production refuses this via the startup guard.
 */
export class SqlitePreferencesRepo implements IPreferencesRepo {
  constructor(private readonly resource: ResourceRepo) {}

  async get(userId: string): Promise<PreferencesRow | null> {
    const r = this.resource.getPreferences(userId) as (Record<string, unknown> & { version?: number }) | null;
    if (!r) return null;
    return {
      theme: (r.theme as string | null) ?? null,
      brand: (r.brand as string | null) ?? null,
      density: (r.density as string | null) ?? null,
      longshort: (r.longshort as string | null) ?? null,
      locale: (r.locale as string | null) ?? null,
      version: Number(r.version ?? 0),
      updatedAt: r.updated_at === null || r.updated_at === undefined ? null : Number(r.updated_at),
    };
  }

  async upsert(
    userId: string,
    patch: Record<string, string | undefined>,
    expectedVersion?: number,
  ): Promise<PreferencesUpsertResult> {
    return this.resource.upsertPreferences(userId, patch, expectedVersion);
  }
}

/**
 * Production implementation — real PostgreSQL over the 0001 `user_preferences` table with the 0007
 * `version` column. The read-modify-write runs in ONE transaction with `SELECT ... FOR UPDATE`, so a
 * concurrent edit from a second tab is a 409 (conflict) rather than a silent clobber, and a partial patch
 * only rewrites the keys actually present.
 */
export class PgPreferencesRepo implements IPreferencesRepo {
  constructor(private readonly pool: Pool) {}

  async get(userId: string): Promise<PreferencesRow | null> {
    const r = await this.pool.query(
      `SELECT theme, brand, density, longshort, locale, version,
              (EXTRACT(EPOCH FROM updated_at) * 1000)::bigint AS updated_at
         FROM user_preferences WHERE user_id = $1`,
      [userId],
    );
    if (!r.rows[0]) return null;
    const row = r.rows[0];
    return {
      theme: row.theme ?? null,
      brand: row.brand ?? null,
      density: row.density ?? null,
      longshort: row.longshort ?? null,
      locale: row.locale ?? null,
      version: Number(row.version),
      updatedAt: row.updated_at === null ? null : Number(row.updated_at),
    };
  }

  async upsert(
    userId: string,
    patch: Record<string, string | undefined>,
    expectedVersion?: number,
  ): Promise<PreferencesUpsertResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const cur = await client.query(
        'SELECT theme, brand, density, longshort, locale, version FROM user_preferences WHERE user_id = $1 FOR UPDATE',
        [userId],
      );
      const existing = cur.rows[0] as (Record<string, string | null> & { version: number }) | undefined;
      const currentVersion = existing ? Number(existing.version) : 0;
      if (expectedVersion !== undefined && expectedVersion !== currentVersion) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'conflict', currentVersion };
      }
      // Partial patch: only keys present in the request are replaced; the rest keep their stored value.
      const merged: Record<string, string | null> = {};
      for (const k of PREFERENCE_KEYS) {
        merged[k] = Object.prototype.hasOwnProperty.call(patch, k)
          ? (patch[k] ?? null)
          : (existing?.[k] ?? null);
      }
      const nextVersion = currentVersion + 1;
      await client.query(
        `INSERT INTO user_preferences (user_id, theme, brand, density, longshort, locale, updated_at, version)
         VALUES ($1,$2,$3,$4,$5,$6, now(), $7)
         ON CONFLICT (user_id) DO UPDATE SET theme=EXCLUDED.theme, brand=EXCLUDED.brand, density=EXCLUDED.density,
           longshort=EXCLUDED.longshort, locale=EXCLUDED.locale, updated_at=EXCLUDED.updated_at, version=EXCLUDED.version`,
        [userId, merged.theme, merged.brand, merged.density, merged.longshort, merged.locale, nextVersion],
      );
      await client.query('COMMIT');
      return { ok: true, version: nextVersion };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }
}
