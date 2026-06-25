#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

echo "Rebuilding and restarting the dev backend (hot-reload, current API routes)..."
docker compose -f docker-compose.dev.yml up --build -d backend
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

echo "Backend started but estimation API not detected yet. Check: docker compose -f docker-compose.dev.yml logs backend"
exit 1
