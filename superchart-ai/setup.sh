#!/usr/bin/env bash
# Chart-OS 원클릭 설치 스크립트 (Docker 없이 직접 설치)
set -e

echo "═══════════════════════════════════════"
echo "  Chart-OS 설치 시작"
echo "═══════════════════════════════════════"

# ── 1. Python 확인 ──
if ! command -v python3 &>/dev/null; then
    echo "❌ Python 3 필요. 설치: sudo apt install python3 python3-pip python3-venv"
    exit 1
fi

# ── 2. 가상환경 + 패키지 ──
echo "📦 Python 패키지 설치..."
python3 -m venv .venv
source .venv/bin/activate
pip install --quiet --upgrade pip
pip install --quiet . torch --index-url https://download.pytorch.org/whl/cpu

# ── 3. PostgreSQL ──
if command -v psql &>/dev/null; then
    echo "🐘 PostgreSQL 감지됨"
else
    echo "🐘 PostgreSQL 설치 중..."
    sudo apt-get update -qq && sudo apt-get install -y -qq postgresql postgresql-contrib
    sudo systemctl enable postgresql
    sudo systemctl start postgresql
fi

# DB 생성 (이미 있으면 무시)
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='chart'" | grep -q 1 || \
    sudo -u postgres psql -c "CREATE USER chart WITH PASSWORD 'chart';"
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='chart_os'" | grep -q 1 || \
    sudo -u postgres psql -c "CREATE DATABASE chart_os OWNER chart;"
sudo -u postgres psql -d chart_os -f src/db/ddl.sql 2>/dev/null || true
echo "✅ PostgreSQL 준비 완료"

# ── 4. Redis ──
if command -v redis-server &>/dev/null; then
    echo "🔴 Redis 감지됨"
else
    echo "🔴 Redis 설치 중..."
    sudo apt-get install -y -qq redis-server
    sudo systemctl enable redis-server
    sudo systemctl start redis-server
fi
echo "✅ Redis 준비 완료"

# ── 5. Ollama + LLM 모델 ──
if command -v ollama &>/dev/null; then
    echo "🤖 Ollama 감지됨"
else
    echo "🤖 Ollama 설치 중..."
    curl -fsSL https://ollama.com/install.sh | sh
fi

# Ollama 서비스 시작
sudo systemctl enable ollama 2>/dev/null || true
sudo systemctl start ollama 2>/dev/null || ollama serve &>/dev/null &
sleep 3

# kanana-chart 모델 생성
if ! ollama list 2>/dev/null | grep -q kanana-chart; then
    echo "🤖 kanana-chart 모델 다운로드 중 (약 1.8GB)..."
    ollama pull llama3.2:1b
    ollama create kanana-chart -f Modelfile
fi
echo "✅ Ollama + kanana-chart 준비 완료"

# ── 6. .env 파일 ──
if [ ! -f .env ]; then
    cp .env.example .env
    echo "📝 .env 파일 생성됨 (필요시 수정하세요)"
fi

# ── 7. systemd 서비스 (선택) ──
read -p "🔧 systemd 서비스로 등록할까요? (y/N): " yn
if [[ "$yn" =~ ^[Yy]$ ]]; then
    WORK_DIR=$(pwd)
    VENV_PYTHON="$WORK_DIR/.venv/bin/python3"
    sudo tee /etc/systemd/system/chart-os.service > /dev/null <<EOF
[Unit]
Description=AI Chart OS
After=network.target postgresql.service ollama.service
Wants=ollama.service

[Service]
Type=simple
User=$(whoami)
WorkingDirectory=$WORK_DIR
ExecStart=$VENV_PYTHON -m uvicorn src.main:app --host 0.0.0.0 --port 8000
Restart=always
RestartSec=5
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
EOF
    sudo systemctl daemon-reload
    sudo systemctl enable chart-os
    sudo systemctl start chart-os
    echo "✅ chart-os 서비스 등록 및 시작 완료"
else
    echo ""
    echo "수동 실행: source .venv/bin/activate && uvicorn src.main:app --host 0.0.0.0 --port 8000"
fi

echo ""
echo "═══════════════════════════════════════"
echo "  ✅ 설치 완료!"
echo "  🌐 http://localhost:8000"
echo "═══════════════════════════════════════"
