# Delivery Manager

Docker-based web app to connect to Jira Cloud with an API token, view assigned tickets, configure project mappings, and run an AI-assisted delivery pipeline from estimation through deployment and verification.

## Stack

- **Backend:** FastAPI (Python 3.12)
- **Frontend:** React + Vite + TypeScript + Tailwind CSS
- **Database:** Postgres (project → repo mappings, Jira field settings)
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

After signing in, open **Settings → Setup overview** (`/settings`) and complete the four setup steps below before running a delivery.

## Configuration

Delivery Manager stores credentials encrypted in your session. Complete these steps in order (or use **Settings → Setup overview** to track progress).

### 1. Jira connection (`/settings/jira`)

Sign in with your Jira Cloud site URL, Atlassian account email, and API token. This session is used to load assigned tickets, post comments, transition statuses, and write custom fields during delivery.

### 2. Bitbucket credentials (`/settings/bitbucket`)

Two credential sets are required for the full pipeline:

| Credential | Purpose |
|------------|---------|
| **API token** (Atlassian email + Bitbucket API token) | Create branches, open/merge pull requests via the Bitbucket REST API |
| **Git credentials** (username + app password or token) | Clone/push on the deployment server over SSH |

Create a Bitbucket API token at [id.atlassian.com](https://id.atlassian.com/manage-profile/security/api-tokens) with repository read and write scopes. Use your **Atlassian account email** — app passwords no longer work for repository APIs.

### 3. AI provider (`/settings/ai`)

Connect at least one provider for estimation, code generation, and website verification:

| Provider | Used for |
|----------|----------|
| **Cursor** | Primary implementation agent (Cursor Cloud Agent) |
| **OpenAI** | Estimation, verification, and fallback implementation |

Choose the default implementation provider under **Settings → Preferences** (`/settings/preferences`).

### 4. Project mappings (`/admin/mappings`)

Link each Jira project to its Bitbucket repo and deployment settings. Each mapping has three tabs:

#### Bitbucket tab

| Field | Description |
|-------|-------------|
| Jira project key | e.g. `PROJ` |
| Bitbucket workspace & repo slug | Repository for branches and PRs |
| Staging / Live branch names | Default: `beta` / `master` |
| Staging / Live website URLs | Used for AI verification screenshots |

#### Cursor SDK tab

| Field | Description |
|-------|-------------|
| Rules | Mandatory instructions passed to Cursor and OpenAI during implementation |
| Skills | Additional context/skills for the AI agent |

#### Deployment tab

| Field | Description |
|-------|-------------|
| SSH host, port, username | Server accessed for post-merge deployment |
| SSH auth | Password or PEM private key |
| Run commands as root via sudo | Wraps deployment commands in `sudo su - root -c` |
| Local project directory | Path to the repo on your dev machine (shown in delivery git commands) |
| Project root directory | Remote path the deployment SSH session `cd`s into before running commands |
| Staging / Live post-merge commands | Shell commands run after each PR is merged (one per line) |

**Local project directory in Docker:** set `LOCAL_PROJECTS_HOST_PATH` in `.env` to the parent directory that contains your repos (default: `/var/www/html`). The backend container mounts this path so local git workflows can access the same files you configure in the mapping.

```bash
# .env
LOCAL_PROJECTS_HOST_PATH=/var/www/html
```

The mapping's **Local project directory** must be under this mounted path (e.g. `/var/www/html/myproject`).

### Jira custom fields (`/admin/database`)

Configure which Jira custom fields Delivery Manager writes during delivery:

| Field | Written when |
|-------|--------------|
| **Impact Analysis** | During implementation |
| **Unit Testing Field** | When posting Unit Testing verification to Jira |
| **Admin/ Database** | Admin-related file paths (e.g. `system.xml`, `admin/`) during Unit Testing verification |

Leave a field blank to auto-discover it by name in Jira (`Impact Analysis`, `Unit Testing`, `Unit Testing Field`, or `Admin/ Database`). If your Jira field uses a different name, set the exact `customfield_XXXXX` ID from **Jira → Settings → Issues → Custom fields**.

Server environment variables (`JIRA_IMPACT_ANALYSIS_FIELD`, `JIRA_UNIT_TESTING_FIELD`, `JIRA_ADMIN_DATABASE_FIELD`) override values saved in the Database admin UI when set.

## Development (hot reload — recommended while coding)

Use the **dev stack** instead of `docker compose up --build` after every change:

```bash
./restart.sh   # stop, rebuild, and start in the background (recommended after git pull)
# or: ./dev.sh
# or: docker compose -f docker-compose.dev.yml up --build
```

**First time after clone/pull:** `restart.sh` creates `.env` from `.env.example` automatically if it is missing. You only need to edit `.env` when changing paths or secrets.

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

When running Vite dev, set in `.env`:

```bash
FRONTEND_URL=http://localhost:5173
CORS_ORIGINS=http://localhost:3000,http://localhost:5173
```

## Environment variables

| Variable | Description |
|----------|-------------|
| `SESSION_SECRET` | Random string for signing session cookies and encrypting stored API tokens |
| `REDIS_URL` | Redis connection URL (default in Docker: `redis://redis:6379/0`) |
| `DATABASE_URL` | Postgres URL (default in Docker: `postgresql+asyncpg://deliverymanager:deliverymanager@postgres:5432/deliverymanager`) |
| `FRONTEND_URL` | Frontend origin (default: `http://localhost:3000`; use `http://localhost:5173` when running Vite dev) |
| `CORS_ORIGINS` | Comma-separated allowed origins (default: `http://localhost:3000`; add `http://localhost:5173` for Vite dev) |
| `LOCAL_PROJECTS_HOST_PATH` | Host directory mounted into the backend container for local git workflows (default: `/var/www/html`) |
| `JIRA_WRITEBACK_ENABLED` | Post PR link comments to Jira (default: `true`) |
| `JIRA_IMPACT_ANALYSIS_FIELD` | Jira custom field id for Impact Analysis (optional; auto-discovered by name if unset) |
| `JIRA_UNIT_TESTING_FIELD` | Jira custom field id for Unit Testing Field (optional; auto-discovered by name if unset) |
| `JIRA_ADMIN_DATABASE_FIELD` | Jira custom field id for Admin/ Database (optional; auto-discovered by name if unset) |

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
- **Dashboard** — **My tickets** (`/dashboard`) shows configured projects with per-project ticket counts broken down by Jira status and issue type (QIS, Bug, Task); filter the issue table by project or view all
- **Tickets table** — paginated issue list of tickets assigned to you, with status badges and quick **Deliver** action
- **Ticket history** — past delivery runs at `/history`
- **Settings hub** — guided setup at `/settings` with sections for Jira, Bitbucket, AI, and preferences
- **Project mappings** — admin UI at `/admin/mappings` (Bitbucket, Cursor SDK rules/skills, deployment SSH)
- **Jira custom fields** — admin UI at `/admin/database`
- **Deliver workflow** — dedicated `/deliver/{issue-key}` page with a four-step pipeline
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
- Creates a feature branch (named with the Jira issue key, e.g. `feature/PROJ-123-summary`), runs **Cursor Cloud Agent** development (or OpenAI fallback per your preference), commits, and opens Bitbucket PRs
- Writes **Impact Analysis** to the configured Jira custom field when applicable

### Step 3 — Pull request

- Review the PR link and changed files list
- **Approve & Merge** when ready — merges the Staging PR, runs Staging deployment commands over SSH, and opens a Live PR when configured

### Step 4 — Verification

- After Staging merge, the ticket transitions to **Unit Testing**
- AI verifies the Staging (and optionally Live) website URLs with screenshots
- Review results and **Post verification to Jira** — attaches screenshots and updates Unit Testing / Admin custom fields
- Merge the Live PR and run Live deployment when applicable

Configure OpenAI, Cursor, Bitbucket, project mappings, and Jira custom fields before running. Use **Settings → Setup overview** to confirm everything is connected.

## Architecture

```
Browser → Nginx (frontend:3000) → /api/* → FastAPI (backend:8000) → Jira REST API
                                      ↓                              → Bitbucket REST API
                              Postgres (mappings) + Redis (sessions)   → SSH (deployment)
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
| `./restart.sh` fails after git pull | Ensure Docker is running and your user can run `docker` (or use `sudo ./restart.sh`). If `.env` was missing, `restart.sh` creates it from `.env.example` on first run |
| Invalid credentials on connect | Check site URL, email, and API token; token must belong to the same email |
| Bitbucket 401 during delivery | Reconnect Bitbucket in Settings using your Atlassian email and a Bitbucket API token (app passwords no longer work for repository APIs) |
| 401 on dashboard | Session expired — connect again |
| Empty projects/tickets | Confirm your account has Jira access on that site; add a project mapping to see it on the dashboard |
| Local git commands fail in Docker | Set `LOCAL_PROJECTS_HOST_PATH` in `.env` to match the parent of your **Local project directory** in the mapping |
| Jira transition fails during delivery | Some workflows require fields the app cannot set; the pipeline retries without custom fields automatically |
| Company site blocked OAuth before | API tokens bypass OAuth app approval — use your work email + token |
