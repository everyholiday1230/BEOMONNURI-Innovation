# Chart-OS 배포 가이드

## Render 배포

### 필수 환경변수

| 변수 | 필수 | 설명 |
|------|------|------|
| `DATABASE_URL` | ✅ | `postgresql+asyncpg://user:pass@host:5432/db` |
| `REDIS_URL` | ✅ | `redis://host:6379/0` |
| `JWT_SECRET` | ✅ | 32자 이상 랜덤 문자열 |
| `ADMIN_KEY` | ✅ | 관리자 인증 키 |
| `ENV` | ✅ | `production` |
| `CORS_ORIGINS` | ✅ | `https://yourdomain.com` |
| `BASE_URL` | ✅ | `https://yourdomain.com` |
| `GOOGLE_CLIENT_ID` | 선택 | Google OAuth |
| `GOOGLE_CLIENT_SECRET` | 선택 | Google OAuth |
| `GOOGLE_REDIRECT_URI` | 선택 | `https://yourdomain.com/v1/auth/google/callback` |
| `SMTP_HOST` | 선택 | 이메일 발송 |
| `SMTP_PORT` | 선택 | 기본 587 |
| `SMTP_USER` | 선택 | SMTP 사용자 |
| `SMTP_PASS` | 선택 | SMTP 비밀번호 |
| `SMTP_FROM` | 선택 | 발신자 이메일 |

### 배포 전 체크리스트

- [ ] **운영 DB 마이그레이션 먼저 실행** (앱 배포 전):
  ```bash
  psql -d chart_os -f scripts/migrate_live.sql
  ```
  ⚠️ **destructive Alembic baseline 사용 금지** — drop_table 포함 baseline을 live DB에 적용하지 마세요.
- [ ] `JWT_SECRET` 32자 이상 설정 (production에서 약한 값이면 기동 거부)
- [ ] `DATABASE_URL` PostgreSQL 연결 확인
- [ ] `REDIS_URL` Redis 연결 확인
- [ ] `ADMIN_KEY` 설정
- [ ] `CORS_ORIGINS` 실제 도메인으로 설정
- [ ] `BASE_URL` 실제 도메인으로 설정
- [ ] DDL 적용: `psql -d chart_os -f src/db/ddl.sql`
- [ ] Google OAuth 사용 시: Google Cloud Console에 redirect URI 등록
- [ ] SMTP 사용 시: 발송 테스트

### 배포 후 Smoke Test

```bash
DOMAIN=https://yourdomain.com

# 1. 헬스체크
curl -s $DOMAIN/health | jq .status  # "ok"

# 2. 메인 페이지
curl -s -o /dev/null -w "%{http_code}" $DOMAIN  # 200

# 3. 캔들 API
curl -s "$DOMAIN/v1/charts/candles?symbolId=BTCUSDT&timeframe=5m&limit=3" | jq .success  # true

# 4. 비마코 (비회원 지연)
curl -s "$DOMAIN/v1/charts/ind-b?symbolId=BTCUSDT&timeframe=5m&limit=100" | jq .data._delay.data_policy  # "delayed_1h"

# 5. 공지
curl -s "$DOMAIN/v1/site/notices" | jq .success  # true

# 6. FAQ
curl -s "$DOMAIN/v1/site/faqs" | jq .success  # true

# 7. 심볼
curl -s "$DOMAIN/v1/symbols?page_size=5" | jq .success  # true

# 8. 서버 시간
curl -s "$DOMAIN/v1/charts/server-time" | jq .data.ts  # timestamp

# 9. robots.txt
curl -s $DOMAIN/robots.txt | head -1  # "User-agent: *"

# 10. sitemap.xml
curl -s $DOMAIN/sitemap.xml | head -1  # "<?xml"
```

### Rollback 절차

1. Render 대시보드 → 이전 배포로 롤백
2. 또는 git revert + push:
   ```bash
   git revert HEAD
   git push
   ```
3. DB 마이그레이션이 포함된 경우: DDL은 `IF NOT EXISTS`/`ADD COLUMN IF NOT EXISTS` 기반이므로 롤백 시 추가 컬럼만 남음 (데이터 손실 없음)

### 장애 대응

| 증상 | 확인 | 조치 |
|------|------|------|
| 502/503 | `/health` 확인 | Render 로그 확인 → 재배포 |
| DB 연결 실패 | health.db | `DATABASE_URL` 확인 |
| Redis 연결 실패 | health.redis | `REDIS_URL` 확인 |
| JWT 오류 | 로그인 실패 | `JWT_SECRET` 확인 |
| 비마코 500 | ind-b 호출 | DDL 적용 확인 |
| Google 로그인 503 | `/v1/auth/google/login` | `GOOGLE_CLIENT_ID` 확인 |
| 이메일 미발송 | 인증 메일 | `SMTP_*` 확인 |
