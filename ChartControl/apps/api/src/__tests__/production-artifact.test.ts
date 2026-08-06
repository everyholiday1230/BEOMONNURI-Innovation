import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  DEV_FIXTURE_IDENTIFIER_HASHES,
  DevSeedAccountDetectedError,
  assertNoDevFixtures,
  hashIdentifier,
  isDevFixtureIdentifier,
  normalizeIdentifier,
  scanForDevFixtures,
} from '../security/dev-fixture-guard';
import { DEV_SEED_USERS, DevSeedForbiddenError, runDevSeed } from '../dev/seed';
import { assertProductionSigningKeys, loadEnv } from '../env';

/**
 * Phase 7 §6 — production artifact / dev-seed isolation regression.
 *
 * Source-level and logic-level assertions live here so they run inside `pnpm test` with no Docker or
 * build dependency. The artifact-level checks (built `dist`, container filesystem export, image
 * layers, and the real process start-up scenarios) are executed by
 * `scripts/phase7-seed-isolation-regression.sh` and `scripts/phase7-artifact-scan.sh`, because they
 * need a build and a container runtime.
 */

const API_SRC = fileURLToPath(new URL('..', import.meta.url));
const read = (rel: string) => readFileSync(join(API_SRC, rel), 'utf8');

/** Files that make up the production import graph reachable from src/index.ts. */
const PRODUCTION_SOURCES = ['index.ts', 'env.ts', 'auth-routes.ts', 'trading-routes.ts', 'ai-routes.ts'];

describe('production source graph carries no development credentials', () => {
  it('the dev fixture module is the only place holding fixture passwords', () => {
    const seed = read('dev/seed.ts');
    // Sanity: the fixture module really does contain the fixtures (otherwise the test below is vacuous).
    expect(seed).toContain('@qt.local');
    expect(DEV_SEED_USERS.length).toBeGreaterThan(0);
  });

  it.each(PRODUCTION_SOURCES)('%s contains no dev fixture identifier or password', (file) => {
    const src = read(file);
    // Token-level digest comparison: the literals are never written into this test either.
    const tokens = src.match(/[A-Za-z0-9@._+-]{6,120}/g) ?? [];
    const fixtureTokens = new Set<string>();
    for (const u of DEV_SEED_USERS) {
      fixtureTokens.add(hashIdentifier(u.email));
      fixtureTokens.add(createHash('sha256').update(u.password.toLowerCase()).digest('hex'));
    }
    const hits = tokens.filter((t) =>
      fixtureTokens.has(createHash('sha256').update(t.trim().toLowerCase()).digest('hex')),
    );
    expect(hits, `${file} must not embed dev fixture credentials`).toEqual([]);
  });

  it('index.ts does not statically import the dev seed module', () => {
    const src = read('index.ts');
    expect(src).not.toMatch(/^\s*import\s+.*['"]\.\/dev\/seed(\.js)?['"]/m);
    expect(src).not.toMatch(/import\(\s*['"]\.\/dev\/seed/);
  });

  it('env.ts ships no hard-coded development signing key', () => {
    const src = read('env.ts');
    expect(src).not.toMatch(/insecure[-_](csrf|signing|session)[-_]key/i);
    // The dev fallback must be generated, not a literal.
    expect(src).toMatch(/ephemeralDevKey/);
    expect(src).toMatch(/randomBytes\(32\)/);
  });

  it('the tsup production entry is limited to src/index.ts', () => {
    const cfg = read('../tsup.config.ts');
    expect(cfg).toMatch(/entry:\s*\['src\/index\.ts'\]/);
    expect(cfg).toMatch(/sourcemap:\s*false/);
    expect(cfg).not.toMatch(/src\/dev/);
  });

  it('the dev seed directory is not referenced by any production source', () => {
    for (const file of PRODUCTION_SOURCES) {
      const src = read(file);
      // The only permitted mention is the runtime-assembled specifier + explanatory comments.
      const literalImports = src.match(/from\s+['"][^'"]*\/dev\/[^'"]*['"]/g) ?? [];
      expect(literalImports, `${file} must not import from src/dev`).toEqual([]);
    }
  });
});

describe('dev fixture guard policy stays in sync with the fixtures', () => {
  it('holds exactly one hash per dev fixture identifier', () => {
    const expected = DEV_SEED_USERS.map((u) => hashIdentifier(u.email)).sort();
    expect([...DEV_FIXTURE_IDENTIFIER_HASHES].sort()).toEqual(expected);
  });

  it('stores only digests — no plaintext identifier in the policy module', () => {
    const src = read('security/dev-fixture-guard.ts');
    expect(src).not.toContain('@qt.local');
    for (const u of DEV_SEED_USERS) {
      expect(src).not.toContain(u.email);
      expect(src).not.toContain(u.password);
    }
    // Every entry is a 64-char lowercase hex digest.
    for (const h of DEV_FIXTURE_IDENTIFIER_HASHES) expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('normalizes identifiers before hashing (case + whitespace)', () => {
    const email = DEV_SEED_USERS[0]!.email;
    expect(normalizeIdentifier(`  ${email.toUpperCase()} `)).toBe(email);
    expect(isDevFixtureIdentifier(`  ${email.toUpperCase()} `)).toBe(true);
  });

  it('does not flag ordinary production identifiers', () => {
    for (const e of ['ops@example.com', 'trader1@corp.example', 'admin@example.com', '']) {
      expect(isDevFixtureIdentifier(e)).toBe(false);
    }
  });
});

describe('production start-up fails closed on a seeded database', () => {
  const fixtureEmail = DEV_SEED_USERS[0]!.email;

  it('throws DEV_SEED_ACCOUNT_DETECTED when a fixture identifier is present', () => {
    expect(() =>
      assertNoDevFixtures({ listIdentifiers: () => ['ops@example.com', fixtureEmail] }, true),
    ).toThrow(DevSeedAccountDetectedError);
  });

  it('throws when the explicit fixture marker is present even with no fixture identifiers', () => {
    expect(() =>
      assertNoDevFixtures(
        { listIdentifiers: () => ['ops@example.com'], hasFixtureMarker: () => true },
        true,
      ),
    ).toThrow(/DEV_SEED_ACCOUNT_DETECTED/);
  });

  it('passes on a clean production database', () => {
    const r = assertNoDevFixtures(
      { listIdentifiers: () => ['ops@example.com', 'trader@corp.example'], hasFixtureMarker: () => false },
      true,
    );
    expect(r).toEqual({ matches: 0, markerFound: false, inspected: 2 });
  });

  it('never blocks a non-production runtime', () => {
    const r = assertNoDevFixtures({ listIdentifiers: () => [fixtureEmail] }, false);
    expect(r.matches).toBe(1);
  });

  it('reports counts without exposing any identifier', () => {
    const r = scanForDevFixtures({ listIdentifiers: () => DEV_SEED_USERS.map((u) => u.email) });
    expect(r).toEqual({ matches: DEV_SEED_USERS.length, markerFound: false, inspected: DEV_SEED_USERS.length });
  });

  it('the failure message leaks no e-mail, no password and no user id', () => {
    let message = '';
    try {
      assertNoDevFixtures({ listIdentifiers: () => DEV_SEED_USERS.map((u) => u.email), hasFixtureMarker: () => true }, true);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('DEV_SEED_ACCOUNT_DETECTED');
    expect(message).not.toContain('@');
    for (const u of DEV_SEED_USERS) {
      expect(message).not.toContain(u.email);
      expect(message).not.toContain(u.password);
    }
    // Only aggregate counts are disclosed.
    expect(message).toMatch(/matches=\d+/);
  });

  it('exposes a stable machine-readable code and aggregate fields only', () => {
    const err = new DevSeedAccountDetectedError(3, true);
    expect(err.code).toBe('DEV_SEED_ACCOUNT_DETECTED');
    expect(err.matches).toBe(3);
    expect(err.markerFound).toBe(true);
    expect(Object.keys(err)).not.toContain('identifiers');
  });
});

describe('dev seed execution is refused in production', () => {
  const deps = () => ({
    register: async () => undefined,
    findUserId: () => 'u1',
    setUserRole: () => {},
    markSeeded: () => {},
  });

  it('runDevSeed throws DEV_SEED_FORBIDDEN when NODE_ENV=production', async () => {
    await expect(runDevSeed(deps(), 'production')).rejects.toBeInstanceOf(DevSeedForbiddenError);
  });

  it('runDevSeed processes every fixture in a dev runtime', async () => {
    const calls: string[] = [];
    const roles: Array<[string, string]> = [];
    let marked = false;
    const count = await runDevSeed(
      {
        register: async (i) => {
          calls.push(i.email);
        },
        findUserId: () => 'u1',
        setUserRole: (id, role) => roles.push([id, role]),
        markSeeded: () => {
          marked = true;
        },
      },
      'development',
    );
    expect(count).toBe(DEV_SEED_USERS.length);
    expect(calls).toEqual(DEV_SEED_USERS.map((u) => u.email));
    expect(roles.map(([, r]) => r)).toEqual(DEV_SEED_USERS.filter((u) => u.role).map((u) => u.role));
    expect(marked).toBe(true);
  });

  it('adminSeedEnabled is false in production even when ADMIN_SEED=true', () => {
    expect(loadEnv({ ADMIN_SEED: 'true', NODE_ENV: 'production' }).adminSeedEnabled).toBe(false);
    expect(loadEnv({ ADMIN_SEED: 'true', NODE_ENV: 'development' }).adminSeedEnabled).toBe(true);
    expect(loadEnv({ NODE_ENV: 'development' }).adminSeedEnabled).toBe(false);
  });
});

describe('production signing key is required, never defaulted', () => {
  it('rejects a missing or short AUTH_CSRF_KEY in production', () => {
    expect(() => assertProductionSigningKeys({ NODE_ENV: 'production' })).toThrow(/AUTH_CSRF_KEY/);
    expect(() => assertProductionSigningKeys({ NODE_ENV: 'production', AUTH_CSRF_KEY: 'short' })).toThrow(
      /AUTH_CSRF_KEY/,
    );
  });

  it('accepts a sufficiently long production key', () => {
    expect(() =>
      assertProductionSigningKeys({ NODE_ENV: 'production', AUTH_CSRF_KEY: 'x'.repeat(32) }),
    ).not.toThrow();
  });

  it('does not constrain non-production runtimes', () => {
    expect(() => assertProductionSigningKeys({ NODE_ENV: 'development' })).not.toThrow();
  });

  it('generates a distinct ephemeral dev key per load instead of a fixed literal', () => {
    const a = loadEnv({ NODE_ENV: 'development' }).csrfKey;
    const b = loadEnv({ NODE_ENV: 'development' }).csrfKey;
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(32);
    expect(a).not.toMatch(/insecure/i);
  });

  it('uses the provided key verbatim when supplied', () => {
    const key = 'y'.repeat(40);
    expect(loadEnv({ NODE_ENV: 'production', AUTH_CSRF_KEY: key }).csrfKey).toBe(key);
  });
});

describe('built artifact (only asserted when dist exists)', () => {
  const dist = join(API_SRC, '..', 'dist');

  it('emits no source map and no dev/test directory', () => {
    if (!existsSync(dist)) {
      // The artifact-level gate is scripts/phase7-artifact-scan.sh, run after `pnpm build`.
      expect(existsSync(dist)).toBe(false);
      return;
    }
    const entries = readdirSync(dist, { withFileTypes: true });
    expect(entries.filter((e) => e.name.endsWith('.map'))).toEqual([]);
    expect(entries.filter((e) => e.isDirectory() && ['dev', '__tests__', 'fixtures', 'test'].includes(e.name))).toEqual(
      [],
    );
  });

  it('contains no dev fixture credential', () => {
    const bundle = join(dist, 'index.js');
    if (!existsSync(bundle)) {
      expect(existsSync(bundle)).toBe(false);
      return;
    }
    const src = readFileSync(bundle, 'utf8');
    for (const u of DEV_SEED_USERS) {
      expect(src.includes(u.email), 'bundle must not contain a fixture e-mail').toBe(false);
      expect(src.includes(u.password), 'bundle must not contain a fixture password').toBe(false);
    }
    expect(src).not.toMatch(/insecure[-_](csrf|signing|session)[-_]key/i);
    expect(src).not.toContain('@qt.local');
  });
});
