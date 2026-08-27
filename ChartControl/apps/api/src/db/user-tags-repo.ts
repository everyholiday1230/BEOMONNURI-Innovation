/*
   유저 겸직 태그 저장소 (PostgreSQL). 한 유저에게 여러 태그(team_leader, staff 등)를
   붙인다. 권한 역할(users.role)과 독립적이다.
*/
export class PgUserTagsRepo {
  constructor(private readonly pool: import('pg').Pool) {}

  /** 한 유저의 태그 목록. */
  async listForUser(userId: string): Promise<string[]> {
    const { rows } = await this.pool.query(
      `SELECT tag FROM user_tags WHERE user_id = $1 ORDER BY tag`,
      [userId],
    );
    return (rows as { tag: string }[]).map((r) => String(r.tag));
  }

  /** 태그 추가(멱등 — 이미 있으면 무시). */
  async add(userId: string, tag: string, createdBy: string | null): Promise<void> {
    await this.pool.query(
      `INSERT INTO user_tags (user_id, tag, created_by) VALUES ($1,$2,$3)
       ON CONFLICT (user_id, tag) DO NOTHING`,
      [userId, String(tag).slice(0, 40), createdBy],
    );
  }

  /** 태그 제거. */
  async remove(userId: string, tag: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `DELETE FROM user_tags WHERE user_id = $1 AND tag = $2`,
      [userId, tag],
    );
    return (rowCount ?? 0) > 0;
  }

  /** 특정 태그를 가진 유저 목록(이메일 포함). 팀장 정산에 쓴다. */
  async listUsersByTag(tag: string): Promise<Array<{ userId: string; email: string | null }>> {
    const { rows } = await this.pool.query(
      `SELECT t.user_id, u.email FROM user_tags t
         LEFT JOIN users u ON u.id = t.user_id
        WHERE t.tag = $1 ORDER BY u.email`,
      [tag],
    );
    return (rows as { user_id: string; email: string | null }[]).map((r) => ({
      userId: String(r.user_id),
      email: r.email == null ? null : String(r.email),
    }));
  }

  /** 여러 유저의 태그를 한 번에(유저 목록 화면용). userId -> tags[] */
  async tagsForUsers(userIds: string[]): Promise<Record<string, string[]>> {
    if (userIds.length === 0) return {};
    const { rows } = await this.pool.query(
      `SELECT user_id, tag FROM user_tags WHERE user_id = ANY($1::uuid[])`,
      [userIds],
    );
    const out: Record<string, string[]> = {};
    for (const r of rows as { user_id: string; tag: string }[]) {
      (out[String(r.user_id)] ||= []).push(String(r.tag));
    }
    return out;
  }
}
