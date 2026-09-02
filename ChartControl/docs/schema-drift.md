# 스키마 드리프트 — Postgres(운영) vs SQLite(개발)

운영은 **Postgres 전용**이다(없으면 기동을 거부한다). 개발 기본값은 **SQLite** 이고, 두 마이그레이션 계보가 따로 자라 왔다.

현재 상태 — `node scripts/schema-drift.mjs` 로 언제든 다시 확인할 수 있다:

```
Postgres 표 107개 · SQLite 표 74개
운영에만 있는 표 33개
```

파일 번호(Postgres 0041 / SQLite 0015)로는 격차를 알 수 없다. SQLite 쪽은 phase 단위로 여러 표를 한 파일에 만들기 때문이다. 그래서 **표 이름**으로 비교한다.

## 이게 왜 문제인가

드리프트 자체는 결함이 아니다. 개발에서 일부 기능을 포기하는 것은 합리적인 선택일 수 있다.

**결함은 아무도 모르는 드리프트다.** 앱은 없는 표를 읽으려 하고 기능이 조용히 꺼진 채 돌아간다. 실제로 이 프로젝트에서 겪은 일:

- 로컬 관리자 라우터가 `relation "mock_gateway_state" does not exist` 로 **전부 비활성화**됐고, 원인을 찾는 데 시간을 썼다. 관리자 화면 검증을 하려면 로컬 Postgres 를 따로 띄워야 했다.
- 저장 기능(`saved_items`)이 SQLite 에서 `supported: false` 로 응답해, 화면 검증이 "저장이 안 된다" 로 보였다. 원인은 코드가 아니라 개발 DB 였다.
- AI 코파일럿·지표 프리셋 검증도 같은 이유로 로컬에서 끝까지 확인할 수 없었다.

## 결정

**SQLite 를 Postgres 와 맞추지 않는다.** 33개 표를 옮기는 비용이 크고, 일부는 Postgres 전용 기능(`JSONB`, `EXTRACT`, `xmax`, 부분 인덱스)에 의존한다. SQLite 는 **인증·주문 초안·차트까지만 되는 축소 개발 환경**으로 규정한다.

대신 두 가지를 지킨다.

1. **없는 표를 쓰는 기능은 `supported: false` 로 정직하게 답한다.** 빈 목록을 돌려주면 "데이터가 없다" 로 읽혀 개발자가 코드를 의심한다. 이건 이미 여러 라우트에 적용돼 있다(`saved-routes`, `notices`, `referral` 등).
2. **새 드리프트가 생기면 알린다.** `scripts/schema-drift.mjs` 가 이 문서에 적히지 않은 운영 표를 발견하면 **실패(exit 1)** 한다. 새 Postgres 마이그레이션을 추가하면서 판단을 미루는 것을 막는다.

## 운영 전용 표 33개와 개발에서 꺼지는 기능

| 표 | 개발에서 꺼지는 것 |
|---|---|
| `saved_items` | 지표 프리셋·AI 신호 저장/불러오기 |
| `point_settings` `point_ledger` `point_catalog` `point_orders` `point_redemptions` | 포인트 제도 전체(적립·차감·상품·결제) |
| `referral_settings` `referral_codes` `referral_signups` `referral_payouts` | 추천 제도 전체 |
| `notices` `notice_reads` | 공지 발행·읽음 표시 |
| `support_tickets` `support_messages` | 고객 문의 |
| `bug_reports` | 오류 제보 |
| `legal_documents` `user_legal_consents` `retained_legal_consents` | 약관 게시·동의 기록·보관 |
| `trade_decisions` `trade_outcomes` | 판단 기록·결과 귀속(학습 데이터) |
| `learning_subjects` `learning_exports` | 학습 데이터 집계·반출 |
| `equity_snapshots` | 자산 추이 |
| `price_alerts` | 가격 알림 |
| `chart_templates` | 차트 서식 저장 |
| `tier_definitions` `tier_benefit_settings` `user_tier_state` | 등급 제도 |
| `admin_user_notes` | 관리자 회원 노트 |
| `kucoin_oauth_states` | KuCoin Fast API(OAuth) 연결 — 라우트가 아예 등록되지 않는다 |
| `ops_errors` | 오류 관측(기록·알림·운영자 화면) |
| `user_deletion_records` `retained_orders` | 회원 삭제 시 법정 보관 분리 |

## 개발에서 전체 기능을 봐야 할 때

로컬 Postgres 를 띄우고 **두 값을 함께** 준다. `DATABASE_URL` 만으로는 전환되지 않는다(테스트가 개발 DB 를 오염시키는 것을 막는 의도적 설계).

```bash
initdb -D /tmp/pg -U postgres --auth=trust
pg_ctl -D /tmp/pg -o "-p 5433 -k /tmp" start
psql -h /tmp -p 5433 -U postgres -c 'CREATE DATABASE cc;'

# ★ 마이그레이션은 부팅 시 자동 실행되지 않는다. 먼저 적용한다.
#   서버를 먼저 띄우면 관리자 라우터가 표 부재로 비활성화된다.
node -e "import('./apps/api/src/db/pg.ts').then(async m => {
  const p = m.createPool('postgresql://postgres@127.0.0.1:5433/cc');
  console.log((await m.migrateUp(p)).length, 'applied'); await p.end();
})"

DATABASE_URL=postgresql://postgres@127.0.0.1:5433/cc USE_POSTGRES=true \
DATA_MODE=MOCK_REPLAY TRADING_MODE=MOCK API_PORT=8787 AUTH_COOKIE_INSECURE=true \
pnpm --filter @quantumtrade/api dev
```

## 새 Postgres 마이그레이션을 추가할 때

1. `infrastructure/postgres/00NN_*.postgres.sql` 과 `.down.postgres.sql` 을 만든다
2. `node scripts/schema-drift.mjs` 를 돌린다
3. 새 표가 나오면 **이 문서의 표에 한 줄 추가**한다 — 개발에서 무엇이 꺼지는지 적는다
4. 개발에서도 필요하면 SQLite 마이그레이션을 함께 추가한다

3번을 건너뛰면 스크립트가 실패한다. 그게 목적이다.
