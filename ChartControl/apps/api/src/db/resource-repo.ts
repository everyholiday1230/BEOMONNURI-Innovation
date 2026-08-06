import { randomUUID } from 'node:crypto';
import type { DB } from './sqlite';

/**
 * User-owned persistence (req §6/§7). EVERY read/write is scoped by user_id taken from the
 * authenticated session — never from the request body. Cross-user access returns null (→ 404),
 * so horizontal privilege escalation is impossible at the data layer.
 */
export interface OwnedRow {
  id: string;
  data: unknown;
  createdAt?: number;
  updatedAt?: number;
}

export class ResourceRepo {
  constructor(private readonly db: DB) {}

  // ---- preferences (one row per user) ----
  /** Allow-listed preference keys. Anything else in a request body is dropped, not stored. */
  static readonly PREFERENCE_KEYS = ['theme', 'brand', 'density', 'longshort', 'locale'] as const;

  getPreferences(userId: string): Record<string, unknown> | null {
    const r = this.db
      .prepare('SELECT theme,brand,density,longshort,locale,version,updated_at FROM user_preferences WHERE user_id=?')
      .get(userId) as Record<string, unknown> | undefined;
    return r ?? null;
  }

  /**
   * Merge-update the preference row and bump its version.
   *
   * The previous implementation wrote `p.theme ?? null` for every column, so a partial update such as
   * `{ theme: 'dark' }` silently ERASED locale, brand and density. Callers reasonably treat this as a
   * patch, so the existing row is read first and only the keys actually present are replaced.
   *
   * `expectedVersion` implements optimistic concurrency: when supplied and stale, nothing is written and
   * the caller gets a conflict instead of clobbering a concurrent edit from another tab.
   */
  upsertPreferences(
    userId: string,
    p: Record<string, string | undefined>,
    expectedVersion?: number,
  ): { ok: true; version: number } | { ok: false; reason: 'conflict'; currentVersion: number } {
    const now = Date.now();
    const existing = this.db
      .prepare('SELECT theme,brand,density,longshort,locale,version FROM user_preferences WHERE user_id=?')
      .get(userId) as (Record<string, string | null> & { version: number }) | undefined;
    const currentVersion = existing?.version ?? 0;
    if (expectedVersion !== undefined && expectedVersion !== currentVersion) {
      return { ok: false, reason: 'conflict', currentVersion };
    }
    const merged: Record<string, string | null> = {};
    for (const k of ResourceRepo.PREFERENCE_KEYS) {
      merged[k] = Object.prototype.hasOwnProperty.call(p, k) ? (p[k] ?? null) : (existing?.[k] ?? null);
    }
    const nextVersion = currentVersion + 1;
    this.db
      .prepare(
        `INSERT INTO user_preferences (user_id,theme,brand,density,longshort,locale,updated_at,version)
         VALUES (?,?,?,?,?,?,?,?)
         ON CONFLICT(user_id) DO UPDATE SET theme=excluded.theme,brand=excluded.brand,density=excluded.density,
           longshort=excluded.longshort,locale=excluded.locale,updated_at=excluded.updated_at,version=excluded.version`,
      )
      .run(
        userId,
        merged.theme,
        merged.brand,
        merged.density,
        merged.longshort,
        merged.locale,
        now,
        nextVersion,
      );
    return { ok: true, version: nextVersion };
  }

  // ---- favourites (FAV-01 / FAV-02) ----
  /** Hard cap on a user's favourite set, enforced at the data layer as well as in the route. */
  static readonly MAX_FAVORITES = 64;

  /** Ordered favourite symbols plus the SET version used for If-Match. */
  listFavorites(userId: string): { symbols: string[]; version: number; updatedAt: number | null } {
    const rows = this.db
      .prepare('SELECT symbol FROM user_favorites WHERE user_id=? ORDER BY sort_index, symbol')
      .all(userId) as { symbol: string }[];
    const meta = this.db
      .prepare('SELECT version, updated_at FROM user_favorites_meta WHERE user_id=?')
      .get(userId) as { version: number; updated_at: number } | undefined;
    return { symbols: rows.map((r) => r.symbol), version: meta?.version ?? 0, updatedAt: meta?.updated_at ?? null };
  }

  /**
   * Replace a user's favourite set atomically.
   *
   * Whole-set replacement rather than add/remove endpoints, because the client owns the ORDER; a
   * per-item API would need a separate reorder call and could interleave badly with it.
   *
   * The delete + insert + version bump run in ONE transaction: a failure part-way through must not
   * leave a user with half a favourites list.
   */
  replaceFavorites(
    userId: string,
    symbols: readonly string[],
    expectedVersion?: number,
  ): { ok: true; version: number; symbols: string[] } | { ok: false; reason: 'conflict' | 'tooMany'; currentVersion: number } {
    const current = this.listFavorites(userId);
    if (expectedVersion !== undefined && expectedVersion !== current.version) {
      return { ok: false, reason: 'conflict', currentVersion: current.version };
    }
    // De-duplicate while preserving the caller's order; uniqueness is also a PK constraint, but
    // rejecting at the boundary gives a clearer contract than relying on a constraint violation.
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const raw of symbols) {
      const s = raw.trim().toUpperCase();
      if (!s || seen.has(s)) continue;
      seen.add(s);
      ordered.push(s);
    }
    if (ordered.length > ResourceRepo.MAX_FAVORITES) {
      return { ok: false, reason: 'tooMany', currentVersion: current.version };
    }

    const now = Date.now();
    const nextVersion = current.version + 1;
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM user_favorites WHERE user_id=?').run(userId);
      const ins = this.db.prepare('INSERT INTO user_favorites (user_id,symbol,sort_index,created_at) VALUES (?,?,?,?)');
      ordered.forEach((symbol, i) => ins.run(userId, symbol, i, now));
      this.db
        .prepare(
          `INSERT INTO user_favorites_meta (user_id,version,updated_at) VALUES (?,?,?)
           ON CONFLICT(user_id) DO UPDATE SET version=excluded.version, updated_at=excluded.updated_at`,
        )
        .run(userId, nextVersion, now);
    });
    tx();
    return { ok: true, version: nextVersion, symbols: ordered };
  }


  // ---- layouts (+ versioned history) ----
  createLayout(userId: string, name: string, data: unknown): { id: string; version: number } {
    const id = randomUUID();
    const now = Date.now();
    this.db.prepare('INSERT INTO layouts (id,user_id,name,version,data,updated_at) VALUES (?,?,?,?,?,?)').run(id, userId, name, 1, JSON.stringify(data), now);
    this.db.prepare('INSERT INTO layout_versions (id,layout_id,user_id,version,data,created_at) VALUES (?,?,?,?,?,?)').run(randomUUID(), id, userId, 1, JSON.stringify(data), now);
    return { id, version: 1 };
  }
  updateLayout(userId: string, id: string, data: unknown): { version: number } | null {
    const cur = this.db.prepare('SELECT version FROM layouts WHERE id=? AND user_id=?').get(id, userId) as { version: number } | undefined;
    if (!cur) return null; // ownership: not found for this user
    const version = cur.version + 1;
    const now = Date.now();
    this.db.prepare('UPDATE layouts SET version=?, data=?, updated_at=? WHERE id=? AND user_id=?').run(version, JSON.stringify(data), now, id, userId);
    this.db.prepare('INSERT INTO layout_versions (id,layout_id,user_id,version,data,created_at) VALUES (?,?,?,?,?,?)').run(randomUUID(), id, userId, version, JSON.stringify(data), now);
    return { version };
  }
  listLayouts(userId: string): OwnedRow[] {
    return (this.db.prepare('SELECT id,name,version,data,updated_at FROM layouts WHERE user_id=?').all(userId) as { id: string; name: string; version: number; data: string; updated_at: number }[]).map((r) => ({ id: r.id, data: { name: r.name, version: r.version, layout: JSON.parse(r.data) }, updatedAt: r.updated_at }));
  }
  getLayout(userId: string, id: string): OwnedRow | null {
    const r = this.db.prepare('SELECT id,name,version,data,updated_at FROM layouts WHERE id=? AND user_id=?').get(id, userId) as { id: string; name: string; version: number; data: string; updated_at: number } | undefined;
    return r ? { id: r.id, data: { name: r.name, version: r.version, layout: JSON.parse(r.data) }, updatedAt: r.updated_at } : null;
  }
  listLayoutVersions(userId: string, layoutId: string): { version: number; createdAt: number }[] {
    return (this.db.prepare('SELECT version,created_at FROM layout_versions WHERE user_id=? AND layout_id=? ORDER BY version').all(userId, layoutId) as { version: number; created_at: number }[]).map((r) => ({ version: r.version, createdAt: r.created_at }));
  }

  // ---- ai signals (+ versions) ----
  createSignal(userId: string, sig: { symbol: string; timeframe?: string; direction?: string; status?: string; data: unknown }): { id: string } {
    const id = randomUUID();
    const now = Date.now();
    this.db.prepare('INSERT INTO ai_signals (id,user_id,symbol,timeframe,direction,status,data,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run(id, userId, sig.symbol, sig.timeframe ?? null, sig.direction ?? null, sig.status ?? 'PROPOSED', JSON.stringify(sig.data), now, now);
    this.db.prepare('INSERT INTO signal_versions (id,signal_id,user_id,version,data,created_at) VALUES (?,?,?,?,?,?)').run(randomUUID(), id, userId, 1, JSON.stringify(sig.data), now);
    return { id };
  }
  listSignals(userId: string): OwnedRow[] {
    return (this.db.prepare('SELECT id,symbol,status,data,updated_at FROM ai_signals WHERE user_id=?').all(userId) as { id: string; symbol: string; status: string; data: string; updated_at: number }[]).map((r) => ({ id: r.id, data: { symbol: r.symbol, status: r.status, signal: JSON.parse(r.data) }, updatedAt: r.updated_at }));
  }
  getSignal(userId: string, id: string): OwnedRow | null {
    const r = this.db.prepare('SELECT id,symbol,status,data FROM ai_signals WHERE id=? AND user_id=?').get(id, userId) as { id: string; symbol: string; status: string; data: string } | undefined;
    return r ? { id: r.id, data: { symbol: r.symbol, status: r.status, signal: JSON.parse(r.data) } } : null;
  }

  // ---- order drafts ----
  createOrderDraft(userId: string, d: { symbol: string; side: string; data: unknown }): { id: string } {
    const id = randomUUID();
    this.db.prepare('INSERT INTO order_drafts (id,user_id,symbol,side,data,created_at) VALUES (?,?,?,?,?,?)').run(id, userId, d.symbol, d.side, JSON.stringify(d.data), Date.now());
    return { id };
  }
  listOrderDrafts(userId: string): OwnedRow[] {
    return (this.db.prepare('SELECT id,symbol,side,data,created_at FROM order_drafts WHERE user_id=?').all(userId) as { id: string; symbol: string; side: string; data: string; created_at: number }[]).map((r) => ({ id: r.id, data: { symbol: r.symbol, side: r.side, draft: JSON.parse(r.data) }, createdAt: r.created_at }));
  }
  getOrderDraft(userId: string, id: string): OwnedRow | null {
    const r = this.db.prepare('SELECT id,symbol,side,data FROM order_drafts WHERE id=? AND user_id=?').get(id, userId) as { id: string; symbol: string; side: string; data: string } | undefined;
    return r ? { id: r.id, data: { symbol: r.symbol, side: r.side, draft: JSON.parse(r.data) } } : null;
  }

  // ---- chart overlays ----
  createOverlay(userId: string, o: { symbol: string; kind: string; data: unknown }): { id: string } {
    const id = randomUUID();
    const now = Date.now();
    this.db.prepare('INSERT INTO chart_overlays (id,user_id,symbol,kind,data,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(id, userId, o.symbol, o.kind, JSON.stringify(o.data), now, now);
    return { id };
  }
  listOverlays(userId: string): OwnedRow[] {
    return (this.db.prepare('SELECT id,symbol,kind,data FROM chart_overlays WHERE user_id=?').all(userId) as { id: string; symbol: string; kind: string; data: string }[]).map((r) => ({ id: r.id, data: { symbol: r.symbol, kind: r.kind, overlay: JSON.parse(r.data) } }));
  }

  // ---- ai conversations + messages ----
  createConversation(userId: string, title: string): { id: string } {
    const id = randomUUID();
    const now = Date.now();
    this.db.prepare('INSERT INTO ai_conversations (id,user_id,title,created_at,updated_at) VALUES (?,?,?,?,?)').run(id, userId, title, now, now);
    return { id };
  }
  addMessage(userId: string, conversationId: string, role: string, content: string): { id: string } | null {
    const conv = this.db.prepare('SELECT id FROM ai_conversations WHERE id=? AND user_id=?').get(conversationId, userId);
    if (!conv) return null; // ownership
    const id = randomUUID();
    this.db.prepare('INSERT INTO ai_messages (id,conversation_id,user_id,role,content,created_at) VALUES (?,?,?,?,?,?)').run(id, conversationId, userId, role, content, Date.now());
    return { id };
  }
  listConversations(userId: string): OwnedRow[] {
    return (this.db.prepare('SELECT id,title,updated_at FROM ai_conversations WHERE user_id=?').all(userId) as { id: string; title: string; updated_at: number }[]).map((r) => ({ id: r.id, data: { title: r.title }, updatedAt: r.updated_at }));
  }
  listMessages(userId: string, conversationId: string): OwnedRow[] | null {
    const conv = this.db.prepare('SELECT id FROM ai_conversations WHERE id=? AND user_id=?').get(conversationId, userId);
    if (!conv) return null;
    return (this.db.prepare('SELECT id,role,content,created_at FROM ai_messages WHERE conversation_id=? AND user_id=?').all(conversationId, userId) as { id: string; role: string; content: string; created_at: number }[]).map((r) => ({ id: r.id, data: { role: r.role, content: r.content }, createdAt: r.created_at }));
  }

  // ---- simulation orders + events ----
  recordSimOrder(userId: string, o: { clientOrderId: string; symbol: string; side: string; status: string; data: unknown }): { id: string } {
    const id = randomUUID();
    const now = Date.now();
    this.db.prepare('INSERT INTO simulation_orders (id,user_id,client_order_id,symbol,side,status,data,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run(id, userId, o.clientOrderId, o.symbol, o.side, o.status, JSON.stringify(o.data), now, now);
    this.db.prepare('INSERT INTO simulation_order_events (id,order_id,user_id,from_state,to_state,actor,at) VALUES (?,?,?,?,?,?,?)').run(randomUUID(), id, userId, null, o.status, 'user', now);
    return { id };
  }
  listSimOrders(userId: string): OwnedRow[] {
    return (this.db.prepare('SELECT id,symbol,side,status,data FROM simulation_orders WHERE user_id=?').all(userId) as { id: string; symbol: string; side: string; status: string; data: string }[]).map((r) => ({ id: r.id, data: { symbol: r.symbol, side: r.side, status: r.status, order: JSON.parse(r.data) } }));
  }
  listSimOrderEvents(userId: string, orderId: string): OwnedRow[] | null {
    const o = this.db.prepare('SELECT id FROM simulation_orders WHERE id=? AND user_id=?').get(orderId, userId);
    if (!o) return null;
    return (this.db.prepare('SELECT id,from_state,to_state,actor,at FROM simulation_order_events WHERE order_id=? AND user_id=?').all(orderId, userId) as { id: string; from_state: string | null; to_state: string; actor: string; at: number }[]).map((r) => ({ id: r.id, data: { fromState: r.from_state, toState: r.to_state, actor: r.actor }, createdAt: r.at }));
  }
}
