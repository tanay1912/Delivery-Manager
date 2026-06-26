# Delivery Manager

Docker-based web app to connect to Jira Cloud with an API token, view projects and tickets, and configure delivery pipeline mappings.

## Stack

- **Backend:** FastAPI (Python 3.12)
- **Frontend:** React + Vite + TypeScript + Tailwind CSS
- **Database:** Postgres (project → repo mappings)
- **Session store:** Redis
- **Auth:** Jira API token (per user, no OAuth app required)

## Prerequisites

1. [Docker](https://docs.docker.com/get-docker/) and Docker Compose
2. A Jira Cloud site you can access (personal or company)
3. An [Atlassian API token](https://id.atlassian.com/manage-profile/security/api-tokens)

No Atlassian Developer Console or OAuth app registration is required.

## Quick start

```bash
cd deliverymanager
cp .env.example .env
# Set SESSION_SECRET to a long random string

docker compose up --build
```

Open **http://localhost:3000** and connect with:

| Field | Example |
|-------|---------|
| Jira site URL | `yoursite.atlassian.net` or `cp-jira.atlassian.net` |
| Email | Your Atlassian account email |
| API token | From [id.atlassian.com](https://id.atlassian.com/manage-profile/security/api-tokens) |

| Service  | URL                    |
|----------|------------------------|
| App      | http://localhost:3000  |
| API      | http://localhost:8000  |
| API docs | http://localhost:8000/docs |

## Development (hot reload — recommended while coding)

Use the **dev stack** instead of `docker compose up --build` after every change:

```bash
./dev.sh
# or: docker compose -f docker-compose.dev.yml up --build
```

Open **http://localhost:5173** (not 3000).

| What you change | What happens |
|-----------------|--------------|
| `backend/app/**` | Backend restarts automatically (`uvicorn --reload`) |
| `frontend/src/**` | Browser updates instantly (Vite HMR) |
| `requirements.txt` | Rebuild once: `docker compose -f docker-compose.dev.yml up --build backend` |
| `frontend/package.json` | Rebuild once: `docker compose -f docker-compose.dev.yml up --build frontend` |

**Production-like build** (nginx on port 3000) — only when testing the final Docker image:

```bash
docker compose up --build
```

### Dev without Docker for app code

Run only infra in Docker, app locally:

```bash
docker compose -f docker-compose.dev.yml up -d redis postgres backend
cd frontend && npm install && npm run dev
```

## Environment variables

| Variable | Description |
|----------|-------------|
| `SESSION_SECRET` | Random string for signing session cookies and encrypting stored API tokens |
| `REDIS_URL` | Redis connection URL (default in Docker: `redis://redis:6379/0`) |
| `DATABASE_URL` | Postgres URL (default in Docker: `postgresql+asyncpg://deliverymanager:deliverymanager@postgres:5432/deliverymanager`) |
| `FRONTEND_URL` | Frontend origin (default: `http://localhost:3000`; use `http://localhost:5173` when running Vite dev) |
| `CORS_ORIGINS` | Comma-separated allowed origins (default: `http://localhost:3000`; add `http://localhost:5173` for Vite dev if not using the proxy) |
| `JIRA_WRITEBACK_ENABLED` | Post PR link comments to Jira (default: `true`) |
| `JIRA_IMPACT_ANALYSIS_FIELD` | Jira custom field id for Impact Analysis (optional; auto-discovered by name if unset) |

## Local development (without Docker)

### Backend

```bash
cd backend
pip install -r requirements.txt
# Start Redis and Postgres (e.g. via docker compose -f docker-compose.dev.yml up -d redis postgres)
uvicorn app.main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173**. Vite proxies `/api` to `http://localhost:8000`.

## Features

- **Connect to Jira** — API token auth (works on company sites without OAuth app admin approval)
- **Projects sidebar** — Jira projects visible to your account
- **Tickets table** — paginated issue list, filterable by project
- **Project → repo mappings** — admin UI at `/admin/mappings`
- **Deliver workflow** — dedicated `/deliver/{issue-key}` page with estimation, implementation, and PR review
- **Approve & Merge** — human approval in the run panel before merging the PR
- **Session management** — HTTP-only cookies, encrypted token storage, logout

## Delivery pipeline

Click **Deliver** on a ticket to open the delivery workflow page (`/deliver/{issue-key}`).

### Step 1 — Estimation

- If the ticket is **To Do**, status moves to **In Estimation**
- AI prepares an estimate and a draft Jira comment
- Edit the comment and hours, then **Post estimation to Jira** (updates Original estimate and moves to **Estimation Completed**)
- If the ticket is unclear, **Post question & set Waiting For Info**

### Step 2 — Implementation

- Click **Start implementation** — status moves to **In Progress**
- Creates a feature branch (named with the Jira issue key, e.g. `feature/PROJ-123-summary`), runs **Cursor Cloud Agent** development (or OpenAI fallback if Cursor is not configured in Settings), commits, and opens Bitbucket PRs

### Step 3 — Pull request

- Review the PR link and changed files list
- **Approve & Merge** when ready

Configure OpenAI, Cursor, and Bitbucket credentials in **Settings**, and add a project mapping before running.

For Bitbucket, use your **Atlassian account email** and a **Bitbucket API token** (not an app password). Create the token at [id.atlassian.com](https://id.atlassian.com/manage-profile/security/api-tokens) with repository read and write scopes.

## Architecture

```
Browser → Nginx (frontend:3000) → /api/* → FastAPI (backend:8000) → Jira REST API
                                      ↓
                              Postgres (mappings) + Redis (sessions)
```

## Why API tokens instead of OAuth?

OAuth 3LO apps require a site admin to authorize the app on many company Jira sites. **API tokens use your own Jira account** — if you can log into Jira in the browser, your token can access the same data via the REST API.

## Production notes

- Use HTTPS and set `Secure` on session cookies
- Replace `SESSION_SECRET` with a strong random value
- Put a reverse proxy (Caddy, Traefik, nginx) in front for TLS termination

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Invalid credentials on connect | Check site URL, email, and API token; token must belong to the same email |
| Bitbucket 401 during delivery | Reconnect Bitbucket in Settings using your Atlassian email and a Bitbucket API token (app passwords no longer work for repository APIs) |
| 401 on dashboard | Session expired — connect again |
| Empty projects/tickets | Confirm your account has Jira access on that site |
| Company site blocked OAuth before | API tokens bypass OAuth app approval — use your work email + token |
