import type { Pool } from 'pg';

/**
 * 차트 템플릿 저장소 (기기 간 동기화).
 *
 * 왜 서버에 두는가
 * --------------
 * 템플릿이 `localStorage` 에만 있어서, 집 PC 에서 만든 지표 조합이 사무실
 * PC·휴대폰에서는 없었다. 같은 계정으로 로그인했으면 따라오는 것이 사용자
 * 기대다. 즐겨찾기는 이미 서버에 저장하는데 템플릿만 빠져 있었다.
 *
 * 설계 결정
 * --------
 * ★ 템플릿 하나가 한 행이다. JSON 배열을 통째로 한 행에 넣으면, 두 기기가
 *   각각 다른 템플릿을 추가할 때 마지막 저장이 상대의 것을 덮어 지운다.
 *
 * ★ 이름이 사용자별 유일 키다. 같은 이름으로 저장하면 덮어쓴다 — 로컬 구현도
 *   그랬고, 목록에 같은 이름이 둘 보이는 것이 더 혼란스럽다.
 *
 * ★ payload 는 검증하지 않고 그대로 보관한다. 지표 설정은 차트 라이브러리의
 *   스키마이고 앞으로 바뀐다. 서버가 그 형식을 알려고 하면 지표가 추가될 때마다
 *   서버를 고쳐야 한다. 대신 `schemaVersion` 을 같이 저장해 나중에 변환할 수
 *   있게 한다.
 */

/** 개수 상한. 초과분을 조용히 버리지 않고 이유를 알린다. */
export const MAX_CHART_TEMPLATES = 50;

/**
 * payload 크기 상한 (문자 수).
 *
 * ★ 상한이 없으면 한 사용자가 수 MB JSON 을 넣어 DB 와 응답을 부풀릴 수 있다.
 *   지표 20개 구성이 대략 2~4KB 이므로 64KB 는 넉넉하다.
 */
export const MAX_TEMPLATE_PAYLOAD_CHARS = 64 * 1024;

export interface ChartTemplate {
  readonly id: string;
  readonly name: string;
  readonly symbol: string | null;
  readonly timeframe: string | null;
  readonly payload: unknown;
  readonly schemaVersion: number;
  readonly updatedAt: number;
}

export type SaveResult =
  | { readonly ok: true; readonly template: ChartTemplate }
  | { readonly ok: false; readonly reason: 'tooMany'; readonly max: number }
  | { readonly ok: false; readonly reason: 'tooLarge'; readonly maxChars: number }
  | { readonly ok: false; readonly reason: 'invalidName' };

export class PgChartTemplateRepo {
  constructor(private readonly pool: Pool) {}

  async list(userId: string): Promise<ChartTemplate[]> {
    const r = await this.pool.query(
      `SELECT id, name, symbol, timeframe, payload, schema_version, updated_at
         FROM chart_templates
        WHERE user_id = $1
        ORDER BY updated_at DESC`,
      [userId],
    );
    return r.rows.map((row) => this.toTemplate(row));
  }

  /**
   * 저장(같은 이름이면 갱신).
   *
   * ★ 개수 상한은 **새 이름일 때만** 본다. 이미 있는 템플릿을 고치는 것은
   *   개수를 늘리지 않으므로, 상한에 걸렸다고 수정을 막으면 사용자가 정리도
   *   못 하는 상태에 빠진다.
   */
  async save(
    userId: string,
    input: {
      readonly name: string;
      readonly symbol?: string | null;
      readonly timeframe?: string | null;
      readonly payload: unknown;
      readonly schemaVersion?: number;
    },
  ): Promise<SaveResult> {
    const name = String(input.name ?? '').trim();
    if (name.length < 1 || name.length > 60) return { ok: false, reason: 'invalidName' };

    const serialized = JSON.stringify(input.payload ?? null);
    if (serialized.length > MAX_TEMPLATE_PAYLOAD_CHARS) {
      return { ok: false, reason: 'tooLarge', maxChars: MAX_TEMPLATE_PAYLOAD_CHARS };
    }

    const existing = await this.pool.query(
      'SELECT 1 FROM chart_templates WHERE user_id = $1 AND name = $2',
      [userId, name],
    );
    if (existing.rowCount === 0) {
      const count = await this.pool.query(
        'SELECT count(*)::int AS n FROM chart_templates WHERE user_id = $1',
        [userId],
      );
      const n = Number(count.rows[0]?.n ?? 0);
      if (n >= MAX_CHART_TEMPLATES) {
        return { ok: false, reason: 'tooMany', max: MAX_CHART_TEMPLATES };
      }
    }

    const r = await this.pool.query(
      `INSERT INTO chart_templates (user_id, name, symbol, timeframe, payload, schema_version)
            VALUES ($1, $2, $3, $4, $5::jsonb, $6)
       ON CONFLICT (user_id, name) DO UPDATE
              SET symbol = EXCLUDED.symbol,
                  timeframe = EXCLUDED.timeframe,
                  payload = EXCLUDED.payload,
                  schema_version = EXCLUDED.schema_version,
                  updated_at = now()
         RETURNING id, name, symbol, timeframe, payload, schema_version, updated_at`,
      [userId, name, input.symbol ?? null, input.timeframe ?? null, serialized, input.schemaVersion ?? 1],
    );
    return { ok: true, template: this.toTemplate(r.rows[0]) };
  }

  /**
   * 삭제.
   *
   * ★ `user_id` 를 조건에 반드시 넣는다. id 만으로 지우면 남의 템플릿 id 를
   *   알아낸 사람이 그것을 지울 수 있다.
   *
   * @returns 실제로 지워졌는지. false 면 없거나 남의 것이다 —
   *          호출부는 그 둘을 구분해 알리지 않는다(id 존재 여부가 새어 나간다).
   */
  async remove(userId: string, id: string): Promise<boolean> {
    const r = await this.pool.query(
      'DELETE FROM chart_templates WHERE user_id = $1 AND id = $2',
      [userId, id],
    );
    return (r.rowCount ?? 0) > 0;
  }

  private toTemplate(row: {
    id: string;
    name: string;
    symbol: string | null;
    timeframe: string | null;
    payload: unknown;
    schema_version: number;
    updated_at: Date;
  }): ChartTemplate {
    return {
      id: row.id,
      name: row.name,
      symbol: row.symbol,
      timeframe: row.timeframe,
      payload: row.payload,
      schemaVersion: Number(row.schema_version),
      updatedAt: new Date(row.updated_at).getTime(),
    };
  }
}
