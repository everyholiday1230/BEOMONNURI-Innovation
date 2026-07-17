# 💗 마음맞춤 (MaeumMatchum)

> 연애의 모든 것 — AI가 연애와 결혼의 의사결정을 도와주는 Agent
> **AI 판단 → 근거 제시 → 추천 → 보완 제시 → 실행 지원**

성향·가치관·생활패턴·소비습관·미래계획·가족관·직업 안정성·대화 스타일·애착유형·갈등해결방식
**10대 핵심 영역**을 진단해, 두 사람의 궁합을 분석하고 의사결정을 돕는 반응형 웹 서비스입니다.

AI 모델은 **HyperCLOVA X SEED 0.5B**(경량·상업적 사용 가능·한국어 특화)를 사용합니다.

---

## 빠른 시작

### 방법 A. 실제 AI 모델과 함께 한 번에 실행 (권장)

SEED 0.5B 모델 서버 + 웹 서버를 한 번에 띄웁니다.

```bash
cd maeum-matchum
./start.sh            # 두 서버 실행 → http://localhost:3100
./start.sh status     # 실행 상태 확인
./start.sh stop       # 두 서버 종료
```

> 최초 1회만 준비가 필요합니다(아래 "AI 모델 연결" 참고: venv 생성 + 모델 다운로드).
> 포트는 환경변수로 조정 가능: `WEB_PORT=3000 MODEL_PORT=8010 ./start.sh`

### 방법 B. 웹만 실행 (규칙 엔진 폴백)

```bash
cd maeum-matchum
npm install          # 의존성 설치 (완료되어 있으면 생략)
npm start            # 서버 실행
```

브라우저에서 **http://localhost:3000** 접속 → 바로 진단 시작.

> AI 서버가 없어도 동작합니다. 이 경우 **결정론적 규칙 엔진**이 리포트와 상담을 제공하며,
> 상단 배지에 `규칙 엔진`으로 표시됩니다.

---

## AI 모델 연결 (SEED 0.5B)

이 프로젝트는 **HyperCLOVA X SEED 0.5B**를 OpenAI 호환 서버로 띄워 연결합니다.
GPU가 없어도 **양자화 GGUF + llama.cpp(CPU)** 로 구동할 수 있습니다(현재 이 방식으로 검증됨).

### 최초 1회 준비

```bash
cd maeum-matchum

# 1) 파이썬 가상환경 + llama.cpp 서버 설치
#    (컴파일에 build-essential, cmake 필요: sudo apt install build-essential cmake)
python3 -m venv .venv
.venv/bin/pip install "llama-cpp-python[server]"

# 2) SEED 0.5B GGUF 모델 다운로드 (약 693MB, Q8_0)
mkdir -p models
curl -L -o models/seed-0.5b-q8_0.gguf \
  "https://huggingface.co/cherryDavid/HyperCLOVAX-SEED-Text-Instruct-0.5B-Q8_0-GGUF/resolve/main/hyperclovax-seed-text-instruct-0.5b-q8_0.gguf"
```

준비가 끝나면 `./start.sh` 하나로 모델 서버와 웹 서버가 함께 뜹니다.

### 다른 방식(GPU/네이버 클라우드 등)

`.env`의 `AI_BASE_URL`/`AI_MODEL`만 바꾸면 어떤 OpenAI 호환 서버든 연결됩니다.

**vLLM(GPU) 예시**
```bash
python -m vllm.entrypoints.openai.api_server \
  --model naver-hyperclovax/HyperCLOVAX-SEED-Text-Instruct-0.5B \
  --port 8008
```

> AI 서버가 응답하지 않으면 자동으로 규칙 엔진으로 폴백되므로 서비스는 멈추지 않습니다.
> CPU 추론은 응답에 수 초~수십 초가 걸릴 수 있어, 클라이언트 타임아웃을 120초로 설정해 두었습니다.

---

## 환경변수

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `PORT` | `3000` | 서버 포트 |
| `AI_BASE_URL` | `http://localhost:8000/v1` | OpenAI 호환 엔드포인트 |
| `AI_API_KEY` | `not-needed-for-local` | API 키(로컬은 임의값) |
| `AI_MODEL` | `HyperCLOVAX-SEED-Text-Instruct-0.5B` | 모델 이름 |
| `AI_DISABLED` | `false` | `true`면 AI 끄고 규칙 엔진만 사용 |

`.env`를 쓰려면 실행 시 로드하세요:
```bash
node --env-file=.env src/server.js
```

---

## 프로젝트 구조

```
maeum-matchum/
├─ src/
│  ├─ server.js              Express 서버
│  ├─ domain/assessment.js   10대 영역 · 30문항 · 애착 궁합표
│  ├─ services/
│  │  ├─ scoring.js          응답→점수, 궁합 계산 (결정론적)
│  │  ├─ agent.js            5단계 리포트 + 대화 생성
│  │  └─ aiClient.js         SEED 0.5B (OpenAI 호환) 호출 + 폴백
│  ├─ routes/api.js          REST API
│  └─ db/
│     ├─ index.js            SQLite 연결/스키마
│     ├─ repo.js             데이터 액세스
│     └─ init.js             DB 초기화 스크립트
├─ public/                   반응형 프론트엔드 (HTML/CSS/JS)
│  ├─ index.html
│  ├─ styles.css
│  └─ app.js
├─ data/maeum.db             SQLite (자동 생성)
├─ BUSINESS_PLAN.md          사업계획서
└─ package.json
```

---

## API 요약

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/api/assessment` | 문항·영역 메타 |
| GET | `/api/ai-status` | AI 연결 상태 |
| POST | `/api/users` | 본인 생성 + 진단 프로필 |
| POST | `/api/partners` | 상대 진단 프로필 |
| POST | `/api/analyze` | 궁합 분석 (판단>근거>추천>보완>실행) |
| GET | `/api/analysis/:id` | 분석 결과 조회 |
| POST | `/api/chat` | AI 에이전트 상담 대화 |

---

## 설계 하이라이트

- **결정론적 뼈대 + AI 레이어**: 점수·판단은 규칙 엔진이 만들고, AI는 문장을 다듬고 대화. AI 장애에도 서비스 지속.
- **애착유형 조합표**: 심리학 근거를 반영한 궁합 계산.
- **가중치 기반 종합점수**: 애착유형(1.5)·가치관/미래(1.4) 등 관계 핵심 영역에 높은 가중치.
- **모바일 퍼스트 반응형**: 560px 컨테이너 기준 모바일 최적화, 데스크톱 대응.

> ⚠️ 본 서비스의 분석은 참고용이며, 최종 결정은 사용자 본인의 몫입니다.
