#!/usr/bin/env node
/*
   ============================================================
   스키마 드리프트 점검 — Postgres(운영) vs SQLite(개발).

   ★★ 왜 필요한가

     운영은 Postgres 전용이고(없으면 기동 거부), 개발 기본값은 SQLite 다. 두
     마이그레이션 계보가 따로 자라서, 개발에서는 있지도 않은 표를 앱이 읽으려 하고
     **기능이 조용히 꺼진 채** 돌아간다. 실제로 이 세션에서 로컬 관리자 라우터가
     `relation "mock_gateway_state" does not exist` 로 비활성화됐고, 원인을 찾는 데
     시간을 썼다.

     파일 번호(0041 vs 0015)로는 격차를 알 수 없다 — SQLite 쪽은 phase 단위로 여러
     표를 한 파일에 만든다. 그래서 **표 이름**을 비교한다.

   ★ 이 스크립트는 판단하지 않는다. 사실만 나열한다. 어떤 표를 개발에서 포기할지는
     결정의 문제이고, 그 결정을 문서(docs/schema-drift.md)에 적어 두면 다음 사람이
     같은 조사를 반복하지 않는다.

   사용:
     node scripts/schema-drift.mjs           사람이 읽는 보고
     node scripts/schema-drift.mjs --json    기계가 읽는 출력
   ============================================================ */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PG_DIR = join(ROOT, 'infrastructure/postgres');
const SQLITE_DIR = join(ROOT, 'apps/api/src/db/migrations');

/** CREATE TABLE 로 만들어지는 표 이름을 모은다(IF NOT EXISTS·따옴표·스키마 접두어 허용). */
function tablesIn(dir, filter) {
  const names = new Set();
  for (const f of readdirSync(dir).filter(filter)) {
    /*
       ★ 주석 줄을 먼저 지운다. 주석에 "CREATE TABLE IF NOT EXISTS." 같은 설명이
         있으면 표 이름으로 잡혀(실제로 'if' 가 표로 잡혔다) 보고가 거짓이 된다.
    */
    const sql = readFileSync(join(dir, f), 'utf8')
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('--'))
      .join('\n');
    for (const m of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?(?:public\.)?([A-Za-z0-9_]+)["`]?\s*\(/gi)) {
      names.add(m[1].toLowerCase());
    }
  }
  return names;
}

const pg = tablesIn(PG_DIR, (f) => f.endsWith('.postgres.sql') && !f.includes('.down.'));
const lite = tablesIn(SQLITE_DIR, (f) => f.endsWith('.sql'));

const onlyPg = [...pg].filter((t) => !lite.has(t)).sort();
const onlyLite = [...lite].filter((t) => !pg.has(t)).sort();

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ pgCount: pg.size, sqliteCount: lite.size, onlyPg, onlyLite }, null, 2));
  process.exit(0);
}

console.log('스키마 드리프트 (Postgres = 운영, SQLite = 개발 기본값)\n');
console.log(`  Postgres 표 ${pg.size}개 · SQLite 표 ${lite.size}개`);
console.log(`  운영에만 있는 표 ${onlyPg.length}개 · 개발에만 있는 표 ${onlyLite.length}개\n`);

if (onlyPg.length) {
  console.log('운영에만 있는 표 — 개발(SQLite)에서 이 기능은 꺼진다:');
  for (const t of onlyPg) console.log('  ·', t);
  console.log('');
}
if (onlyLite.length) {
  console.log('개발에만 있는 표 — 운영에 없으므로 이 경로는 운영에서 동작하지 않는다:');
  for (const t of onlyLite) console.log('  ·', t);
  console.log('');
}

/*
   ★★ 기록된 결정과 비교한다.

     드리프트 자체는 결함이 아니다(개발 편의를 위해 의도적으로 좁힐 수 있다).
     결함은 **아무도 모르는 드리프트**다. 문서에 적힌 목록과 실제가 어긋나면
     그 사실을 알린다 — 새 운영 표가 추가됐는데 아무도 판단하지 않은 상태다.
*/
const DOC = join(ROOT, 'docs/schema-drift.md');
if (!existsSync(DOC)) {
  console.log(`기록 없음: ${DOC} 를 만들어 어떤 표를 개발에서 포기하는지 적으십시오.`);
  process.exit(1);
}
const doc = readFileSync(DOC, 'utf8');
const undocumented = onlyPg.filter((t) => !doc.includes(t));
if (undocumented.length) {
  console.log('★ 문서에 없는 새 드리프트 — 판단이 필요합니다:');
  for (const t of undocumented) console.log('  ·', t);
  console.log(`\n${DOC} 에 각 표를 어떻게 다룰지 적으십시오(개발에서 포기 / SQLite 에도 추가).`);
  process.exit(1);
}
console.log('모든 드리프트가 문서에 기록돼 있습니다.');
