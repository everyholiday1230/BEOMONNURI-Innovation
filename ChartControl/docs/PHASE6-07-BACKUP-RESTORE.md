# PHASE 6-07 — PostgreSQL Backup & Restore

Script: `scripts/phase6-backup-restore.sh` — a REAL drill against the local PostgreSQL 17 container
(`127.0.0.1:15432`). Log: `artifacts/logs/phase6-backup-restore.log`.

## Executed (local, real)
1. Provision source DB with users/orders/audit/ai_usage sample data (50/500/200/120 rows).
2. **Backup**: `pg_dump` (PG17, via container to match server version) → `gzip` → `openssl aes-256-cbc`
   (encryption-at-rest). Encrypted artifact produced.
3. **Restore** into a fresh DB from the encrypted backup; **RTO measured = 136 ms** (dataset scale).
4. **Integrity check**: row-count parity across all tables AND an `md5(string_agg(...))` checksum of the
   orders table → **PASS** (source == restored).
5. **Migration up/down/re-up** DDL replay on the restored DB → **OK**.
6. **RPO**: snapshot backup ⇒ recovery point = backup instant (0s data loss at that instant for the
   dump-based scheme).

## Result
`integrity=PASS · RTO=136ms · RPO=snapshot · encrypted=yes · migration up/down/re-up=OK`.

## Backup governance (documented)
- Encryption: AES-256 at rest (demo key; production uses KMS-managed key).
- Retention / schedule: cron/managed policy (documented; enforced by the managed platform).
- Access control: backup bucket/role restricted; **restore is an audited admin action**.

## Not Executed
- **Managed PostgreSQL Point-in-Time Recovery** (WAL archiving + base backups on a managed instance) →
  **Not Executed** (no managed PG). The local dump/restore drill is the executed substitute per scope.
