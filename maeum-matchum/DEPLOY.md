# 배포 가이드 (Render + AWS AI 분리 구조)

마음맞춤은 **웹앱(Render)** 과 **AI 모델 서버(AWS)** 를 분리해 운영합니다.

```
[사용자] → [Render: 마음맞춤 웹앱 + DB] → (AI 요청) → [AWS: SEED 0.5B 모델 서버]
```

> AI 서버가 없거나 응답하지 않아도 **규칙 엔진으로 자동 폴백**되어 서비스는 항상 동작합니다.
> 먼저 웹앱만 Render에 올려 공개하고, AI는 나중에 AWS에 붙여도 됩니다.

---

## 1. Render에 웹앱 배포

1. Render 대시보드 → **New → Web Service** → 이 GitHub 저장소 연결
2. 설정:
   - **Root Directory**: `maeum-matchum`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Health Check Path**: `/api/ai-status`
   - (저장소에 `render.yaml`이 있어 Blueprint로도 자동 인식됩니다)
3. 환경변수(Environment):
   | 키 | 값 | 설명 |
   |----|----|------|
   | `AI_DISABLED` | `true` | AI 서버 붙이기 전. 규칙 엔진만 사용 |
   | `AI_BASE_URL` | (AI 붙일 때) `http://<AWS주소>:8008/v1` | |
   | `AI_MODEL` | `HyperCLOVAX-SEED-Text-Instruct-0.5B` | |
   | `AI_API_KEY` | (AI 서버에 인증 걸었다면) 키 | |
4. 배포 완료 → Render가 발급한 **공개 URL** (예: `https://maeum-matchum.onrender.com`)을
   외부 직원에게 공유하면 됩니다.

> **참고(무료 플랜)**: Render 무료 웹서비스는 유휴 시 잠들었다가 첫 요청 시 깨어나며(수십 초),
> 디스크가 재배포 시 초기화됩니다. SQLite 데이터를 영구 보존하려면 유료 플랜의 Disk를
> 붙이거나(`render.yaml`의 disk 주석 해제) PostgreSQL로 전환하세요.

---

## 2. AWS에 AI 모델 서버 구동 (선택, 나중에)

AWS EC2(예: Ubuntu)에서:

```bash
# 빌드 도구 + 파이썬 서버
sudo apt update && sudo apt install -y build-essential cmake python3-venv
python3 -m venv .venv
.venv/bin/pip install "llama-cpp-python[server]"

# SEED 0.5B GGUF 다운로드
mkdir -p models
curl -L -o models/seed-0.5b-q8_0.gguf \
  "https://huggingface.co/cherryDavid/HyperCLOVAX-SEED-Text-Instruct-0.5B-Q8_0-GGUF/resolve/main/hyperclovax-seed-text-instruct-0.5b-q8_0.gguf"

# OpenAI 호환 서버 구동 (0.0.0.0 로 열어 외부 접속 허용)
.venv/bin/python -m llama_cpp.server \
  --model models/seed-0.5b-q8_0.gguf \
  --model_alias HyperCLOVAX-SEED-Text-Instruct-0.5B \
  --host 0.0.0.0 --port 8008 --n_ctx 4096 --n_threads 4
```

그다음 Render 환경변수에서 `AI_DISABLED=false`, `AI_BASE_URL=http://<AWS_공인IP>:8008/v1` 로 변경.

### ⚠️ 보안 필수
현재 AI 서버에는 인증이 없습니다. 인터넷에 그대로 열면 누구나 사용할 수 있으니:
- **보안그룹**: 8008 포트를 Render 서버 IP에서만 접근 허용
- 또는 리버스 프록시(nginx)로 **API 키 인증** 추가
- 가능하면 **HTTPS**(도메인 + TLS) 적용
- CPU 인스턴스는 응답이 느립니다. 동시 사용자가 많으면 GPU 인스턴스 권장.

---

## 3. 로컬에서 한 번에 실행 (개발용)

```bash
./start.sh          # 모델 서버 + 웹 서버 동시 실행
./start.sh status   # 상태
./start.sh stop     # 종료
```
