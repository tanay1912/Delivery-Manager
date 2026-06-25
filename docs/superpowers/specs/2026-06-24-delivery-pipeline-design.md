# Delivery Pipeline — Design Spec

## Goal

Automate delivery from Jira ticket → Cursor-generated code → Bitbucket PR → human-approved merge, with optional Jira comment on personal sites.

## Decisions

| Topic | Choice |
|-------|--------|
| Jira auth | **API token** (no OAuth app / no `ATLASSIAN_*` env vars) |
| Merge policy | Human approval in UI before merge |
| Repo mapping | Admin maps Jira project → Bitbucket repo |
| Code generation | Cursor Agent SDK (cloud) |
| Jira write-back | Yes on personal site only; skip company until admin approves |
| Dev setup | Personal Jira + company Bitbucket token (server-side) |

## Phase 1 (complete)

- Postgres + `project_repo_mappings` table
- CRUD API: `GET/POST/PUT/DELETE /api/mappings`
- Admin UI: `/admin/mappings`

## Remaining phases

- **Phase 2:** Issue detail + Start run + run status UI
- **Phase 3:** Worker + Cursor Cloud integration
- **Phase 4:** Bitbucket PR create + approve/reject + merge
- **Phase 5:** Jira comment write-back (allowlisted sites)
