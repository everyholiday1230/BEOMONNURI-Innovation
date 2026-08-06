# PHASE 3 — Credential Security

`apps/api/src/trading/credential-vault.ts` + table `exchange_credentials`.

- **Envelope encryption**: random per-credential DEK (AES-256-GCM) encrypts accessKey/secretKey/memo;
  DEK is wrapped by a KEK. Dev: `LocalKekProvider` (32-byte KEK from `BITMART_DEV_KEK`, never in DB).
  Prod: `IKmsProvider` seam for AWS KMS (managed).
- **Persist ciphertext only**: `encrypted_*`, `wrapped_dek`, `encryption_key_version`, `algo`. No
  plaintext secret/memo ever stored, logged, or returned to the browser.
- **Masking**: only `access_key_masked` (e.g. `AKIA…7890`) is exposed; secret/memo fully removed.
- **Rotation**: `CredentialVault.rotate` re-wraps the DEK under a new KEK/version (plaintext recoverable).
- **Isolation**: `exchange_credentials.user_id` FK; all repo reads/writes scoped by user (cross-user → 404).
- **Audit**: create/verify/delete recorded; secrets redacted.
- Tests: round-trip, no-plaintext, tamper→GCM auth fail, rotation, masking (trading-core.test.ts).

## Runtime credential source (Secrets Manager, fail-closed) — `apps/api/src/trading/credential-source.ts`
- Production loads BitMart `{accessKey, secretKey, memo}` at runtime from **AWS Secrets Manager via the
  instance IAM role** — never from the prompt, never printed. The AWS SDK is an **optional** dependency
  loaded by dynamic import; absent SDK → fail-closed.
- `resolveCredentialProvider` is **fail-closed**: in production it defaults to `aws-secrets-manager` and
  **requires** `BITMART_SECRET_ARN`/`BITMART_SECRET_ID` + `AWS_REGION`; the dev `env` provider is
  **refused in production**. Missing config → throws (no silent degrade).
- **Redaction-safe**: `parseCredentialSecret` reports only field NAMES on error; AWS errors surface only
  the error class name — the secret value is never placed in messages/logs.
- Tested: `credential-source.test.ts` (11) — fail-closed resolution, AWS SM via injected client, parse +
  error redaction, SDK-absent fail-closed.
- KMS note: dev uses `LocalKekProvider`; production KMS + a live Secrets Manager fetch require the
  deployed image (SDK + secret id + IAM permissions) → **Not Executed** in this runtime (Stage A).

## Security hardening (2026-07-29)
- `@aws-sdk/client-secrets-manager@3.1097.0` is now an **explicit production dependency** of
  `@quantumtrade/api` (pinned exact), not an optional/absent import.
- **Startup fail-closed guard** (`assertProductionCredentialReadiness`, wired in `index.ts`): in
  production the server refuses to boot unless the AWS SDK is installed AND `BITMART_SECRET_ARN`
  (or `BITMART_SECRET_ID`) + `AWS_REGION` are set (`process.exit(1)` otherwise). Dev/e2e unaffected.
- Stage A probe is now `apps/api/src/trading/stage-a-probe.ts` and obtains credentials **only** via
  `credential-source.ts` → AWS Secrets Manager. It does **not** read the BitMart secret from env, CLI
  args, or files. The previous env-injection script (`scripts/phase3-stageA-live.mjs`) was **removed**.
- Log-output audit: no `console.*` prints access key / secret / memo / `X-BM-SIGN` / signing string
  (grep-verified). Secret scan (working tree + full git history, gitleaks-equivalent) is CLEAN —
  `artifacts/logs/phase3-secret-scan.log`.
