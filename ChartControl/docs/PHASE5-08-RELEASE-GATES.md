# PHASE 5 — Release Gate Management

`docs/PRODUCTION-RELEASE-GATE.md` content is structured into the `release_gates` table (queryable via
`/api/admin/release-gates`). Each gate: gate id/key, phase, description, owner, exit criteria, status,
production_required, evidence (`release_gate_evidence`), reason, approvedBy, expiresAt, version, updatedAt.

## Statuses
NOT_STARTED, NOT_EXECUTED, IN_PROGRESS, PASSED, FAILED, WAIVED, BLOCKED.

## Guards (`evaluateReleaseGateUpdate`, unit-tested)
- **No fake pass**: a gate cannot move to PASSED without evidence.
- Only ADMIN/SUPER_ADMIN may update; only **SUPER_ADMIN** may WAIVE.
- WAIVED requires a reason + a **future** expiry; a **production-required** gate's waiver cannot exceed
  30 days (no permanent single-approver waiver).
- Pending items are seeded as **NOT_EXECUTED** and are never auto-Passed.

## Seeded pending gates (stay NOT_EXECUTED)
bitmart-stage-a, bitmart-private-ws-soak, controlled-live-order, live-openai, live-model-eval,
live-ai-e2e, firefox-webkit-e2e, load-1k-10k, central-market-data-gateway, mfa.
These are owned by the AWS admin / operator and verified separately in a Live Validation pass — Phase 5
does not change any of them to Passed.

### backup-restore-pitr — 2026-09-08 검증됨 (일부)

`docs/BACKUP-RESTORE.md` 에 절차와 실측 결과가 있다. **논리 백업 경로는 4단계 전부
확인했다** — 덤프 → 복구(오류 0) → 데이터 대조(일치) → **자격증명 복호화 3/3**.
마지막 단계가 핵심이다. 행 수가 맞아도 키를 풀 수 없으면 서비스를 되살릴 수 없다.

아직 남은 것(과금·승인이 필요해 개발이 결정하지 못한다):

- **Render PITR 복구 실전 시험** — 새 인스턴스가 과금된다. PITR 자체는
  `AVAILABLE`(2026-09-04 부터)로 확인했지만 복구를 눌러 본 적은 없다.
- **덤프 자동화·외부 보관** — 지금은 수동 실행이다. Render 안에만 두면 Render
  사고에서 함께 사라진다.
- **KEK 별도 보관** — KEK 이 Render 환경변수에만 있으면 DB 와 동시에 잃는다.
  그러면 덤프가 있어도 자격증명은 못 살린다.
