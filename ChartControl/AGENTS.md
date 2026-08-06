# AGENTS.md — QuantumTrade AI 작업 규약

신규 합류자·AI 에이전트가 이 저장소에서 작업하기 위해 처음 읽는 문서.

## 0. 절대규칙

**`.kiro/steering/00-absolute-rules.md`를 먼저 읽는다.** 요약:

1. 추측·거짓·과장 금지. 검증하지 않은 것을 "완료"라고 쓰지 않는다.
2. 코드 변경 후 항상 `pnpm -r typecheck` → `pnpm -r test` → `pnpm build`, exit code 확인.
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

Postgres/Redis 통합 테스트는 환경변수가 없으면 자동 skip된다. **반드시 실제로 돌릴 것**:

```bash
docker run -d --name qt-pg-verify -e POSTGRES_USER=newchart -e POSTGRES_PASSWORD=newchart \
  -e POSTGRES_DB=qtdb_verify -p 127.0.0.1:15499:5432 postgres:16-alpine
docker run -d --name qt-redis-verify -p 127.0.0.1:16399:6379 redis:7-alpine

export PG_TEST_URL="postgres://newchart:newchart@127.0.0.1:15499/qtdb_verify"
export REDIS_TEST_URL="redis://127.0.0.1:16399"
pnpm -r test

docker rm -f qt-pg-verify qt-redis-verify
```

포트 15432/16379는 이 머신의 다른 프로젝트가 점유 중이므로 15499/16399를 쓴다.

## 4. 프론트엔드 계약

API 응답 스키마의 원천은 `../team_delivery/src/mock-app-data.js`다. 새 엔드포인트를 만들 때
이 파일의 데이터 구조를 그대로 따르고, `packages/schemas`에 Zod 스키마로 고정한다.

UX 계약(변경 금지)은 `.kiro/steering/00-absolute-rules.md` §5 참조.

## 5. 커밋

- 사용자가 명시적으로 요청할 때만 커밋한다.
- `main`에 직접 push 금지.
- `.env`, 자격증명 파일은 절대 커밋하지 않는다 (`.gitleaks.toml` 참조).
