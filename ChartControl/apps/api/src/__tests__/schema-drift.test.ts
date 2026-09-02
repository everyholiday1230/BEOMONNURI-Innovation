import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

/*
   ============================================================
   SCHEMA-DRIFT — 운영(Postgres)과 개발(SQLite) 스키마 격차가 **기록돼 있는가**.

   ★★ 왜 테스트로 두는가

     드리프트 자체는 결함이 아니다. 개발에서 일부 기능을 포기하는 것은 선택이다.
     결함은 **아무도 모르는 드리프트**다. 앱은 없는 표를 읽고 기능이 조용히 꺼진 채
     돌아간다. 이 프로젝트에서 실제로 겪었다:

       · 로컬 관리자 라우터가 mock_gateway_state 부재로 전부 비활성화 → 원인 추적에
         시간을 썼다
       · 저장 기능이 SQLite 에서 supported:false → 화면 검증이 "저장이 안 된다" 로
         보였고, 원인은 코드가 아니라 개발 DB 였다

     그래서 새 Postgres 표를 추가하면서 판단을 미루면 **여기서 실패한다.**
     docs/schema-drift.md 에 그 표가 무엇을 끄는지 한 줄 적으면 통과한다.
   ============================================================ */

const ROOT = join(__dirname, '../../../..');

describe('SCHEMA-DRIFT 스키마 격차 기록', () => {
  it('[1] ★★ 문서에 없는 운영 전용 표가 없다 — 있으면 판단이 미뤄진 것이다', () => {
    /*
       ★ 스크립트를 그대로 실행한다. 검사 논리를 테스트에 다시 쓰면 두 벌이 되고,
         한쪽만 고치는 실수가 생긴다.
    */
    let out = '';
    let failed = false;
    try {
      out = execFileSync('node', [join(ROOT, 'scripts/schema-drift.mjs')], { encoding: 'utf8' });
    } catch (e) {
      failed = true;
      out = String((e as { stdout?: string }).stdout ?? '');
    }
    if (failed) {
      throw new Error(
        `기록되지 않은 스키마 드리프트가 있다. docs/schema-drift.md 를 갱신하라.\n${out}`,
      );
    }
    expect(out).toContain('모든 드리프트가 문서에 기록돼');
  });

  it('[2] 문서가 개발에서 꺼지는 기능을 실제로 설명한다 (목록만 있는 게 아니다)', () => {
    const doc = readFileSync(join(ROOT, 'docs/schema-drift.md'), 'utf8');
    // 결정과 그 근거가 적혀 있어야 한다 — 표 이름만 나열하면 다음 사람이 또 조사한다.
    expect(doc).toContain('Postgres 전용');
    expect(doc).toContain('supported: false');
    for (const t of ['saved_items', 'ops_errors', 'kucoin_oauth_states', 'point_ledger']) {
      expect(doc).toContain(t);
    }
  });

  it('[3] 개발에만 있는 표는 없다 — 운영에 없는 표를 개발이 쓰면 운영에서 깨진다', () => {
    const json = execFileSync('node', [join(ROOT, 'scripts/schema-drift.mjs'), '--json'], { encoding: 'utf8' });
    const parsed = JSON.parse(json) as { onlyLite: string[] };
    expect(parsed.onlyLite).toEqual([]);
  });
});
