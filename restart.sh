#!/usr/bin/env bash
# Restart the full Delivery Manager dev stack (Postgres, Redis, backend, frontend).
# Usage: ./restart.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

COMPOSE_FILE="docker-compose.dev.yml"
COMPOSE=(docker compose -f "$COMPOSE_FILE")

if ! command -v docker >/dev/null 2>&1; then
  echo "Error: docker is not installed or not on PATH." >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Error: cannot connect to Docker. Is the daemon running? Do you have permission?" >&2
  exit 1
fi

if [[ ! -f .env ]]; then
  echo "Error: .env not found. Copy .env.example to .env and configure it first." >&2
  exit 1
fi

wait_for_url() {
  local name="$1"
  local url="$2"
  local max_attempts="${3:-60}"

  echo -n "Waiting for $name"
  for ((i = 1; i <= max_attempts; i++)); do
    if curl -sf "$url" >/dev/null 2>&1; then
      echo " ready"
      return 0
    fi
    echo -n "."
    sleep 1
  done
  echo " failed"
  return 1
}

echo "Stopping dev stack..."
"${COMPOSE[@]}" down --remove-orphans

echo "Building and starting dev stack..."
"${COMPOSE[@]}" up --build -d

if ! wait_for_url "backend" "http://localhost:8000/api/health"; then
  echo ""
  echo "Backend did not become healthy. Recent logs:"
  "${COMPOSE[@]}" logs --tail=40 backend
  exit 1
fi

if ! wait_for_url "frontend" "http://localhost:5173"; then
  echo ""
  echo "Frontend did not become ready. Recent logs:"
  "${COMPOSE[@]}" logs --tail=40 frontend
  exit 1
fi

echo ""
echo "All services are running."
echo "  App:  http://localhost:5173"
echo "  API:  http://localhost:8000"
echo "  Docs: http://localhost:8000/docs"
echo ""
"${COMPOSE[@]}" ps
