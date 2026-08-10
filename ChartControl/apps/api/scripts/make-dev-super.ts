/**
 * 개발용 관리자 계정 생성/갱신.
 *
 * 왜 스크립트인가
 * -------------
 * 가입 API 로는 만들 수 없다 — 이메일 형식이 필수이고 비밀번호가 최소 10자다.
 * 그 정책은 실사용자를 지키는 장치이므로 완화하지 않는다. 대신 개발 계정만
 * 여기서 직접 넣는다.
 *
 * 그리고 자기 등급을 스스로 올리는 API 는 존재해서는 안 된다(있으면 누구나
 * 관리자가 된다). 그래서 등급 부여도 이 스크립트에서만 한다.
 *
 * 사용:
 *   npx tsx scripts/make-dev-super.ts <email> <password> [role]
 *
 * ★ 운영 환경에서 실행하지 말 것. 약한 비밀번호로 최고 권한 계정을 만들 수 있다.
 */
import { randomUUID } from 'node:crypto';

import { hashPassword } from '@quantumtrade/auth';

import { createPool } from '../src/db/pg';
import { openDb } from '../src/db/sqlite';

const [emailArg, passwordArg, roleArg] = process.argv.slice(2);
if (!emailArg || !passwordArg) {
  console.error('사용법: npx tsx scripts/make-dev-super.ts <email> <password> [role]');
  process.exit(1);
}

const email = emailArg.toLowerCase();
const role = roleArg ?? 'SUPER_ADMIN';
const now = Date.now();
const hash = hashPassword(passwordArg);

/*
   서버가 쓰는 것과 **같은 저장소**에 만들어야 한다.

   DATABASE_URL 이 있으면 서버는 Postgres 를 쓴다. 그때 sqlite 에 계정을 만들면
   생성은 성공했다고 나오는데 로그인은 실패한다 — 원인 추적이 어려운 실패다
   (실제로 겪었다).
*/
const databaseUrl = process.env.DATABASE_URL?.trim();
const usePostgres = Boolean(databaseUrl && /^postgres(ql)?:\/\//i.test(databaseUrl));

if (usePostgres) {
  const pool = createPool(databaseUrl as string);
  try {
    const found = await pool.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [email]);
    if (found.rowCount) {
      /*
         Postgres 스키마는 timestamptz 를 쓴다. sqlite 는 밀리초 정수였다.
         정수를 그대로 넘기면 "date/time field value out of range" 로 실패한다
         (실제로 겪었다). now() 를 DB 에 맡긴다 — 서버 시계가 기준이 되어
         여러 프로세스가 같은 시각을 쓴다.
      */
      await pool.query(
        `UPDATE users SET password_hash = $1, role = $2, status = 'active', email_verified = true, updated_at = now()
         WHERE id = $3`,
        [hash, role, found.rows[0]!.id],
      );
      console.log(`갱신(postgres): ${email} → role=${role}`);
    } else {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, role, status, mfa_enabled, email_verified, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'active', false, true, now(), now())`,
        [randomUUID(), email, hash, role],
      );
      console.log(`생성(postgres): ${email} → role=${role}`);
    }
    const check = await pool.query('SELECT email, role, status, email_verified FROM users WHERE email = $1', [email]);
    console.log('확인:', check.rows[0]);
  } finally {
    await pool.end();
  }
} else {
  const db = openDb(process.env.SQLITE_PATH ?? '.data/chartcontrol.db');
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: string } | undefined;
  if (existing) {
    db.prepare(
      `UPDATE users SET password_hash = ?, role = ?, status = 'active', email_verified = 1, updated_at = ?
       WHERE id = ?`,
    ).run(hash, role, now, existing.id);
    console.log(`갱신(sqlite): ${email} → role=${role}`);
  } else {
    db.prepare(
      `INSERT INTO users (id, email, password_hash, role, status, mfa_enabled, email_verified, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', 0, 1, ?, ?)`,
    ).run(randomUUID(), email, hash, role, now, now);
    console.log(`생성(sqlite): ${email} → role=${role}`);
  }
  console.log('확인:', db.prepare('SELECT email, role, status, email_verified FROM users WHERE email = ?').get(email));
}
