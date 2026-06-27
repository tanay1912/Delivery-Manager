#!/usr/bin/env bash
# Restart the full Delivery Manager dev stack (Postgres, Redis, backend, frontend).
# Usage: ./restart.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

COMPOSE_FILE="docker-compose.dev.yml"

read_env_value() {
  local key="$1"
  local default="${2:-}"
  if [[ ! -f .env ]]; then
    echo "$default"
    return
  fi
  local line
  line="$(grep -E "^${key}=" .env | tail -1 || true)"
  if [[ -z "$line" ]]; then
    echo "$default"
    return
  fi
  echo "${line#*=}"
}

ensure_env_file() {
  if [[ -f .env ]]; then
    return 0
  fi

  if [[ ! -f .env.example ]]; then
    echo "Error: .env not found and .env.example is missing." >&2
    echo "After git pull, create .env once with: cp .env.example .env" >&2
    exit 1
  fi

  cp .env.example .env
  local secret
  if command -v openssl >/dev/null 2>&1; then
    secret="$(openssl rand -hex 32)"
  else
    secret="change-me-$(date +%s)"
  fi
  sed -i "s/^SESSION_SECRET=.*/SESSION_SECRET=${secret}/" .env

  echo "Created .env from .env.example (generated SESSION_SECRET)."
  echo "Edit .env if you need a different LOCAL_PROJECTS_HOST_PATH or other settings."
}

ensure_mount_path() {
  local mount_path
  mount_path="$(read_env_value LOCAL_PROJECTS_HOST_PATH /var/www/html)"
  if [[ -z "$mount_path" ]]; then
    mount_path="/var/www/html"
  fi
  if [[ ! -d "$mount_path" ]]; then
    echo "Creating LOCAL_PROJECTS_HOST_PATH directory: $mount_path"
    mkdir -p "$mount_path"
  fi
}

check_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "Error: docker is not installed or not on PATH." >&2
    echo "Install Docker: https://docs.docker.com/get-docker/" >&2
    exit 1
  fi

  if docker info >/dev/null 2>&1; then
    return 0
  fi

  echo "Error: cannot connect to Docker." >&2
  echo "" >&2
  if id -nG "$USER" 2>/dev/null | grep -qw docker; then
    echo "Docker is installed but the daemon may not be running." >&2
    echo "Try: sudo systemctl start docker" >&2
  else
    echo "Your user does not have permission to use Docker. Fix with either:" >&2
    echo "  sudo usermod -aG docker \$USER   # then log out and back in" >&2
    echo "  sudo ./restart.sh                # one-off run with sudo" >&2
  fi
  exit 1
}

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

ensure_env_file
ensure_mount_path
check_docker
# shellcheck source=scripts/compose.sh
source "$ROOT/scripts/compose.sh"
resolve_compose

if ! command -v curl >/dev/null 2>&1; then
  echo "Error: curl is required for health checks. Install curl and retry." >&2
  exit 1
fi

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
