import { createHash } from 'node:crypto';

/**
 * Production guard: refuse to start if the production database still contains known development /
 * E2E fixture accounts (Phase 7 §4).
 *
 * The plaintext fixture identifiers deliberately do NOT appear here — only their SHA-256 digests, so
 * the production bundle carries no development e-mail address or password. Detection normalizes each
 * identifier read from the database (trim + lowercase) and compares digests.
 *
 * Nothing about the offending row is logged: no e-mail, no user id, no password, no row count per
 * account. The failure surfaces as the opaque code `DEV_SEED_ACCOUNT_DETECTED` plus the number of
 * matches, which is enough for an operator to act without leaking user data into logs.
 *
 * Digests are of the normalized fixture e-mail addresses defined in `apps/api/src/dev/seed.ts`
 * (dev-only module, excluded from the production bundle). `dev-fixture-guard.test.ts` asserts the two
 * lists stay in sync, so a new fixture cannot silently escape detection.
 */

/** SHA-256 (hex) of each normalized dev fixture identifier. Order is not significant. */
export const DEV_FIXTURE_IDENTIFIER_HASHES: readonly string[] = [
  'c5e786688e2d2852061c72783fcf13855a0858b37b9e62b10944f8579d13d9d8',
  'ada11dea291d6d8cb0f638f66ac03aa7e275141622c620defbda4bdae9aa0b86',
  'f257cdeb2b16d6aa30b17abcf2193cd0b36ae49877ada543bb5bd52642796701',
  '3c4388e44ac4e6916e6c26eaa9689e02594411b47a23a9346c2441691c05eb24',
  '7f81a7a4f7bf7ebdeb92533bb05011216ce2c77d0e0ca322f540abcd46a0c744',
  '9440b2de45de8c1e536ff9128cb481c9cb1306ba1b4c5d81c3d57c26b7948d9d',
];

const HASH_SET: ReadonlySet<string> = new Set(DEV_FIXTURE_IDENTIFIER_HASHES);

/** Normalize an identifier the same way the digests were produced: trim + lowercase. */
export function normalizeIdentifier(identifier: string): string {
  return identifier.trim().toLowerCase();
}

/** SHA-256 (hex) of a normalized identifier. */
export function hashIdentifier(identifier: string): string {
  return createHash('sha256').update(normalizeIdentifier(identifier), 'utf8').digest('hex');
}

/** True when the identifier is a known development/E2E fixture. */
export function isDevFixtureIdentifier(identifier: string): boolean {
  return HASH_SET.has(hashIdentifier(identifier));
}

export class DevSeedAccountDetectedError extends Error {
  readonly code = 'DEV_SEED_ACCOUNT_DETECTED';
  /** How many stored identifiers matched a known fixture digest. No identifier is exposed. */
  readonly matches: number;
  /** Whether an explicit seed/test-fixture metadata marker was found. */
  readonly markerFound: boolean;

  constructor(matches: number, markerFound: boolean) {
    super(
      'DEV_SEED_ACCOUNT_DETECTED: the production database contains development/E2E fixture data ' +
        `(identifier matches=${matches}, fixture marker=${markerFound}). ` +
        'Refusing to start. Remove the fixture data from the production database, or point the ' +
        'service at a clean production database.',
    );
    this.name = 'DevSeedAccountDetectedError';
    this.matches = matches;
    this.markerFound = markerFound;
  }
}

export interface DevFixtureScanSource {
  /** All user identifiers (e-mail addresses) currently stored. */
  listIdentifiers(): Iterable<string>;
  /**
   * Explicit fixture metadata, when the schema carries it (e.g. a `seed_origin` / `test_fixture`
   * column or the `e2e_seed` feature flag). Preferred over hash matching when available.
   */
  hasFixtureMarker?(): boolean;
}

export interface DevFixtureScanResult {
  matches: number;
  markerFound: boolean;
  /** Total identifiers inspected — useful for operators, reveals nothing about any individual. */
  inspected: number;
}

/** Count fixture matches without revealing which identifiers matched. */
export function scanForDevFixtures(source: DevFixtureScanSource): DevFixtureScanResult {
  let matches = 0;
  let inspected = 0;
  for (const identifier of source.listIdentifiers()) {
    inspected += 1;
    if (typeof identifier === 'string' && isDevFixtureIdentifier(identifier)) matches += 1;
  }
  const markerFound = source.hasFixtureMarker?.() ?? false;
  return { matches, markerFound, inspected };
}

/**
 * Fail-closed production assertion. Throws `DevSeedAccountDetectedError` when fixture data is
 * present. A non-production runtime is never blocked.
 */
export function assertNoDevFixtures(
  source: DevFixtureScanSource,
  isProduction: boolean,
): DevFixtureScanResult {
  const result = scanForDevFixtures(source);
  if (isProduction && (result.matches > 0 || result.markerFound)) {
    throw new DevSeedAccountDetectedError(result.matches, result.markerFound);
  }
  return result;
}
