#!/usr/bin/env bash
set -euo pipefail
DDT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DDT_ROOT/backend"
.venv/bin/ruff check --config pyproject.toml app tests
.venv/bin/ruff format --config pyproject.toml --check app tests
.venv/bin/python -m pytest -q
cd "$DDT_ROOT/frontend"
npm run format:check
node "$DDT_ROOT/scripts/audit-frontend.mjs" "$DDT_ROOT/frontend"
npm run build
echo '浏览器验收：启动前后端后，在 frontend 目录运行 npm run test:e2e'
