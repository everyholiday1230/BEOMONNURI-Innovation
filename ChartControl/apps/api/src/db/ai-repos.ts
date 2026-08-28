import { randomUUID } from 'node:crypto';
import type { DB } from './sqlite';
import type { IAIConversationRepository, IAIUsageRepository, AiUsage } from '@quantumtrade/ai';

/**
 * SQLite AI repositories (docs PHASE4-10). Every read/write is scoped by userId (cross-user access
 * returns null / empty). Only a short reasoning_summary is stored — never raw chain-of-thought.
 * No API secrets / auth headers are persisted.
 */
export class SqliteConversationRepo implements IAIConversationRepository {
  constructor(private readonly db: DB) {}

  async createConversation(userId: string, title: string): Promise<{ id: string }> {
    const id = randomUUID();
    const now = Date.now();
    this.db.prepare('INSERT INTO ai_conversations (id,user_id,title,created_at,updated_at) VALUES (?,?,?,?,?)').run(id, userId, title.slice(0, 200), now, now);
    return { id };
  }

  async getOwned(userId: string, conversationId: string): Promise<{ id: string; userId: string } | null> {
    const r = this.db.prepare('SELECT id,user_id FROM ai_conversations WHERE id=? AND user_id=? AND deleted_at IS NULL').get(conversationId, userId) as { id: string; user_id: string } | undefined;
    return r ? { id: r.id, userId: r.user_id } : null;
  }

  async appendMessage(userId: string, conversationId: string, msg: { role: string; content: string; redactedReasoningSummary?: string }): Promise<{ id: string }> {
    const owned = await this.getOwned(userId, conversationId);
    if (!owned) throw new Error('conversation not found (ownership)');
    const id = randomUUID();
    // Store only a bounded reasoning SUMMARY — never raw chain-of-thought.
    const summary = msg.redactedReasoningSummary ? msg.redactedReasoningSummary.slice(0, 600) : null;
    this.db.prepare('INSERT INTO ai_messages (id,conversation_id,user_id,role,content,reasoning_summary,created_at) VALUES (?,?,?,?,?,?,?)')
      .run(id, conversationId, userId, msg.role, msg.content, summary, Date.now());
    this.db.prepare('UPDATE ai_conversations SET updated_at=? WHERE id=? AND user_id=?').run(Date.now(), conversationId, userId);
    return { id };
  }

  async listMessages(userId: string, conversationId: string): Promise<Array<{ role: string; content: string }>> {
    const owned = await this.getOwned(userId, conversationId);
    if (!owned) return [];
    return this.db.prepare('SELECT role,content FROM ai_messages WHERE conversation_id=? AND user_id=? AND deleted_at IS NULL ORDER BY created_at ASC').all(conversationId, userId) as Array<{ role: string; content: string }>;
  }

  async softDelete(userId: string, conversationId: string): Promise<boolean> {
    const info = this.db.prepare('UPDATE ai_conversations SET deleted_at=? WHERE id=? AND user_id=? AND deleted_at IS NULL').run(Date.now(), conversationId, userId);
    return info.changes > 0;
  }
}

export class SqliteUsageRepo implements IAIUsageRepository {
  constructor(private readonly db: DB, private readonly now: () => number = Date.now) {}

  async record(userId: string, usage: AiUsage & { conversationId: string; correlationId: string }): Promise<void> {
    this.db.prepare(
      `INSERT INTO ai_usage_records (id,user_id,conversation_id,correlation_id,model,fallback_used,input_tokens,output_tokens,estimated_cost_micros,at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).run(randomUUID(), userId, usage.conversationId, usage.correlationId, usage.model, usage.fallbackUsed ? 1 : 0, usage.inputTokens, usage.outputTokens, usage.estimatedCostMicros, this.now());
  }

  private since(): number {
    return this.now() - 24 * 60 * 60 * 1000;
  }
  async dailyTokens(userId: string): Promise<number> {
    const r = this.db.prepare('SELECT COALESCE(SUM(input_tokens+output_tokens),0) AS n FROM ai_usage_records WHERE user_id=? AND at>=?').get(userId, this.since()) as { n: number };
    return Number(r.n);
  }
  async dailyCostMicros(userId: string): Promise<number> {
    const r = this.db.prepare('SELECT COALESCE(SUM(estimated_cost_micros),0) AS n FROM ai_usage_records WHERE user_id=? AND at>=?').get(userId, this.since()) as { n: number };
    return Number(r.n);
  }
}

/** pg Pool 의 최소 형태(쿼리만 쓴다). */
interface PgPoolLike {
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

/*
   ★★ PostgreSQL AI 사용량 저장소.

     프로덕션은 Postgres 를 쓰는데 AI 라우터가 SqliteUsageRepo 로 사용량을 SQLite 에
     기록하고 있었다. 그래서 운영자 화면(관리자 AI Ops — Postgres 의 ai_runs /
     ai_usage_records 조회)에는 사용량·비용이 **항상 0** 으로 보였고, SQLite 파일은
     재시작 때 사라졌다. Postgres 배포에서는 이 저장소로 같은 테이블에 기록한다.

   ★ ai_usage_records(토큰·비용)와 ai_runs(실행 목록·개수) 둘 다 기록한다 —
     관리자 요약은 usage_records 를, 실행 목록/카운트는 ai_runs 를 읽는다.
*/
export class PgUsageRepo implements IAIUsageRepository {
  constructor(
    private readonly pool: PgPoolLike,
    private readonly providerName: string = 'openai',
  ) {}

  async record(userId: string, usage: AiUsage & { conversationId: string; correlationId: string }): Promise<void> {
    await this.pool.query(
      `INSERT INTO ai_runs (id,conversation_id,user_id,provider,model,prompt_version,fallback_used,status,correlation_id,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
       ON CONFLICT DO NOTHING`,
      [randomUUID(), usage.conversationId, userId, this.providerName, usage.model, null, usage.fallbackUsed, 'ok', usage.correlationId],
    ).catch(() => { /* 기록 실패가 응답을 막지 않는다 */ });
    await this.pool.query(
      `INSERT INTO ai_usage_records (id,user_id,conversation_id,correlation_id,model,fallback_used,input_tokens,output_tokens,estimated_cost_micros,at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())`,
      [randomUUID(), userId, usage.conversationId, usage.correlationId, usage.model, usage.fallbackUsed, usage.inputTokens, usage.outputTokens, usage.estimatedCostMicros],
    ).catch(() => { /* 비치명 */ });
  }

  async dailyTokens(userId: string): Promise<number> {
    const r = await this.pool.query(
      `SELECT COALESCE(SUM(input_tokens+output_tokens),0) AS n FROM ai_usage_records WHERE user_id=$1 AND at >= now() - interval '24 hours'`,
      [userId],
    );
    return Number((r.rows[0] as { n: string } | undefined)?.n ?? 0);
  }
  async dailyCostMicros(userId: string): Promise<number> {
    const r = await this.pool.query(
      `SELECT COALESCE(SUM(estimated_cost_micros),0) AS n FROM ai_usage_records WHERE user_id=$1 AND at >= now() - interval '24 hours'`,
      [userId],
    );
    return Number((r.rows[0] as { n: string } | undefined)?.n ?? 0);
  }
}
