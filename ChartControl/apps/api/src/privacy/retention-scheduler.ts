/**
 * 보관기간이 지난 개인정보를 **자동으로** 파기한다.
 *
 * ★★ 왜 필요한가
 *
 *   개인정보처리방침은 접속기록을 3개월 후 파기한다고 약속한다. 그런데 파기는
 *   **수동 CLI 뿐이었고 스케줄러 참조가 0건**이었다. 즉 아무도 실행하지 않았고,
 *   `audit_logs` 576행이 서비스 개시일부터 그대로 쌓여 있었다.
 *
 *   약속을 지키지 않는 것 자체가 위반이고, 더 나쁜 것은 **그 증거가 DB 에 남는다**는
 *   점이다. 분쟁이나 조사에서 "3개월 후 파기한다고 적어 두고 1년치를 갖고 있었다" 가
 *   그대로 드러난다.
 *
 * ★ 실패를 조용히 삼키지 않는다. 한 표가 실패해도 나머지는 계속 시도하고, 무엇이
 *   왜 실패했는지 남긴다. 파기가 멈춘 것을 아무도 모르는 상태가 가장 나쁘다.
 *
 * ★ 표가 없으면(마이그레이션 미적용) 오류가 아니다. 조용히 건너뛰되 한 번은 알린다.
 *
 * ★ 삭제는 **배치로 나눈다.** 한 번에 수십만 행을 지우면 잠금이 길어져 다른 요청이
 *   멈춘다. 운영 중에 도는 작업이므로 조금씩 지운다.
 */
import type { Pool } from 'pg';

import { RETENTION_RULES, cutoffFor, type RetentionRule } from './retention-policy';

/** 한 번에 지우는 최대 행 수. 잠금 시간을 짧게 유지한다. */
const BATCH = 1_000;

/** 한 규칙에서 한 번의 실행이 지우는 상한. 무한 루프를 막는다. */
const MAX_PER_RUN = 50_000;

export interface PurgeOutcome {
  table: string;
  deleted: number;
  /** 표가 없어서 건너뛴 경우. */
  skipped: boolean;
  error?: string;
}

/**
 * 한 규칙을 실행한다.
 *
 * ★ `ctid` 로 배치를 자른다. 기본키 이름을 표마다 알 필요가 없다.
 */
async function purgeRule(pool: Pool, rule: RetentionRule, now: number): Promise<PurgeOutcome> {
  const cutoffDate = cutoffFor(rule, now);
  /*
     ★★ 컬럼 저장 형태에 맞춰 기준값을 만든다.

       표마다 다르다 — audit_logs.at 은 timestamptz 인데 admin_actions.at 은
       에폭 밀리초(bigint)다. 한 가지로 가정했더니 운영에서
       `invalid input syntax for type bigint` 로 파기가 조용히 멈췄다.
  */
  const cutoff: Date | string = rule.columnKind === 'epoch_ms'
    ? String(cutoffDate.getTime())
    : cutoffDate;
  let deleted = 0;
  try {
    for (;;) {
      const r = await pool.query(
        `DELETE FROM ${rule.table}
          WHERE ctid IN (
            SELECT ctid FROM ${rule.table}
             WHERE ${rule.column} IS NOT NULL AND ${rule.column} < $1
             LIMIT ${BATCH}
          )`,
        [cutoff],
      );
      const n = r.rowCount ?? 0;
      deleted += n;
      if (n < BATCH || deleted >= MAX_PER_RUN) break;
    }
    return { table: rule.table, deleted, skipped: false };
  } catch (e) {
    const msg = (e as Error).message;
    /* 표가 아직 없다 — 마이그레이션 미적용. 오류로 다루지 않는다. */
    if (/does not exist/i.test(msg)) return { table: rule.table, deleted, skipped: true };
    return { table: rule.table, deleted, skipped: false, error: msg };
  }
}

/** 모든 규칙을 한 번 실행한다. */
export async function runRetentionPurge(
  pool: Pool,
  now: number = Date.now(),
): Promise<PurgeOutcome[]> {
  const out: PurgeOutcome[] = [];
  for (const rule of RETENTION_RULES) {
    /* ★ 한 표가 실패해도 나머지는 계속한다. */
    out.push(await purgeRule(pool, rule, now));
  }
  return out;
}

export interface RetentionSchedulerHandle {
  stop(): void;
  /** 시험·운영 점검용 — 지금 한 번 돌린다. */
  runNow(): Promise<PurgeOutcome[]>;
}

/**
 * 주기 실행을 시작한다.
 *
 * ★ 부팅 직후에 한 번 돌린다. 그리고 하루에 한 번. 재시작이 잦아도 중복 삭제는
 *   해가 없다(이미 지운 행은 없다).
 *
 * ★ 첫 실행을 조금 늦춘다. 부팅 순간에는 마이그레이션·시딩이 함께 돌아 DB 가 바쁘다.
 */
export function startRetentionScheduler(
  pool: Pool,
  opts: { intervalMs?: number; firstDelayMs?: number } = {},
): RetentionSchedulerHandle {
  const intervalMs = opts.intervalMs ?? 24 * 60 * 60 * 1000;
  const firstDelayMs = opts.firstDelayMs ?? 60_000;

  const report = (rows: PurgeOutcome[]) => {
    const deleted = rows.filter((r) => r.deleted > 0);
    const failed = rows.filter((r) => r.error);
    const skipped = rows.filter((r) => r.skipped);
    if (deleted.length > 0) {
      console.log(
        `[privacy] 보관기간 경과 파기: ${deleted.map((r) => `${r.table} ${r.deleted}행`).join(' · ')}`,
      );
    } else if (failed.length === 0) {
      console.log('[privacy] 보관기간 경과 파기: 지울 것이 없다.');
    }
    /* ★ 실패는 반드시 크게 남긴다 — 파기가 멈춘 것을 아무도 모르면 안 된다. */
    for (const f of failed) {
      console.error(`[privacy] ★ 파기 실패 ${f.table}: ${f.error} — 방침이 약속한 파기가 이루어지지 않았다.`);
    }
    if (skipped.length > 0) {
      console.warn(`[privacy] 표가 없어 건너뜀: ${skipped.map((r) => r.table).join(', ')}`);
    }
  };

  const runNow = async () => {
    const rows = await runRetentionPurge(pool);
    report(rows);
    return rows;
  };

  const first = setTimeout(() => { void runNow(); }, firstDelayMs);
  const timer = setInterval(() => { void runNow(); }, intervalMs);
  /* 타이머가 프로세스 종료를 막지 않게 한다. */
  for (const t of [first, timer]) {
    if (typeof t === 'object' && t && 'unref' in t) (t as { unref: () => void }).unref();
  }

  return {
    stop() { clearTimeout(first); clearInterval(timer); },
    runNow,
  };
}
