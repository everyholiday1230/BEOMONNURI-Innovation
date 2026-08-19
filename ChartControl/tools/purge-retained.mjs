/*
   분리 보관 기록의 파기
   ------------------------------------------------------------
   왜 필요한가
     우리 개인정보처리방침(§6)은 "법령이 보관을 요구하는 정보는 그 기간 동안
     분리 보관한 뒤 **파기**합니다" 라고 약속했다. 옮기는 것만 만들고 파기를
     만들지 않으면 보관 기간이 지난 개인정보가 영구히 쌓인다 — 그것 자체가
     방침 위반이고, 유출되면 이미 지웠어야 할 자료가 유출되는 셈이다.

   무엇을 지우는가
     `retained_legal_consents` · `retained_orders` 에서 `purge_after` 가 지난 행.
     기간은 옮길 때 행마다 적어 두었으므로(마이그레이션 0022) 이 도구는 기간
     상수를 갖지 않는다 — 나중에 방침이 바뀌어도 이미 보관 중인 행의 기준이
     흔들리지 않는다.

   ★ `user_deletion_records` 는 지우지 않는다.
     삭제 처리가 적법했음을 보이는 근거이고, 담긴 개인정보는 이메일뿐이다.
     이것을 지우면 "왜 지웠나" 에 답할 수 없다.

   사용법
     node tools/purge-retained.mjs           # 무엇을 지울지 보여주기만 한다
     node tools/purge-retained.mjs --apply   # 실제로 지운다

   ★ 기본이 미리보기다. 되돌릴 수 없는 삭제를 실수로 실행하지 않게 한다.
     운영에서는 하루 한 번 도는 작업으로 등록한다.

   ★ psql 을 쓴다(pg 모듈은 이 저장소 루트의 의존성이 아니다).
     tools/db-persistence-check.mjs 와 같은 방식이다.

   환경변수 (전부 필수 — 비밀번호를 코드에 두지 않는다)
     PGHOST · PGPORT · PGUSER · PGPASSWORD · PGDATABASE
*/

import { execFileSync } from 'node:child_process';
import { env, exit, argv } from 'node:process';

const APPLY = argv.includes('--apply');

const PG = {
  host: env.PGHOST,
  port: env.PGPORT,
  user: env.PGUSER,
  password: env.PGPASSWORD,
  db: env.PGDATABASE,
};

{
  // 실제 환경변수 이름으로 안내한다(내부 키 이름이 아니라 — db 는 PGDATABASE 다).
  const ENV_NAME = { host: 'PGHOST', port: 'PGPORT', user: 'PGUSER', password: 'PGPASSWORD', db: 'PGDATABASE' };
  const missing = Object.entries(PG).filter(([, v]) => !v).map(([k]) => ENV_NAME[k]);
  if (missing.length) {
    console.error(`데이터베이스 접속 정보가 없다. 다음 환경변수를 설정할 것: ${missing.join(', ')}`);
    console.error('예: PGHOST=127.0.0.1 PGPORT=5432 PGUSER=… PGPASSWORD=… PGDATABASE=… node tools/purge-retained.mjs');
    exit(2);
  }
}

function sql(query) {
  try {
    return execFileSync(
      'psql',
      ['-h', PG.host, '-p', String(PG.port), '-U', PG.user, '-d', PG.db, '-qtAc', query],
      { env: { ...env, PGPASSWORD: PG.password }, encoding: 'utf8' },
    ).trim();
  } catch (e) {
    return `ERR:${String(e.message || e).slice(0, 120)}`;
  }
}

function num(v) {
  return v.startsWith('ERR:') ? -1 : Number(v || 0);
}

const TABLES = [
  { name: 'retained_legal_consents', what: '약관 동의 기록 (방침 1절 · 5년)' },
  { name: 'retained_orders', what: '주문 기록 (방침 1절 · 5년)' },
];

console.log(APPLY ? '=== 분리 보관 파기 실행 ===' : '=== 분리 보관 파기 미리보기 (지우지 않는다) ===');
console.log();

let totalDue = 0;
let failed = false;

for (const t of TABLES) {
  // 테이블이 없으면(마이그레이션 0022 미적용) 오류로 다루지 않는다 — 배치가 멈추면 안 된다.
  const exists = sql(
    `SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='${t.name}'`,
  );
  if (num(exists) !== 1) {
    console.log(`  ${t.name.padEnd(26)} 테이블 없음 (마이그레이션 0022 미적용)`);
    continue;
  }

  const total = num(sql(`SELECT count(*) FROM ${t.name}`));
  const due = num(sql(`SELECT count(*) FROM ${t.name} WHERE purge_after <= now()`));
  const next = sql(`SELECT COALESCE(to_char(min(purge_after),'YYYY-MM-DD'),'없음') FROM ${t.name} WHERE purge_after > now()`);

  if (total < 0 || due < 0) { failed = true; console.log(`  ${t.name.padEnd(26)} 조회 실패`); continue; }

  totalDue += due;
  console.log(`  ${t.name.padEnd(26)} 보관 ${String(total).padStart(6)}행 · 파기 대상 ${String(due).padStart(6)}행`);
  console.log(`  ${''.padEnd(26)} ${t.what} · 다음 파기 예정 ${next}`);

  if (APPLY && due > 0) {
    const r = sql(`DELETE FROM ${t.name} WHERE purge_after <= now()`);
    if (String(r).startsWith('ERR:')) { failed = true; console.log(`  ${''.padEnd(26)} → 파기 실패: ${r}`); }
    else console.log(`  ${''.padEnd(26)} → ${due}행 파기했다`);
  }
  console.log();
}

/*
   삭제 처리 기록은 파기 대상이 아니다.
   이 안내를 남기는 이유: "그것도 지워야 하나" 를 매번 다시 판단하지 않게.
*/
const hasRec = num(sql(
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='user_deletion_records'",
));
if (hasRec === 1) {
  const n = num(sql('SELECT count(*) FROM user_deletion_records'));
  console.log(`  user_deletion_records ${n}행 — 영구 보존(파기하지 않는다).`);
  console.log('  삭제 처리가 적법했음을 보이는 근거다.');
  console.log();
}

if (failed) {
  console.log('  ★ 일부 작업이 실패했다. 위 메시지를 확인할 것.');
  exit(1);
}

if (!APPLY) {
  if (totalDue > 0) {
    console.log(`  파기 대상 ${totalDue}행. 실제로 지우려면 --apply 를 붙일 것. 되돌릴 수 없다.`);
  } else {
    console.log('  파기 대상이 없다.');
  }
}

exit(0);
