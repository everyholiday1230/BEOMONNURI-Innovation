# 백업·복구 — 검증된 절차

**최초 검증: 2026-09-08** (실제 운영 DB 로 4단계 전부 수행, 아래 결과 기록)

---

## 0. 왜 이 문서가 있는가

릴리스 게이트가 `backup-restore-pitr` 를 **NOT_EXECUTED** 로 표시하고 있었다. 고객
거래기록과 **거래소 API 키**가 든 DB 인데 "되돌릴 수 있다" 는 근거가 없었다.

"백업이 있다" 와 "백업으로 되살릴 수 있다" 는 다른 말이다. 그래서 네 단계를 모두
확인해야 한다 — 특히 **4번**이 없으면 검증이 아니다.

| 단계 | 확인 내용 | 없으면 |
|---|---|---|
| 1 | 덤프가 만들어진다 | 백업 자체가 없다 |
| 2 | 그 덤프가 복구된다 | 파일만 있고 못 쓴다 |
| 3 | 데이터가 같다 | 일부만 복구된다 |
| **4** | **자격증명이 복호화된다** | 고객이 API 키를 전부 재발급해야 한다 |

---

## 1. 지금 상태 (2026-09-08 실측)

| 항목 | 값 | 비고 |
|---|---|---|
| Render Postgres | `chartcontrol-db` · `basic_256mb` · PostgreSQL **18** · singapore | |
| 시점 복구(PITR) | `AVAILABLE`, **2026-09-04** 부터 | Render API `/postgres/{id}/recovery` |
| 스냅샷 백업 | **0건** | 이 플랜은 스냅샷을 만들지 않는다 |
| 고가용성 | **꺼짐** | 인스턴스 장애 시 자동 승계 없음 |
| 읽기 복제본 | 0개 | |
| DB 크기 | 17 MB · 표 109개 | 덤프는 0.5 MB (압축) |

★ **PITR 은 Render 안에만 있다.** Render 계정·리전 사고에서는 함께 사라진다.
그래서 논리 덤프를 **운영 밖**에 따로 두는 것이 필요하다.

---

## 2. 실행 방법

운영이 PostgreSQL 18 이므로 **클라이언트도 18** 이어야 한다. 16 으로 시도하면
`aborting because of server version mismatch` 로 멈춘다.

```bash
# 준비 (한 번만)
curl -fsS https://www.postgresql.org/media/keys/ACCC4CF8.asc \
  | sudo tee /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc >/dev/null
. /etc/os-release
echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] \
https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" \
  | sudo tee /etc/apt/sources.list.d/pgdg.list >/dev/null
sudo apt-get update && sudo apt-get install -y postgresql-18   # 서버도 필요(복구 검증용)

# 전체 검증 (덤프 + 복구 + 대조 + 복호화)
DATABASE_URL='postgres://…?sslmode=require' \
CREDENTIAL_KEK='…' \
  bash tools/backup-verify.sh

# 일상 백업만
DATABASE_URL='…' bash tools/backup-verify.sh --dump-only
```

`CREDENTIAL_KEK` 을 빼면 4단계를 건너뛰지 않고 **실패로 끝난다.** 의도한 것이다 —
행 수만 맞는 백업을 "검증했다" 고 기록하면 안 된다.

---

## 3. 2026-09-08 검증 결과

```
=== 1) 덤프
  /tmp/cc-backup/prod-20260908T144214Z.dump  (528 KB)     ← 13초
=== 2) 임시 PostgreSQL 로 복구
  복구 오류: 0
=== 3) 데이터 대조
  운영  : users=38 consents=3 trades=26 creds=3 docs=60 tables=109
  복구본: users=38 consents=3 trades=26 creds=3 docs=60 tables=109
  일치 ✓
=== 4) 자격증명 복호화 (가장 중요)
  복구본 자격증명 3건
    kucoin → 키 앞4=6a93… 길이=24 ✓
    kucoin → 키 앞4=6a8f… 길이=24 ✓
    kucoin → 키 앞4=6a90… 길이=24 ✓
  전부 복호화 성공 (3/3) — 이 백업으로 서비스를 되살릴 수 있다.
```

★ `audit_logs` 는 대조에서 제외했다. 덤프 직후에도 계속 늘어나므로 1~2건 차이는
정상이고, 그것 때문에 "불일치" 로 보고하면 경고가 무의미해진다.

★ 복호화된 키 값을 **출력하지 않는다.** 앞 4자와 길이만 남긴다 — 검증 로그가 그
자체로 유출 경로가 되면 안 된다.

---

## 4. 실제 사고가 났을 때

### (A) 데이터가 잘못됐다 / 실수로 지웠다 — 시점 복구

Render 대시보드 → `chartcontrol-db` → **Recovery** → 시점 선택.
**새 인스턴스**가 만들어진다(기존 것을 덮어쓰지 않는다). 확인 후 `DATABASE_URL` 을
새 인스턴스로 바꾸고 재배포한다.

- 복구 가능 시작 시점: **2026-09-04** (그 이전으로는 못 돌아간다)
- 새 인스턴스는 **과금된다** — 확인 후 옛 것을 정리할 것

### (B) Render 계정·리전 전체 사고 — 논리 덤프

`tools/backup-verify.sh` 가 만든 덤프로 아무 PostgreSQL 18 에 복구한다.

```bash
pg_restore -d '<새 DB>' --no-owner --no-privileges prod-*.dump
```

★ 이때 **`CREDENTIAL_KEK` 이 필요하다.** 덤프에는 암호화된 키만 있고 KEK 은 없다.
KEK 을 잃으면 고객 자격증명 3건을 되살릴 수 없고, 고객이 거래소에서 API 키를
전부 재발급해야 한다. **KEK 은 DB 백업과 별도로, 다른 장소에 보관할 것.**

---

## 5. 남은 과제

| 항목 | 상태 | 필요한 결정 |
|---|---|---|
| 덤프 자동화·외부 보관 | **없음** — 수동 실행 | 어디에 둘지(S3·Backblaze 등)와 비용 |
| PITR 복구 실전 시험 | **미실행** | 새 인스턴스 과금 승인 |
| 고가용성 | 꺼짐 | 상위 플랜 비용 |
| KEK 별도 보관 | 확인 안 됨 | 지금 어디에 있는지 (Render 환경변수뿐이면 위험) |

★ 마지막 항목이 가장 중요하다. **KEK 이 Render 환경변수에만 있으면, Render 사고에서
DB 와 KEK 을 동시에 잃는다.** 그러면 논리 덤프가 있어도 자격증명은 못 살린다.
