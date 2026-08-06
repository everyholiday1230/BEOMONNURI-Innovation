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
