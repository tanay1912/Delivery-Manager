#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if [[ ! -f .env ]]; then
  if [[ -f .env.example ]]; then
    cp .env.example .env
    echo "Created .env from .env.example — set SESSION_SECRET before production use."
  else
    echo "Error: .env not found. Copy .env.example to .env first." >&2
    exit 1
  fi
fi

echo "Starting dev stack (Postgres, Redis, backend --reload, Vite HMR)..."
echo "Open http://localhost:5173 after services are ready."
echo "Press Ctrl+C to stop."

docker compose -f docker-compose.dev.yml up --build
