# Destructive DDL Checklist

Chart-OS 는 관리형 PostgreSQL (Render) 을 사용하며, 운영 중인 데이터를 다루기 때문에 파괴적 DDL 은 별도 승인 절차를 따른다. 본 문서는 Alembic 마이그레이션 / 수동 SQL 중 **파괴적 변경** 이 포함된 PR 을 머지하기 전 반드시 만족해야 할 체크리스트다.

## 파괴적 변경 정의

다음 중 하나라도 해당하면 본 체크리스트 대상이다.

1. **컬럼 / 테이블 삭제** (`DROP COLUMN`, `DROP TABLE`)
2. **컬럼 이름 변경** (`RENAME COLUMN`) — 운영 중 앱에서 옛 이름을 참조할 수 있음
3. **컬럼 타입 변경** (`ALTER COLUMN ... TYPE`) — 특히 lossy 변환 (예: `TEXT -> VARCHAR(n)`)
4. **NOT NULL 추가** (`ALTER COLUMN ... SET NOT NULL`) — 기존 NULL row 에 대한 처리 필요
5. **UNIQUE / PRIMARY KEY 추가** — 기존 중복 row 에 대한 처리 필요
6. **대용량 테이블 ALTER** — 쓰기 잠금 발생, 수 분 이상 소요 가능
7. **FK 제약 추가** (`ADD CONSTRAINT ... FOREIGN KEY`) — 기존 orphan row 확인 필요
8. **대규모 backfill** (`UPDATE ... WHERE ...` 가 수 천 row 이상 영향)
9. **Enum 값 제거** (`ALTER TYPE ... DROP VALUE`) — 기존 row 를 사용 중인 경우 실패
10. **파티션 삭제** / **뷰 삭제** / **인덱스 삭제**
11. **데이터베이스 / 스키마 / 역할 삭제**

## 체크리스트 (PR 머지 전 전항목 만족 필수)

### 1. 영향 분석

- [ ] 변경 대상 테이블/컬럼의 **현재 row 수** 를 PR 설명에 기록 (`SELECT count(*)` 또는 통계 쿼리 결과).
- [ ] 해당 컬럼/테이블을 **참조하는 코드 위치** 를 전부 나열 (`grep -rn "<column>" src/` 결과).
- [ ] 변경이 영향을 주는 **API 엔드포인트 리스트** 나열.
- [ ] **프론트엔드 (static/js) 참조 여부** 확인 — JS 에서 JSON 키 이름으로 참조 중이면 함께 변경.
- [ ] 변경이 **online 운영 중 실행** 가능한지 판정 (예: NOT NULL 추가는 default 없는 상태에서 불가).

### 2. 롤백 준비

- [ ] **DB 백업 수행** 후 백업 경로를 PR 설명에 기록.
  - Render: Dashboard 에서 Postgres 수동 backup 또는 최신 자동 backup 시각 확인
  - 또는 `pg_dump` 로 덤프 생성 후 S3 (SSE 암호화) 업로드 경로/시각 기록
- [ ] **Alembic downgrade 경로** 가 실제로 작동하는지 확인 (`alembic downgrade -1`). 불가능하면 **수동 복구 SQL 스크립트** 를 PR 에 첨부.
- [ ] 롤백 시 **데이터 손실 범위** 를 명시 (예: "downgrade 시 column X 데이터 영구 손실").

### 3. 단계적 적용 (권장)

대용량 변경이나 고위험 변경은 다음 단계별 PR 로 분리한다.

- **Step 1 - 추가**: 새 컬럼/테이블/인덱스 추가 (기존은 유지)
- **Step 2 - 이중 쓰기**: 앱 코드가 기존 + 새 쪽 둘 다 기록하도록 배포
- **Step 3 - 백필**: 과거 데이터를 새 쪽으로 이관 (`UPDATE ... WHERE NOT EXISTS ...`)
- **Step 4 - 읽기 전환**: 앱이 새 쪽을 읽도록 배포
- **Step 5 - 제거**: 기존 컬럼/테이블 삭제

각 단계는 별도 PR 로 올리고 Step 간 **최소 24시간** 운영 관찰 후 다음 단계로 진행한다.

### 4. 실행 환경

- [ ] Render Shell 에는 `psql` 이 없으므로 DDL 적용 방식 명시:
  - Alembic: `alembic upgrade head` (Pre-Deploy 훅에서 자동 실행됨)
  - 수동 SQL: Python + asyncpg runner 스크립트 (`DATABASE_URL` 정규화 필요)
- [ ] EC2 와 Render 양쪽 DB 모두 적용 필요 시 순서 명시 (보통 Render 먼저, EC2 나중).

### 5. 검증

- [ ] 적용 직전/직후 **행 수 비교** 결과 PR 코멘트에 첨부.
- [ ] `/health` 엔드포인트 `db:ok` 유지 확인.
- [ ] 관련 API 엔드포인트 200 응답 확인 (실제 curl 로그 첨부).
- [ ] 프론트엔드 기능 수동 확인 (예: 워치리스트 로딩, 차트 로딩).

### 6. 승인

- [ ] PR 본문에 **"파괴적 DDL 포함"** 명시.
- [ ] 사용자 (저장소 소유자) 의 **명시적 승인 코멘트** 후 머지.
- [ ] 자동 머지 금지 (autoMerge 라벨 등 사용 안 함).

## 예시 - 통과 케이스

PR #18 `fix(ticker): symbols.sort_order 컬럼 추가` 는 파괴적 변경이 아니지만, 다음과 같이 안전하게 처리됨.

- 컬럼 **추가** 이므로 NOT NULL 제약 없음 (기본값 0)
- 기존 row 에 영향 없음
- 앱이 NULL 인 값을 `nullslast()` 로 안전하게 정렬 (`054d86a`)
- DB 와 앱 배포를 순차 진행 -> 중단 없음

## 예시 - 거부 케이스 (가정)

`ALTER TABLE symbols DROP COLUMN metadata;` 를 담은 PR 이 다음 누락으로 거부됨.

- 프론트엔드 `app.js` `coinImgUrl[s.symbol_code] = s.img_url` 에서 `metadata->>'img_url'` 를 참조 중 -> **함께 수정 안 됨**
- 롤백 시 DB 에 저장된 img_url 정보 영구 손실
- 백업 경로 미기록

## 참고

- `.kiro/steering/chart-os-operations.md` 원칙 4번 (파괴적 DDL 별도 승인)
- `.kiro/steering/secret-handling.md` (덤프에 시크릿 포함 시 주의)
- `.kiro/specs/domain-render-deployment/progress-log.md` (실제 적용 사례 누적)
