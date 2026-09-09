# AGENTS.md — QuantumTrade AI 작업 규약

신규 합류자·AI 에이전트가 이 저장소에서 작업하기 위해 처음 읽는 문서.

## 0. 절대규칙

**`.kiro/steering/00-absolute-rules.md`를 먼저 읽는다.** 요약:

1. 추측·거짓·과장 금지. 검증하지 않은 것을 "완료"라고 쓰지 않는다.
2. 코드 변경 후 항상 `pnpm -r typecheck` → `pnpm -r test` → `pnpm build`, exit code 확인.
   **단 `pnpm -r test` 만으로는 부족하다 — §3 을 반드시 읽을 것.**
   **★★ 그리고 `typecheck` 는 마지막에 파일을 만든 뒤 한 번 더 돌릴 것 — §3-3.**
3. 지시받지 않은 연관 업무도 선제 수행. 단 파괴적 작업·프로덕션 변경·벤더 선정은 사전 승인.
4. 목표는 서비스 출시.

## 1. 도구 계층 구조

이 프로젝트는 Kiro CLI로 개발한다. 두 계층을 구분할 것:

| 계층 | 무엇 | 어디서 설정 |
|---|---|---|
| **Kiro CLI** (하네스) | 툴(read/write/shell/grep/code), 권한, 컨텍스트, 세션 | `.kiro/agents/*.json` |
| **모델** (추론 엔진) | claude-opus-5 | `.kiro/settings/cli.json` |

둘은 대안이 아니라 위아래로 쌓인 구조다. 모델을 바꿔도 툴과 권한은 그대로다.

### 신규 합류자 시작 방법

```bash
git clone <repo> && cd quantumtrade-ai
pnpm install
kiro-cli chat --agent qt-backend
```

`.kiro/`가 저장소에 커밋되어 있으므로 모델(claude-opus-5) · effort(high) · 툴 권한 ·
절대규칙 steering이 자동으로 동일하게 적용된다. 개인 `~/.kiro/` 설정보다
워크스페이스 `.kiro/`가 우선한다.

사용 가능한 모델은 리전에 따라 다르다. `/model`로 `claude-opus-5`가 목록에 있는지 확인할 것.
없으면 `.kiro/settings/cli.json`의 `chat.defaultModel`을 수정한다.

## 2. 저장소 구조

```
apps/api               Hono BFF — REST/SSE, 인증, 주문, 관리자 (주 작업 대상)
apps/market-gateway    WebSocket 게이트웨이 서버
apps/broker-web        ⭐ 신규 프론트엔드 — 2026-08-02 핸드오프 42라우트 (dev 5174)
apps/web               이전 프론트엔드 15라우트 (dev 5173). 삭제하지 않음 — API 연동 참조 구현
apps/admin             관리자 콘솔
packages/schemas       Zod 스키마 (API 계약의 단일 출처)
packages/domain        주문 수학 · 상태 머신
packages/auth, mfa, security          인증 · TOTP · 보안
packages/exchange-adapters, exchange-bitmart   거래소 어댑터
packages/design-tokens 디자인 시스템 CSS (tokens/base/components/widgets/pages/pages-auth)
packages/ai            AI 오케스트레이션
packages/admin-domain, admin-schemas  관리자 도메인
infrastructure/postgres  마이그레이션 0001~0009 (up/down 쌍)
docs/                  아키텍처 · API 계약 · ADR · phase 리포트
../team_delivery/      디자이너 프론트엔드 핸드오프 (API 스키마 + 페이지 이식 원본)
```

## 2-1. 사업 모델 — BitMart API 브로커 (non-custodial)

**`docs/PHASE8-02-DECISIONS.md`를 반드시 읽을 것.** 요점:

- 우리는 BitMart API Broker다 (Broker ID `BEOMONNURI12345`, Standard 40%).
- **사용자 자금을 보관하지 않는다.** 사용자가 본인 거래소 계정의 API 키를 우리 페이지에
  입력하고, 우리는 그 키로 주문을 중계한다. KYC도 거래소가 수행한다.
- 따라서 핸드오프 디자인의 입금/출금/Hot·Cold 지갑/Reserve Ratio 페이지는 **그대로 구현하면
  안 된다.** 재설계 대상이다.
- 주문 요청에는 `X-BM-BROKER-ID` 헤더가 필요하다 (서명 payload에는 포함되지 않음).

## 2-2. 페이지 이식 규칙 (`apps/broker-web`)

- 라우트·역할·이식 상태의 단일 출처는 `apps/broker-web/src/routes.ts`다. 사이드바도 이 표에서
  파생된다.
- 아직 이식하지 않은 라우트는 `status: 'stub'`이며 `NotImplemented` 화면(“미구현 —
  NOT IMPLEMENTED”)을 렌더한다. **완성된 것처럼 보이는 placeholder를 만들지 말 것**
  (절대규칙 §4).
- 페이지를 이식하면 같은 커밋에서 `status`를 `'ported'`로 바꾸고
  `src/__tests__/routes.test.ts`의 `RT-04[2]` 기대값을 갱신한다. 갱신하지 않으면 테스트가
  실패한다 — 진행률을 과장할 수 없게 만든 장치다.


## 3. 검증 명령

```bash
pnpm install --frozen-lockfile
pnpm -r typecheck
pnpm -r test
pnpm build
```

### 3-1. Postgres 없이 돌리면 178개가 조용히 빠진다

`pnpm -r test` 를 그냥 돌리면 통과 숫자가 나오지만, **Postgres 통합 스위트는
`skipIf(!PG_TEST_URL)` 로 조용히 건너뛴다.** 빠지는 대상이 하필 운영 경로다 —
결제·포인트 주문 멱등 충전(`payment.test.ts`), 법적 문서·동의(`legal-repo`),
자격증명(`pg-credential-repo`), 공지, 자산 스냅샷, 차트 템플릿.

운영은 Postgres 로 돈다. SQLite 로만 통과한 것은 **운영을 검증한 것이 아니다.**

| 실행 방식 | passed | skipped |
|---|---|---|
| Postgres 없이 | ~1,320 | 194 |
| `PG_TEST_URL` 설정 | **~1,565** | 16 |

### 반드시 이렇게 돌린다

```bash
# 1) Postgres 를 띄운다 (docker 가 없으면 로컬 initdb 로도 된다)
export PATH=/usr/lib/postgresql/16/bin:$PATH
initdb -D /tmp/pgt -U postgres
pg_ctl -D /tmp/pgt -l /tmp/pgt.log \
  -o "-p 54240 -k /tmp -c listen_addresses=127.0.0.1 -c max_connections=300" start

# 2) PG_TEST_URL 을 주고 돌린다
PG_TEST_URL="postgres://postgres@127.0.0.1:54240/postgres" \
  pnpm --filter @quantumtrade/api exec vitest run
```

`max_connections` 를 올려 두는 이유: 스위트마다 **자기 전용 데이터베이스**를 만들어
(`__tests__/helpers/pg-test-db.ts` 의 `createIsolatedTestDatabase`) 병렬로 돈다.
기본값 100 이면 커넥션이 마른다.

### skip 개수를 반드시 본다

**`1,320 passed` 를 보고 안심하는 것이 문제의 본질이다.** skipped 가 194 면
Postgres 를 안 붙인 것이다. 붙였으면 16 이어야 한다(16 은 Redis·외부 의존
스위트로, 별도다).

```bash
# skip 이 몇 개인지 눈으로 확인한다
... vitest run 2>&1 | grep -E "^ *Tests "
```

### 3-3. ★★ typecheck 를 **마지막에** 한 번 더 돌린다

**vitest 는 타입을 검사하지 않는다.** esbuild 로 타입을 지우고 실행한다. 그래서
`3 passed` 와 `typecheck 0` 은 **아무 관계가 없다.**

실제로 이 함정에 빠졌다(커밋 `30717ac`). 순서가 이랬다:

```
1) pnpm -r typecheck   → 0        ← 이 시점엔 새 테스트 파일이 아직 없었다
2) 새 테스트 파일 작성
3) 그 테스트 실행       → 3 passed
4) 전체 테스트          → 1,516 passed
5) 커밋                            ← typecheck 를 다시 돌리지 않았다
```

결과: `main` 의 typecheck 게이트가 빨개져 **다른 사람의 배포가 막혔다.** 그때 막힌
것이 결제 수정(`d773e6f`)이었다 — 고객 돈이 걸린 더 급한 작업이었다.

원인이 된 코드:

```ts
// ✗ Record<string, unknown> 을 펼치면 반환 타입이 { id: unknown } 으로 좁혀진다.
//   원래 필드가 타입에서 사라져 r.type / r.points 접근이 컴파일되지 않는다.
const upd = (o: Record<string, unknown>, patch: Record<string, unknown>) => ({ ...o, ...patch, id: o.id });

// ✓ 제네릭으로 타입을 보존한다. 런타임 동작은 같다.
const upd = <T extends Record<string, unknown>>(o: T, patch: Record<string, unknown>): T =>
  ({ ...o, ...patch, id: o.id }) as T;
```

**규칙: 파일을 만들거나 고친 뒤가 마지막 단계라면, 커밋 직전에 typecheck 를 다시 돌린다.**

```bash
# 올바른 순서
파일 작성/수정 → 테스트 → pnpm -r typecheck → eslint → 커밋
```

★ "테스트가 통과하면 타입도 맞다" 고 가정하지 말 것. 그 가정이 이 사고의 원인이다.

### 새 Pg 스위트를 만들 때

`createIsolatedTestDatabase(PG_TEST_URL, '<스위트이름>')` 을 **반드시** 쓴다.
같은 데이터베이스를 공유하면 한 스위트가 `migrate down` 을 할 때 다른 스위트의
테이블이 사라진다. 그러면 단독으로는 통과하고 전체 실행에서만 실패해서, 원인을
찾는 데 오래 걸린다.


Postgres/Redis 통합 테스트는 환경변수가 없으면 자동 skip된다. **반드시 실제로 돌릴 것**:

```bash
docker run -d --name qt-pg-verify -e POSTGRES_USER=newchart -e POSTGRES_PASSWORD=newchart \
  -e POSTGRES_DB=qtdb_verify -p 127.0.0.1:15499:5432 postgres:16-alpine
docker run -d --name qt-redis-verify -p 127.0.0.1:16399:6379 redis:7-alpine

export PG_TEST_URL="postgres://newchart:newchart@127.0.0.1:15499/qtdb_verify"
export REDIS_URL="redis://127.0.0.1:16399"      # ★ REDIS_TEST_URL 이 아니다 — 아래 설명 참고
pnpm -r test

docker rm -f qt-pg-verify qt-redis-verify
```

포트 15432/16379는 이 머신의 다른 프로젝트가 점유 중이므로 15499/16399를 쓴다.

**★★ `REDIS_URL` 이다. 예전 이 문서는 `REDIS_TEST_URL` 이라고 적어 두었는데 코드는
그 이름을 읽지 않는다**(`packages/cluster` 는 `REDIS_URL` 만 본다). 그래서 문서대로
설정하면 Redis 통합 시험이 조용히 건너뛰어지고, "돌렸다" 고 착각하게 된다.

PG 쪽은 `PG_TEST_URL` 이 맞다 — 두 이름이 다른 것은 혼란스럽지만 코드가 그렇다.

## 4. 프론트엔드 계약

API 응답 스키마의 원천은 `../team_delivery/src/mock-app-data.js`다. 새 엔드포인트를 만들 때
이 파일의 데이터 구조를 그대로 따르고, `packages/schemas`에 Zod 스키마로 고정한다.

UX 계약(변경 금지)은 `.kiro/steering/00-absolute-rules.md` §5 참조.

## 5. 커밋

- 사용자가 명시적으로 요청할 때만 커밋한다.
- `main`에 직접 push 금지.
- `.env`, 자격증명 파일은 절대 커밋하지 않는다 (`.gitleaks.toml` 참조).
