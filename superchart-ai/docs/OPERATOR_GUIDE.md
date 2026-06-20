# 운영자 가이드 — 출시 전 필수 작업

이 문서는 코드 작업이 아닌 **운영자가 직접 해야 하는 5가지 작업**입니다.

## 1. ✅ HTTPS 인증서 + 도메인

```bash
# Let's Encrypt + nginx (예시)
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com

# nginx 설정에 reverse proxy 추가:
#   server { listen 443 ssl; server_name your-domain.com;
#     ssl_certificate /etc/letsencrypt/live/...
#     location / { proxy_pass http://127.0.0.1:8000; ... }
#   }
```

## 2. ✅ `.env` 운영 설정

```bash
nano /home/test1/chart-os/.env

# 다음 값 확인/추가:
ENV=production
CORS_ORIGINS=https://your-domain.com
PUBLIC_BASE_URL=https://your-domain.com
JWT_SECRET=$(python3 -c "import secrets;print(secrets.token_urlsafe(64))")
ADMIN_KEY=$(python3 -c "import secrets;print(secrets.token_urlsafe(32))")
ADMIN_PASSWORD_HASH=$(python3 -c "import bcrypt;print(bcrypt.hashpw(b'YOUR_STRONG_PASSWORD', bcrypt.gensalt()).decode())")

# Sentry (강력 권장)
SENTRY_DSN=https://xxx@sentry.io/yyy

# 서버 재시작
sudo systemctl restart chart-os
```

### Sentry 설정 절차
1. https://sentry.io 가입 (무료 5K 이벤트/월)
2. New Project → **Python (FastAPI)** 선택
3. DSN 복사 (`https://abc123@sentry.io/12345`)
4. `.env`의 `SENTRY_DSN=` 옆에 붙여넣기
5. 서버 재시작 → 자동 감지

## 3. ✅ cron 자동 등록

```bash
cd /home/test1/chart-os
bash scripts/setup_cron.sh install
# → 3/3 등록 완료
```

## 4. ✅ 사업자 정보 입력

`static/index.html`, `static/terms.html`, `static/privacy.html`에서 다음 텍스트 검색 후 실제 값으로 교체:

- `대표: —` → `대표: 홍길동`
- `사업자등록번호: 준비 중` → `사업자등록번호: 123-45-67890`
- `통신판매업: 준비 중` → 실제 번호

`scripts/db/`에서 DB FAQ에도 동일 정보 반영 필요.

## 5. ⚠️ 모바일 실기기 테스트

- iOS Safari (iPhone)
- Chrome Mobile (Android)
- 차트 터치 줌/팬 / 메뉴 / 다크모드 전환 / 종목 변경 / TF 변경

문제 발견 시 issue 등록 + 코드 수정 요청.

---

## 출시 후 모니터링 명령어

```bash
# 종합 상태
curl https://your-domain.com/health

# 봇 상태
bash scripts/manage_bots.sh status

# 회귀 테스트
BASE=https://your-domain.com bash scripts/release_check.sh

# 메트릭 (admin 인증 필요)
curl -H "X-Admin-Key: $ADMIN_KEY" https://your-domain.com/v1/ops/metrics
```

## 장애 대응

```bash
# 서버 재시작
sudo systemctl restart chart-os

# 봇 일괄 재시작
bash scripts/manage_bots.sh restart

# 백업 즉시 실행
bash scripts/db/backup_db.sh

# 가장 최근 백업으로 복구
gunzip -c backups/chart_os_YYYYMMDD_HHMMSS.sql.gz | psql -U chart -d chart_os
```
