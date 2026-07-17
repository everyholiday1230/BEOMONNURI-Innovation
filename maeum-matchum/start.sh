#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# 마음맞춤 통합 실행 스크립트
#   1) HyperCLOVA X SEED 0.5B 모델 서버 (llama.cpp, OpenAI 호환)
#   2) 마음맞춤 웹 서버 (Node/Express)
#
# 사용법:
#   ./start.sh          # 두 서버 실행
#   ./start.sh stop     # 두 서버 종료
#   ./start.sh status   # 상태 확인
# ─────────────────────────────────────────────────────────────
set -euo pipefail

cd "$(dirname "$0")"

# ── 설정 (환경변수로 덮어쓸 수 있음) ──
MODEL_PORT="${MODEL_PORT:-8008}"
WEB_PORT="${WEB_PORT:-3100}"
MODEL_FILE="${MODEL_FILE:-models/seed-0.5b-q8_0.gguf}"
MODEL_ALIAS="${MODEL_ALIAS:-HyperCLOVAX-SEED-Text-Instruct-0.5B}"
N_THREADS="${N_THREADS:-4}"
N_CTX="${N_CTX:-4096}"

VENV_PY=".venv/bin/python"
RUN_DIR=".run"
mkdir -p "$RUN_DIR"
MODEL_PID_FILE="$RUN_DIR/model.pid"
WEB_PID_FILE="$RUN_DIR/web.pid"
MODEL_LOG="$RUN_DIR/model.log"
WEB_LOG="$RUN_DIR/web.log"

is_alive() { [ -f "$1" ] && kill -0 "$(cat "$1")" 2>/dev/null; }

stop_all() {
  echo "🛑 서버를 종료합니다..."
  for f in "$WEB_PID_FILE" "$MODEL_PID_FILE"; do
    if is_alive "$f"; then
      kill "$(cat "$f")" 2>/dev/null || true
      echo "   종료: PID $(cat "$f")"
    fi
    rm -f "$f"
  done
  echo "✅ 종료 완료"
}

status() {
  echo "── 마음맞춤 상태 ──"
  if is_alive "$MODEL_PID_FILE"; then
    echo "🟢 모델 서버   : 실행 중 (PID $(cat "$MODEL_PID_FILE"), 포트 $MODEL_PORT)"
  else
    echo "⚪ 모델 서버   : 중지됨"
  fi
  if is_alive "$WEB_PID_FILE"; then
    echo "🟢 웹 서버     : 실행 중 (PID $(cat "$WEB_PID_FILE"), http://localhost:$WEB_PORT)"
  else
    echo "⚪ 웹 서버     : 중지됨"
  fi
}

case "${1:-start}" in
  stop)   stop_all; exit 0 ;;
  status) status;   exit 0 ;;
esac

# ── 사전 점검 ──
if [ ! -f "$MODEL_FILE" ]; then
  echo "❌ 모델 파일이 없습니다: $MODEL_FILE"
  echo "   README의 'AI 모델 연결' 절을 참고해 GGUF를 내려받으세요."
  exit 1
fi
if [ ! -x "$VENV_PY" ]; then
  echo "❌ 파이썬 가상환경이 없습니다 ($VENV_PY)."
  echo "   python3 -m venv .venv && .venv/bin/pip install 'llama-cpp-python[server]'"
  exit 1
fi

# 이미 떠 있으면 중복 실행 방지
if is_alive "$MODEL_PID_FILE" || is_alive "$WEB_PID_FILE"; then
  echo "⚠️  이미 실행 중입니다. 재시작하려면 './start.sh stop' 후 다시 실행하세요."
  status
  exit 0
fi

# ── 1) 모델 서버 실행 ──
echo "🤖 SEED 0.5B 모델 서버 시작 (포트 $MODEL_PORT)..."
nohup "$VENV_PY" -m llama_cpp.server \
  --model "$MODEL_FILE" \
  --model_alias "$MODEL_ALIAS" \
  --host 127.0.0.1 --port "$MODEL_PORT" \
  --n_ctx "$N_CTX" --n_threads "$N_THREADS" \
  > "$MODEL_LOG" 2>&1 &
echo $! > "$MODEL_PID_FILE"

# 모델 로딩 대기 (/v1/models 응답할 때까지 최대 60초)
echo -n "   모델 로딩 대기"
for i in $(seq 1 60); do
  if curl -s -m 2 "http://127.0.0.1:$MODEL_PORT/v1/models" >/dev/null 2>&1; then
    echo " ✅"
    break
  fi
  echo -n "."
  sleep 1
  if [ "$i" -eq 60 ]; then
    echo ""
    echo "❌ 모델 서버가 시간 내에 뜨지 않았습니다. 로그: $MODEL_LOG"
    tail -15 "$MODEL_LOG"
    stop_all
    exit 1
  fi
done

# ── 2) 웹 서버 실행 ──
echo "💗 마음맞춤 웹 서버 시작 (포트 $WEB_PORT)..."
AI_BASE_URL="http://127.0.0.1:$MODEL_PORT/v1" \
AI_MODEL="$MODEL_ALIAS" \
AI_DISABLED=false \
PORT="$WEB_PORT" \
nohup node src/server.js > "$WEB_LOG" 2>&1 &
echo $! > "$WEB_PID_FILE"
sleep 2

# ── 결과 안내 ──
echo ""
if is_alive "$WEB_PID_FILE" && is_alive "$MODEL_PID_FILE"; then
  echo "════════════════════════════════════════"
  echo " ✅ 마음맞춤이 실행되었습니다!"
  echo "    👉 http://localhost:$WEB_PORT"
  echo "    🤖 AI 모델: $MODEL_ALIAS (실제 연결)"
  echo "────────────────────────────────────────"
  echo "    종료:  ./start.sh stop"
  echo "    상태:  ./start.sh status"
  echo "    로그:  $WEB_LOG / $MODEL_LOG"
  echo "════════════════════════════════════════"
else
  echo "❌ 실행 실패. 로그를 확인하세요:"
  echo "   모델: $MODEL_LOG"
  echo "   웹  : $WEB_LOG"
  stop_all
  exit 1
fi
