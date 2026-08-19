# 배포 절차

이 문서는 **순서대로** 따라가도록 만들었습니다. 각 단계에는 "성공했는지 확인하는
방법"이 있습니다. 확인 없이 다음으로 넘어가지 마십시오.

---

## 0. 배포 전에 반드시 알아야 할 것

### ★★ `NODE_ENV=production` 을 빠뜨리면 안전장치가 전부 조용히 꺼집니다

이 값이 없으면 다음이 **경고도 없이** 무효화됩니다.

| 안전장치 | 꺼지면 무슨 일이 |
|---|---|
| 서명키 검사 | 인스턴스마다 임시 CSRF 키를 만들어, 서버를 늘리면 검증이 깨집니다 |
| DB 준비 검사 | PostgreSQL 이 아니라 **SQLite 로 기동**합니다. 포인트·동의 기록이 로컬 파일에 남습니다 |
| 개발 계정 검사 | 테스트 계정이 남아 있어도 그대로 기동합니다 |

배포 파이프라인에서 이 값을 확인하는 단계를 넣으십시오.

### 현재 열려 있지 않은 것

배포해도 다음은 **동작하지 않습니다.** 의도된 상태입니다.

- **실주문** — `TRADING_MODE=MOCK` 이 기본값입니다. 여는 절차는 §7 에 있습니다.
- **AI 분석** — 자격증명이 없으면 `unavailable` 로 응답합니다. 목업으로 대체하지
  않으므로 사용자가 가짜 분석을 받는 일은 없습니다.
- **청산 경고(서버)** — `RISK_WATCH_ENABLED=false` 가 기본값입니다. 화면이 열려
  있을 때만 계산됩니다.
- **약관·개인정보** — 초안만 등록돼 있습니다. 게시는 법무 검토 후입니다.

---

## 1. 환경변수 준비

```bash
cp .env.production.example .env.production
```

값을 채웁니다. 무작위 키는 이렇게 만듭니다.

```bash
openssl rand -hex 32     # AUTH_CSRF_KEY
```

채운 뒤 **두 가지를 검사합니다.**

```bash
# 템플릿 자체가 코드와 맞는지 (이름이 틀리면 채워도 효과가 없습니다)
node tools/env-template-check.mjs

# 채운 값이 프로덕션에 쓸 수 있는지
node tools/launch-check.mjs --env .env.production
```

`launch-check` 는 **차단 / 경고 / 통과** 세 단계로 알려주고, 차단이 하나라도
있으면 종료코드 1 을 반환합니다. CI 에서 이 종료코드를 확인하십시오.

★ 이 점검은 "값이 있으면 통과" 로 판단하지 않습니다. 서명키에 `dev` `test`
`secret` 같은 낱말이 들어 있으면 차단합니다 — 개발용 키를 그대로 올리는 것이
가장 흔한 사고입니다.

---

## 2. 데이터베이스

### 마이그레이션 적용

```bash
cd apps/api
DATABASE_URL="<프로덕션 URL>" npx tsx scripts/migrate.ts up
```

### 확인

```bash
DATABASE_URL="<프로덕션 URL>" npx tsx scripts/migrate.ts status
```

적용된 마이그레이션 목록이 나옵니다. `0019_equity_snapshots` 까지 있어야 합니다.

### ★★ 되돌리기 명령은 일부러 없습니다

`migrate.ts` 에 `down` 이 없습니다. 되돌리기는 데이터를 지우므로 실수 한 번에
사용자 기록이 사라집니다. `.down.postgres.sql` 파일은 있지만 **직접 실행해야**
합니다 — 그 한 단계가 확인을 강제합니다.

적용 전에 백업을 만드십시오.

```bash
pg_dump "<프로덕션 URL>" > backup-$(date +%Y%m%d-%H%M).sql
```

---

## 3. 개발 흔적 정리

프로덕션 기동은 **개발 계정이 DB 에 있으면 거부됩니다.**

```bash
# 어떤 계정이 걸리는지 먼저 확인
psql "<프로덕션 URL>" -c "
SELECT email, role, created_at FROM users
WHERE email LIKE '%.local' OR email LIKE '%.test'
   OR email LIKE '%@example.com' OR email LIKE '%.invalid'
ORDER BY created_at;"
```

★ 판정 기준은 화이트리스트가 아니라 **패턴**입니다. `.local` `.test` `.invalid`
`example.com` 은 RFC 가 예약한 도메인이어서 메일이 배달되지 않습니다 — 실사용자일
수 없습니다.

지울 때는 **연결된 데이터부터** 지워야 합니다(외래키). 순서는 서비스 상태에 따라
다르므로, 지우기 전에 목록을 확인하고 필요한 것이 없는지 보십시오.

---

## 4. 기동

```bash
cd apps/api
set -a; . ../../.env.production; set +a
npx tsx src/index.ts
```

프로세스 관리자(systemd, pm2, 컨테이너)를 쓰는 경우 환경변수를 그쪽 설정에
넣으십시오.

### 확인 — 기동이 되었는가

```bash
# 프로세스가 살아 있는지 (의존성을 건드리지 않습니다 — 로드밸런서 헬스체크용)
curl -s http://127.0.0.1:8787/health

# 트래픽을 받아도 되는지 (DB·Redis 확인)
curl -s http://127.0.0.1:8787/health/ready
```

### 확인 — 설정이 의도한 대로 붙었는가

상세 상태는 **관리자 인증이 필요합니다.** `super` 계정으로 `/admin/system` 화면에
접속하거나, API 로 봅니다.

```
GET /api/admin/system/health
```

**반드시 확인할 6개**

| 필드 | 정상 | 잘못됐을 때 무슨 일이 |
|---|---|---|
| `postgres` | `Connected` | 연결 안 되면 아무것도 저장되지 않습니다 |
| `mail` | `Configured` | `NOT SENDING ...` 이면 **비밀번호 재설정이 불가능**합니다 |
| `brokerRebate` | `Configured — ...` | `rebate is 0` 이면 거래는 되지만 **우리 수익이 0원**입니다 |
| `brokerSettlementRead` | `Configured` | 아니면 **수익이 들어오는지 확인할 수단이 없습니다** |
| `tradingMode` / `liveOrders` | 의도한 값 | `MOCK` / `Locked` 이 기본값입니다 |
| `riskWatch` | 의도한 값 | `Off — ...` 면 화면이 열린 동안만 청산 경고가 갑니다 |

★★ `mail` 과 `brokerRebate` 는 **잘못돼도 서버가 정상 동작합니다.** 그래서 이
화면에서 확인하지 않으면, 사용자가 "비밀번호를 잊었다" 고 문의할 때까지 · 리베이트
정산일이 될 때까지 모릅니다.

★ 기동이 **거부**되면 로그에 이유가 한 줄로 나옵니다(`fail-closed startup: ...`).
그 이유가 지목하는 환경변수를 채우십시오.

---

## 5. 스모크 테스트

기동 직후 실제로 동작하는지 확인합니다.

```bash
BASE=https://<도메인> node tools/launch-check.mjs --env .env.production
```

이 점검은 서버에 실제로 요청을 보내 다음을 확인합니다.

- 보안 헤더가 붙는지 (CSP, `frame-ancestors`, `object-src`)
- 공개 라우트가 로그인 없이 열리는지
- 인증이 필요한 라우트가 실제로 막는지

### 손으로 확인할 것

1. 회원가입 → **인증 메일이 실제로 도착하는지** (도착하지 않으면 §1 의 메일 3종)
2. 로그인 → 로그아웃 → 다시 로그인
3. 비밀번호 재설정 메일
4. 차트가 그려지고 시세가 움직이는지
5. 거래소 키 등록 → 잔고가 표시되는지
6. 모의 주문 한 건

---

## 6. 법적 문서 게시

**법무 검토가 끝난 뒤에** 합니다.

1. `super` 계정으로 `/admin/legal` 접속
2. 초안을 확인하고 필요한 부분을 수정 (`{{자리표시자}}` 를 실제 값으로)
3. 게시

★★ **게시는 되돌릴 수 없습니다.** 이미 본 사람이 생기기 때문입니다. 문구를
바꾸려면 새 버전을 만들어야 하고, 그래야 "누가 어느 버전에 동의했는가" 가
남습니다.

게시 전에는 `/terms` `/privacy` `/risk` 가 "게시되지 않았습니다" 를 보여주고,
`/admin/legal` 의 준비 상태가 `canLaunch: false` 로 남습니다.

---

## 7. 실주문 열기

★★ **이 절은 다른 모든 단계가 끝난 뒤에 합니다.** 여기서부터 사용자의 실제 돈이
움직입니다.

### 먼저 확인할 것

| 확인 | 왜 |
|---|---|
| 모의 모드에서 주문 흐름을 끝까지 봤는가 | 주문 경로에 문제가 있으면 실주문에서 발견하면 늦습니다 |
| 브로커 자격증명 3종이 있는가 | 없으면 거래는 되지만 **리베이트 0원**입니다 |
| 약관·개인정보·위험고지가 게시됐는가 | 동의가 가리킬 대상이 있어야 합니다 |
| 운영자 KuCoin 키가 있는가 | **수익이 들어오는지 확인할 수단**입니다 |
| 킬스위치를 쓸 수 있는가 | 사고 시 즉시 멈출 방법 |

### 여는 방법

```
TRADING_MODE=KUCOIN_LIVE
FEATURE_LIVE_ORDERS_ENABLED=true
RISK_WATCH_ENABLED=true          ← 함께 켜십시오
```

**둘 다 바꿔야** 열립니다. 하나만 바꾸면 열리지 않습니다 — 실수로 열리는 것을
막기 위한 구조입니다.

그 뒤에도 주문 하나하나가 게이트를 통과해야 전송됩니다(자격증명 검증, 킬스위치,
심볼 승수 확인, 리스크 한도 등). 막히면 화면이 **어느 게이트에서 막혔는지**
보여줍니다.

### ★ 청산 감시를 함께 켜는 이유

끄고 실주문을 열면, 사용자가 화면을 닫은 동안 청산가에 접근해도 알림이 가지
않습니다. 선물에서 그것은 곧 손실입니다.

단, 한계가 있습니다. 감시 대상은 **우리 DB 에 포지션이 있는 사용자**입니다.
한 번도 접속하지 않은 사용자는 감시하지 못합니다. 위험 고지에 "알림 도달을
보장하지 않는다" 고 명시한 이유입니다.

### 처음 며칠 동안 볼 것

`super` 계정으로 `/admin/system` 을 확인하십시오.

```
riskWatch  →  Running (every 120s, N watched)
```

`FAILING (n in a row)` 이면 **경고가 발송되지 않고 있습니다.** 즉시 로그를
확인하십시오. 감시가 죽은 것을 모르면 사용자는 "위험하지 않아서 알림이 없다" 고
오해합니다.

---

## 8. 수익 확인

브로커 리베이트가 실제로 들어오는지 확인합니다.

1. `super` 계정으로 `/admin/fees` 접속
2. 정산 조회 — 커미션·거래자 목록·거래 내역

★ 운영자 KuCoin 키(`KUCOIN_API_KEY` 3종)가 없으면 이 화면이 조회할 수 없습니다.
**리베이트가 들어오는지 아닌지 알 방법이 없다는 뜻입니다.**

★ 브로커 정산은 스팟 도메인(`api.kucoin.com`)에서 조회합니다. 선물 도메인에는
해당 엔드포인트가 없습니다.

---

## 되돌리기

문제가 생겼을 때.

### 실주문만 멈추기 (재배포 없이)

`super` 계정으로 킬스위치를 켜면 즉시 주문 전송이 멈춥니다. 조회는 계속됩니다.

### 이전 버전으로

```bash
# 1. 실주문 먼저 닫기
FEATURE_LIVE_ORDERS_ENABLED=false

# 2. 이전 커밋으로 배포
```

★★ **스키마는 되돌리지 마십시오.** `migrate.ts` 에 `down` 명령을 넣지 않은
이유입니다. 되돌리면 그 사이에 쌓인 사용자 데이터가 사라집니다. 스키마가 문제라면
앞으로 고치는 마이그레이션을 새로 만드는 편이 안전합니다.

정말 되돌려야 한다면 `.down.postgres.sql` 을 직접 실행해야 하고, 그 전에
백업을 확인하십시오.

---

## 검증 명령 모음

배포 전에 전부 통과해야 합니다.

```bash
# 정적 검사
node tools/jsx-check.mjs                    # JSX 문법
pnpm -r exec tsc -p tsconfig.json --noEmit  # 타입
node tools/deposit-safety-check.mjs         # 입금·목업 안전
node tools/env-template-check.mjs           # 배포 템플릿

# 테스트
pnpm -r test

# 배포 준비
node tools/launch-check.mjs --env .env.production
node tools/db-persistence-check.mjs
```

---

## 정기 작업 — 분리 보관 기록의 파기

우리 개인정보처리방침(§6)은 "법령이 보관을 요구하는 정보는 그 기간 동안 분리
보관한 뒤 **파기**합니다" 라고 약속했습니다. 옮기는 것만 하고 파기를 하지 않으면
보관 기간이 지난 개인정보가 영구히 쌓입니다 — 그 자체가 방침 위반이고, 유출되면
이미 지웠어야 할 자료가 유출되는 셈입니다.

**하루 한 번 실행하도록 등록하십시오.**

```bash
# 먼저 무엇을 지울지 확인 (지우지 않습니다)
PGHOST=… PGPORT=… PGUSER=… PGPASSWORD=… PGDATABASE=… \
  node tools/purge-retained.mjs

# 실제 파기 — 되돌릴 수 없습니다
PGHOST=… PGPORT=… PGUSER=… PGPASSWORD=… PGDATABASE=… \
  node tools/purge-retained.mjs --apply
```

무엇을 지우는지

| 대상 | 보관 기간 | 근거 |
|---|---|---|
| `retained_legal_consents` | 5년 | 개인정보처리방침 1절 (약관 동의 기록) |
| `retained_orders` | 5년 | 개인정보처리방침 1절 (주문·체결 기록) |

기간은 **옮길 때 행마다 기록**되므로(`purge_after`) 이 스크립트는 기간 상수를
갖지 않습니다. 나중에 방침이 바뀌어도 이미 보관 중인 행의 기준은 흔들리지 않습니다.

★ `user_deletion_records` 는 파기하지 않습니다. 삭제 처리가 적법했음을 보이는
근거이고, 담긴 개인정보는 이메일뿐입니다. 지우면 "왜 지웠나" 에 답할 수 없습니다.

★ 회원 삭제는 SUPER 등급만 할 수 있고(`admin.user.delete`), 재인증과 대상
이메일 입력을 함께 요구합니다. 분리 보관 테이블이 없는 환경에서는 **삭제가
거부됩니다**(`RETENTION_UNAVAILABLE`) — 보관하지 못하는 상태에서 지우면 방침이
보관하겠다고 한 자료가 사라지기 때문입니다.

---

## KuCoin Fast API (OAuth) — 신청 절차

이용자가 KuCoin에서 API 키를 손으로 만들지 않게 하는 기능입니다. 켜면 "KuCoin으로
연결" 한 번으로 키가 자동 발급됩니다.

**`client_id`는 브로커 승인 통보에 들어 있지 않습니다. 별도 신청입니다.**

### 1. 준비 (도메인이 정해진 뒤에 가능)

KuCoin 폼 `https://forms.gle/bNWiNh5Ai1GUP1KE7` 에 세 가지를 제출합니다.

| 제출 항목 | 값 |
|---|---|
| Fast API 요청용 서버 IP 목록 | 우리 API 서버의 공인 IP (전부) |
| 거래용 서버 IP 목록 | 주문을 내보내는 서버의 공인 IP (전부) |
| OAuth 로그인 후 Redirect URL | `https://<도메인>/api/exchanges/kucoin/oauth/callback` |

IP는 **전부** 적어야 합니다. 로드밸런서 뒤에 여러 대가 있으면 그 전부이고,
나중에 서버를 늘리면 다시 신청해야 합니다(빠뜨린 IP에서 나간 요청은 거부됩니다).

### 2. `client_id` 수령 후

```bash
KUCOIN_OAUTH_CLIENT_ID=<KuCoin이 보낸 값>
KUCOIN_OAUTH_REDIRECT_URI=https://<도메인>/api/exchanges/kucoin/oauth/callback
```

★ `REDIRECT_URI`는 제출한 값과 **문자 하나까지 같아야** 합니다. 다르면 KuCoin이
거부하고 이용자는 승인 화면에서 되돌아오지 못합니다.

★ 둘 중 하나라도 비어 있으면 기능이 **등록되지 않습니다**(fail-closed). 서버
기동 로그에 그 이유가 남습니다:
`[api] KuCoin Fast API (OAuth) NOT mounted — …`

★ PostgreSQL이 필요합니다(마이그레이션 0024 — OAuth state 저장).

### 3. 확인

```bash
curl -s http://<서버>/api/config | grep kucoinOauthAvailable   # true 여야 합니다
curl -s -b <관리자쿠키> http://<서버>/api/admin/system/health | grep kucoinFastApi
```

그리고 **실제로 한 번 통과시켜 보십시오.** 이 흐름은 `client_id` 없이는 끝까지
검증할 수 없어, 코드는 문서를 근거로 작성했습니다. 첫 연결에서 확인할 것:

- KuCoin 승인 화면에 우리 이름이 나오는지
- 승인 후 지갑 화면으로 돌아와 초록 배너가 뜨는지
- KuCoin의 API 관리 목록에 키가 생겼고 **출금 권한이 꺼져 있는지**
- 그 키로 잔고·포지션 조회가 되는지

### 우리가 요구하는 권한

조회(`API_COMMON`) · 현물 거래(`API_SPOT`) · 선물 거래(`API_FUTURES`) **뿐입니다.**

**출금(`API_WITHDRAW_OAUTH`)은 코드에서 false로 고정**되어 있습니다. 자금을
보관하지 않고 입출금을 취급하지 않는다는 이용약관 제2조와 맞춘 것이며, 테스트로
묶어 두었습니다(`kucoin-oauth.test.ts` S2). 이 값을 true로 바꾸면 약관과 정면으로
어긋나고, 우리 서버가 침해될 때 피해가 이용자 자산 전체로 번집니다.

마진·예치·이체 권한도 요구하지 않습니다 — 제공하지 않는 기능입니다.

### 참고: OAuth 경유 입출금 수수료

KuCoin은 Fast API OAuth로 이루어진 입출금에 별도 수수료를 부과합니다(출금액의
10%, 최소 1 USDT, 최대 30 USDT). **우리는 출금을 취급하지 않으므로 해당이
없습니다.** 나중에 누가 그 기능을 붙이려 할 때 알고 있어야 하는 조건입니다.
