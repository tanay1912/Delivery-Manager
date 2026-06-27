#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  if [[ -f .env.example ]]; then
    cp .env.example .env
    echo "Created .env from .env.example — set SESSION_SECRET before production use."
  else
    echo "Error: .env not found. Copy .env.example to .env first." >&2
    exit 1
  fi
fi

# shellcheck source=scripts/compose.sh
source "$ROOT/scripts/compose.sh"
resolve_compose

echo "Starting dev stack (Postgres, Redis, backend --reload, Vite HMR)..."
echo "Open http://localhost:5173 after services are ready."
echo "Press Ctrl+C to stop."

"${COMPOSE[@]}" up --build
