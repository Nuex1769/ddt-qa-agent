#!/usr/bin/env bash
set -euo pipefail
DDT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DDT_ROOT"
if [[ ! -f .env ]]; then cp .env.example .env; fi
command -v uv >/dev/null || { echo '请先安装 uv：https://docs.astral.sh/uv/'; exit 1; }
command -v npm >/dev/null || { echo '请先安装 Node.js 22.12+ 或 24 LTS'; exit 1; }
(cd backend && uv sync --frozen)
(cd frontend && npm ci --no-audit --no-fund)
echo 'DDT QA Agent：浏览器访问 http://localhost:5173'
(cd backend && exec .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload) &
DDT_API_PID=$!
(cd frontend && exec npm run dev) &
DDT_WEB_PID=$!
ddt_cleanup() { kill "$DDT_API_PID" "$DDT_WEB_PID" 2>/dev/null || true; }
trap ddt_cleanup EXIT INT TERM
wait "$DDT_API_PID" "$DDT_WEB_PID"
