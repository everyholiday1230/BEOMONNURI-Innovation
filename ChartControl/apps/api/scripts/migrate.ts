/**
 * Postgres 마이그레이션 실행.
 *
 * 사용:
 *   DATABASE_URL=postgres://... npx tsx scripts/migrate.ts up
 *   DATABASE_URL=postgres://... npx tsx scripts/migrate.ts status
 *
 * ★ down 은 일부러 넣지 않았다. 되돌리기는 데이터를 지우므로 실수 한 번에
 *   사용자 데이터가 사라진다. 필요하면 migrateDown 을 직접 호출할 것.
 */
import { createPool, migrateUp } from '../src/db/pg';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL 이 필요하다');
  process.exit(1);
}
if (!/^postgres(ql)?:\/\//.test(url)) {
  // sqlite 경로를 실수로 넘기면 조용히 아무 것도 하지 않는다. 명시적으로 거부한다.
  console.error(`DATABASE_URL 이 postgres 가 아니다: ${url.slice(0, 24)}...`);
  process.exit(1);
}

const cmd = process.argv[2] ?? 'up';
const pool = createPool(url);

try {
  if (cmd === 'status') {
    const r = await pool.query<{ version: string; applied_at: Date }>(
      'SELECT version, applied_at FROM schema_migrations ORDER BY version',
    );
    console.log(`적용된 마이그레이션 ${r.rowCount}개:`);
    for (const row of r.rows) console.log(`  ${row.version}  ${row.applied_at.toISOString()}`);
  } else {
    const applied = await migrateUp(pool);
    console.log(applied.length ? `적용: ${applied.length}개` : '적용할 마이그레이션 없음');
    for (const v of applied) console.log(`  + ${v}`);
  }
} finally {
  await pool.end();
}
