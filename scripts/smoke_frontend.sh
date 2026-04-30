#!/usr/bin/env bash
# Runtime smoke for the Next.js front-end.
#
# Boots uvicorn + `next start` and curls /, /projects, /projects/<id>.
# Verifies the SSR pages can talk to FastAPI (i.e. lib/api.ts SERVER_BASE
# resolution works without manual env vars).
#
# Run from repo root:
#   bash scripts/smoke_frontend.sh
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

PYTHON="$REPO/.venv/bin/python"
if [[ ! -x "$PYTHON" ]]; then
  PYTHON="$(command -v python3)"
fi

WEB_DIR="$REPO/web"
LOG_DIR="$(mktemp -d)"
echo "logs at: $LOG_DIR"

cleanup() {
  set +e
  [[ -n "${BACKEND_PID:-}" ]] && kill "$BACKEND_PID" 2>/dev/null
  [[ -n "${FRONTEND_PID:-}" ]] && kill "$FRONTEND_PID" 2>/dev/null
  wait 2>/dev/null
}
trap cleanup EXIT

# --- 1. backend ---
echo "==> starting uvicorn"
PYTHONPATH="$REPO" "$PYTHON" -m uvicorn server.main:app --port 8000 \
  > "$LOG_DIR/backend.log" 2>&1 &
BACKEND_PID=$!

for i in $(seq 1 30); do
  if curl -fsS http://localhost:8000/health >/dev/null 2>&1; then
    echo "backend up"
    break
  fi
  sleep 0.3
done
if ! curl -fsS http://localhost:8000/health >/dev/null 2>&1; then
  echo "backend failed to start — see $LOG_DIR/backend.log"
  exit 1
fi

# --- 2. seed a project so /projects has data ---
PROJECT_ID="$(curl -fsS -X POST http://localhost:8000/api/projects \
  -H 'Content-Type: application/json' \
  -d '{"title":"smoke","direction":"documentary","brief":"smoke run"}' \
  | "$PYTHON" -c 'import sys,json;print(json.load(sys.stdin)["id"])')"
echo "seeded project $PROJECT_ID"

# --- 3. frontend (production build) ---
echo "==> starting next start"
cd "$WEB_DIR"
if [[ ! -d ".next" ]]; then
  echo "building first (no .next/)"
  npm run build > "$LOG_DIR/build.log" 2>&1
fi
PORT=3000 npx --no-install next start > "$LOG_DIR/frontend.log" 2>&1 &
FRONTEND_PID=$!
cd "$REPO"

for i in $(seq 1 60); do
  if curl -fsS http://localhost:3000/ >/dev/null 2>&1; then
    echo "frontend up"
    break
  fi
  sleep 0.5
done
if ! curl -fsS http://localhost:3000/ >/dev/null 2>&1; then
  echo "frontend failed to start — see $LOG_DIR/frontend.log"
  exit 1
fi

# --- 4. SSR smoke ---
fail=0
check() {
  local label="$1"
  local url="$2"
  local needle="$3"
  if curl -fsS "$url" | grep -q "$needle"; then
    echo "ok: $label ($url contains '$needle')"
  else
    echo "FAIL: $label ($url did NOT contain '$needle')"
    fail=1
  fi
}

check "home" "http://localhost:3000/" "aivedio"
check "projects list shows seeded" "http://localhost:3000/projects" "smoke"
check "project detail page" "http://localhost:3000/projects/$PROJECT_ID" "$PROJECT_ID"

if [[ "$fail" -ne 0 ]]; then
  echo
  echo "=== backend log tail ==="
  tail -30 "$LOG_DIR/backend.log" || true
  echo
  echo "=== frontend log tail ==="
  tail -50 "$LOG_DIR/frontend.log" || true
  exit 1
fi

echo
echo "frontend smoke PASSED"
