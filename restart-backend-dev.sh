#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

# shellcheck source=scripts/compose.sh
source "$ROOT/scripts/compose.sh"
resolve_compose

echo "Rebuilding and restarting the dev backend (hot-reload, current API routes)..."
"${COMPOSE[@]}" up --build -d backend
echo ""
echo "Waiting for backend health..."
for _ in $(seq 1 30); do
  if curl -sf http://localhost:8000/health | grep -q estimation_workflow; then
    echo "Backend is ready with estimation workflow API."
    curl -s http://localhost:8000/health
    echo ""
    exit 0
  fi
  sleep 1
done

echo "Backend started but estimation API not detected yet. Check: ${COMPOSE[*]} logs backend"
exit 1
