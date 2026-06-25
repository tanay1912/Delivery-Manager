#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

echo "Starting dev stack (Postgres, Redis, backend --reload, Vite HMR)..."
echo "Open http://localhost:5173 after services are ready."
echo "Press Ctrl+C to stop."

docker compose -f docker-compose.dev.yml up --build
