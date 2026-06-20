# Chart-OS 장애 대응 매뉴얼

> 최종 업데이트: 2026-04-26
> 서버: EC2 (Ubuntu), 포트 8000, systemd: chart-os.service

---

## 공통 확인 명령어

```bash
# 서버 상태
curl -s http://localhost:8000/health | python3 -m json.tool

# 프로세스 확인
ps aux | grep uvicorn

# 실시간 로그
tail -f /tmp/chartos.log

# 로테이션 로그
tail -f /home/test1/chart-os/logs/chartos.log

# 운영 메트릭
curl -s http://localhost:8000/v1/ops/metrics -H "x-admin-key: $ADMIN_KEY" | python3 -m json.tool

# 실시간 데이터 수신 상태
curl -s http://localhost:8000/v1/debug/ingest | python3 -m json.tool
```

---

## 1. 서버 전체 장애

**증상**: /health 응답 없음, 브라우저 접속 불가

**사용자에게 보이는 현상**: 페이지 로드 안 됨, "사이트에 연결할 수 없음"

**확인할 로그**:
```bash
sudo systemctl status chart-os
tail -50 /tmp/chartos.log
journalctl -u chart-os --since "10 minutes ago"
```

**즉시 대응**:
```bash
# 프로세스 확인
lsof -i:8000

# 재시작
sudo systemctl restart chart-os

# systemd 안 되면 수동
cd /home/test1/chart-os
nohup /usr/bin/python3 -m uvicorn src.main:app --host 0.0.0.0 --port 8000 > /tmp/chartos.log 2>&1 &
```

**임시 우회**: 점검모드 활성화 (DB 접근 가능 시)
```sql
UPDATE site_settings SET value='true' WHERE key='maintenance_mode';
```

**근본 해결**: 로그에서 크래시 원인 파악 (OOM, 코드 에러, 디스크 풀 등)

**재발 방지**:
- systemd Restart=always 설정 (적용됨)
- 디스크 모니터링 (df -h)
- UptimeRobot 등 외부 모니터링 등록

---

## 2. AI API 장애

**증상**: AI 분석 결과가 "자동 분석" 폴백으로 표시, /v1/ops/metrics에서 ai.failure_rate 높음

**사용자에게 보이는 현상**: AI 분석 탭에 "[자동 분석]" 접두사, LLM 해설 없음

**확인할 로그**:
```bash
grep "llm\|ollama\|ai_predict" /home/test1/chart-os/logs/chartos.log | tail -20
curl -s http://localhost:11434/api/tags  # Ollama 상태
```

**즉시 대응**:
```bash
# Ollama 상태 확인
systemctl status ollama

# Ollama 재시작
sudo systemctl restart ollama

# 모델 확인
curl -s http://localhost:11434/api/tags | python3 -m json.tool
```

**임시 우회**: 폴백 로직이 자동 작동 (지표 기반 자동 해설). 사용자 영향 최소.

**근본 해결**: Ollama 서버 안정화, 모델 재로드

**재발 방지**:
- Ollama systemd 서비스 등록
- AI 실패율 30% 초과 시 알림 (metrics.check_alerts에 구현됨)
- LLM 응답 토큰 제한 (num_predict: 300, 적용됨)

---

## 3. 차트 데이터 API 장애

**증상**: /v1/debug/ingest에서 active_symbols_60s < 40, 차트 로딩 실패

**사용자에게 보이는 현상**: 차트 빈 화면, "데이터 로드 실패" 메시지, 가격 업데이트 안 됨

**확인할 로그**:
```bash
grep "ingest\|binance\|fetch_candles" /home/test1/chart-os/logs/chartos.log | tail -20
# 바이낸스 API 직접 확인
curl -s "https://fapi.binance.com/fapi/v1/ticker/price?symbol=BTCUSDT"
```

**즉시 대응**:
```bash
# 서버 재시작 (ingest 재초기화)
sudo systemctl restart chart-os
```

**임시 우회**: 바이낸스 API 장애 시 사용자에게 공지. 캐시된 데이터는 TTL 동안 유지.

**근본 해결**: 바이낸스 API 상태 확인 (https://www.binance.com/en/support), 네트워크 문제 시 EC2 보안 그룹 확인

**재발 방지**:
- REST 폴링 + WS 병행 (구현됨)
- 배치 병렬 요청 (5개씩, 구현됨)
- 캔들 캐시 TTL (구현됨)

---

## 4. DB 장애

**증상**: /health에서 db="error", 심볼 검색 안 됨, 로그인 안 됨

**사용자에게 보이는 현상**: 심볼 목록 빈 화면, 로그인 실패, 알림 설정 안 됨

**확인할 로그**:
```bash
grep "db\|postgres\|sqlalchemy" /home/test1/chart-os/logs/chartos.log | tail -20
sudo systemctl status postgresql
pg_isready -h localhost -U chart
```

**즉시 대응**:
```bash
# PostgreSQL 재시작
sudo systemctl restart postgresql

# 연결 확인
PGPASSWORD=chart psql -U chart -d chart_os -h localhost -c "SELECT 1"
```

**임시 우회**: 차트 데이터는 바이낸스에서 직접 가져오므로 DB 없이도 차트 표시 가능. 심볼 캐시(symbol_resolver)는 메모리에 유지.

**근본 해결**: PostgreSQL 로그 확인 (`/var/log/postgresql/`), 디스크 공간, 커넥션 수 확인

**재발 방지**:
- DB 백업 크론잡 (매일 03:00, 적용됨)
- pool_size=5, max_overflow=10 (적용됨)
- /health에서 DB 상태 체크 (적용됨)

---

## 5. 로그인 장애

**증상**: POST /v1/auth/login 401/500, JWT 토큰 발급 실패

**사용자에게 보이는 현상**: "이메일 또는 비밀번호가 틀렸습니다", 로그인 후 바로 로그아웃

**확인할 로그**:
```bash
grep "auth\|login\|jwt\|token" /home/test1/chart-os/logs/chartos.log | tail -20
```

**즉시 대응**:
```bash
# JWT_SECRET 확인 (길이만)
grep JWT_SECRET /home/test1/chart-os/.env | awk -F= '{print length($2)}'

# DB 연결 확인
PGPASSWORD=chart psql -U chart -d chart_os -h localhost -c "SELECT count(*) FROM users"
```

**임시 우회**: 차트 서비스는 로그인 없이도 사용 가능 (프리미엄 기능만 제한)

**근본 해결**: JWT_SECRET 변경 시 모든 기존 토큰 무효화됨 — 의도적 변경인지 확인

**재발 방지**:
- JWT_SECRET 32자 이상 강제 (적용됨)
- 로그인 시도 횟수 제한 (적용됨)
- bcrypt 해싱 (적용됨)

---

## 6. 결제 장애

**증상**: 해당 없음

**현재 상태**: Chart-OS는 결제 기능이 없습니다. 프리미엄 등급은 관리자가 수동으로 설정합니다.

**향후 결제 도입 시 필요 사항**:
- PG사 연동 (토스페이먼츠 등)
- 결제 실패 시 등급 유지 로직
- 환불 처리 프로세스
- 결제 로그 별도 저장

---

## 7. 배포 실패

**증상**: 새 코드 배포 후 서버 시작 안 됨, import 에러

**사용자에게 보이는 현상**: 서비스 접속 불가 또는 500 에러

**확인할 로그**:
```bash
journalctl -u chart-os --since "5 minutes ago"
cd /home/test1/chart-os && /usr/bin/python3 -c "from src.main import app; print('OK')"
```

**즉시 대응**:
```bash
# 이전 버전으로 롤백
cd /home/test1/chart-os
git log --oneline -5
git checkout <이전커밋>
sudo systemctl restart chart-os
```

**임시 우회**: 롤백 후 안정화

**근본 해결**: 배포 전 문법 검증 + E2E 테스트 실행
```bash
python3 -c "import ast; ast.parse(open('src/main.py').read()); print('OK')"
python3 -m pytest tests/test_e2e.py -v
```

**재발 방지**:
- 배포 전 E2E 테스트 필수 (13개 시나리오, 구현됨)
- pyproject.toml 핀 버전 (적용됨)
- git 태그로 버전 관리

---

## 8. 환경변수 누락

**증상**: 서버 시작 시 ValidationError, "JWT_SECRET" 관련 에러

**사용자에게 보이는 현상**: 서비스 접속 불가

**확인할 로그**:
```bash
journalctl -u chart-os --since "5 minutes ago" | grep -i "error\|missing\|validation"
```

**즉시 대응**:
```bash
# .env 파일 확인
cat /home/test1/chart-os/.env

# .env.example과 비교
diff <(grep -oP '^\w+' .env.example | sort) <(grep -oP '^\w+' .env | sort)
```

**임시 우회**: .env.example에서 복사 후 값 설정

**근본 해결**: 누락된 환경변수 설정 후 재시작

**재발 방지**:
- pydantic Settings로 필수값 검증 (적용됨)
- prod에서 약한 JWT_SECRET 시 기동 차단 (적용됨)
- .env.example 최신 유지

---

## 9. API 비용 폭증

**증상**: /v1/ops/metrics에서 ai.calls 급증, Ollama 서버 과부하

**사용자에게 보이는 현상**: AI 분석 느려짐, 타임아웃

**확인할 로그**:
```bash
curl -s http://localhost:8000/v1/ops/metrics -H "x-admin-key: $ADMIN_KEY" | python3 -c "
import json,sys; d=json.load(sys.stdin); print(f'AI 호출: {d[\"ai\"][\"calls\"]}건, 평균 {d[\"ai\"][\"avg_ms\"]}ms')"
```

**즉시 대응**:
```bash
# 특정 사용자 차단 (rate limit 강화)
# 또는 AI 엔드포인트 임시 비활성화
```

**임시 우회**: LLM 토큰 제한 (num_predict: 300, 적용됨), 폴백 로직으로 Ollama 호출 최소화

**근본 해결**: per-user rate limit 조정 (현재: 60초 10건, 일 200건)

**재발 방지**:
- per-user AI rate limit (적용됨)
- LLM 응답 토큰 제한 (적용됨)
- 전역 rate limit 120/분 (적용됨)
- /v1/ops/metrics에서 AI 호출 모니터링

---

## 10. 악성 사용자의 과도한 요청

**증상**: 특정 IP에서 대량 요청, rate limit 429 응답 급증

**사용자에게 보이는 현상**: 정상 사용자도 느려짐

**확인할 로그**:
```bash
# 접속 로그에서 IP별 요청 수
grep "$(date +%Y-%m-%d)" /home/test1/chart-os/logs/chartos.log | grep -oP '\d+\.\d+\.\d+\.\d+' | sort | uniq -c | sort -rn | head -10

# 운영 메트릭
curl -s http://localhost:8000/v1/ops/metrics -H "x-admin-key: $ADMIN_KEY" | python3 -c "
import json,sys; d=json.load(sys.stdin); print('에러율:', d['error_rate'])"
```

**즉시 대응**:
```bash
# 특정 IP 차단 (nginx 사용 시)
sudo iptables -A INPUT -s <악성IP> -j DROP

# 또는 EC2 보안 그룹에서 차단
```

**임시 우회**: rate limit이 자동 방어 (120/분, 적용됨). WS 연결도 IP당 20개 제한 (적용됨).

**근본 해결**: nginx에서 IP 기반 rate limit + fail2ban 설정

**재발 방지**:
- slowapi 전역 rate limit (적용됨)
- WS MAX_PER_IP=20 (적용됨)
- AI chat per-user 일 200건 (적용됨)
- CloudFlare 등 CDN/WAF 도입 (권장)

---

## 긴급 연락처

| 역할 | 담당 | 연락처 |
|------|------|--------|
| 서버 관리 | - | - |
| DB 관리 | - | - |
| 코드 배포 | - | - |

> 이 문서는 `/home/test1/chart-os/docs/INCIDENT_RESPONSE.md`에 저장됩니다.
