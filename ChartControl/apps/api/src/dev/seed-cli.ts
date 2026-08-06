/**
 * DEV / E2E ONLY seed command (Phase 7 §3). Run explicitly:
 *
 *   pnpm --filter @quantumtrade/api seed:dev            # uses SQLITE_PATH or .data/quantumtrade.db
 *   SQLITE_PATH=.data/e2e.db pnpm --filter @quantumtrade/api seed:dev
 *
 * Refuses to run when `NODE_ENV=production` — the command itself exits non-zero before touching the
 * database. Not part of the production bundle (`tsup.config.ts` bundles only `src/index.ts`) and not
 * copied into the runtime container image (which receives `dist/` + production `node_modules` only).
 */
import { AuthService, MailSink } from '@quantumtrade/auth';
import { openDb } from '../db/sqlite';
import {
  SqliteUserRepository,
  SqliteSessionRepository,
  SqliteAuditRepository,
  SqliteTokenRepository,
} from '../db/repos';
import { SqliteAdminRepo } from '../db/admin-repos';
import { runDevSeed, DevSeedForbiddenError } from './seed';

async function main(): Promise<number> {
  if (process.env.NODE_ENV === 'production') {
    // Refuse before opening a connection: a production database must never be seeded.
    console.error('[seed:dev] REFUSED: NODE_ENV=production — the dev seed command is disabled in production.');
    return 2;
  }

  const sqlitePath = process.env.SQLITE_PATH ?? '.data/quantumtrade.db';
  const db = openDb(sqlitePath);
  const auditRepo = new SqliteAuditRepository(db);
  const authService = new AuthService(
    new SqliteUserRepository(db),
    new SqliteSessionRepository(db),
    auditRepo,
    {
      emailTokens: new SqliteTokenRepository(db, 'email_verification_tokens'),
      resetTokens: new SqliteTokenRepository(db, 'password_reset_tokens'),
      mail: new MailSink(),
    },
  );
  const adminRepo = new SqliteAdminRepo(db);

  try {
    const count = await runDevSeed({
      register: (input) => authService.register(input),
      findUserId: (email) =>
        (db.prepare('SELECT id FROM users WHERE email=?').get(email) as { id: string } | undefined)?.id,
      setUserRole: (userId, role) => adminRepo.setUserRole(userId, role),
      markSeeded: () => adminRepo.seedFlag('e2e_seed', true, 'e2e seed marker'),
      log: (message) => console.log(message),
    });
    console.log(`[seed:dev] done (${count} fixtures, sqlite=${sqlitePath})`);
    return 0;
  } catch (e) {
    if (e instanceof DevSeedForbiddenError) {
      console.error('[seed:dev] REFUSED:', e.message);
      return 2;
    }
    console.error('[seed:dev] FAILED:', (e as Error).message);
    return 1;
  }
}

process.exit(await main());
