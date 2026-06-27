#!/usr/bin/env bash
# Shared Docker Compose detection for dev scripts.
# Usage (from project root):
#   source "$(dirname "$0")/scripts/compose.sh"
#   resolve_compose
#   "${COMPOSE[@]}" up -d

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.dev.yml}"

_compose_accepts_file() {
  local -a cmd=("$@")
  "${cmd[@]}" -f "$COMPOSE_FILE" config >/dev/null 2>&1
}

resolve_compose() {
  # Prefer standalone docker-compose — common on Ubuntu when the compose plugin is missing.
  if command -v docker-compose >/dev/null 2>&1 && _compose_accepts_file docker-compose; then
    COMPOSE=(docker-compose -f "$COMPOSE_FILE")
    return 0
  fi

  if _compose_accepts_file docker compose; then
    COMPOSE=(docker compose -f "$COMPOSE_FILE")
    return 0
  fi

  if command -v docker-compose >/dev/null 2>&1 && _compose_accepts_file sudo docker-compose; then
    COMPOSE=(sudo docker-compose -f "$COMPOSE_FILE")
    return 0
  fi

  if _compose_accepts_file sudo docker compose; then
    COMPOSE=(sudo docker compose -f "$COMPOSE_FILE")
    return 0
  fi

  echo "Error: Docker Compose is not available." >&2
  echo "" >&2
  echo "This usually means the Compose plugin is not installed. Running" >&2
  echo "  docker compose -f ..." >&2
  echo "fails with: unknown shorthand flag: 'f' in -f" >&2
  echo "" >&2
  echo "Install one of these, then run ./restart.sh again:" >&2
  echo "  sudo apt install docker-compose-plugin   # recommended (docker compose)" >&2
  echo "  sudo apt install docker-compose          # standalone (docker-compose)" >&2
  exit 1
}
