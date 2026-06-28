# Design — `/backend` (FastAPI), incremental extraction

**Date:** 2026-06-28
**Status:** Approved (design); spec under review
**Author:** Claude + Nicolas

---

## 1. Goal

Stand up a real backend in `/backend` to make the app a more complete, properly-separated
application. The work is **two phases, done incrementally**:

- **Phase 1 — Extract.** Move the server tier (data access, business logic, API) out of
  `/frontend` into a dedicated **Python / FastAPI** service. Same features, clean boundary.
- **Phase 2 — Extend.** Build new capabilities on the clean foundation (real auth/RBAC
  enforcement, a scheduler that materializes inspections, notifications/webhooks,
  multi-airport). Phase 2 is **previewed here, not designed** — it gets its own spec.

This document specifies Phase 1 in full and outlines Phase 2.

## 2. Current state (what we're extracting)

Today `/frontend` (Next.js, port 3000) is simultaneously the UI, API gateway, business-logic
layer, and data-access layer. `/ml-service` (Python/FastAPI, port 8000) is a separate CV/RL
service. `/backend` is an **empty directory**.

The de-facto backend lives in `frontend/lib/` (all Node-runtime, server-only) + `frontend/app/api/`:

- **`lib/db.ts`** — `pg` pool + the full `SCHEMA` DDL (13 tables, `ticket_seq START 1042`,
  indices, UNIQUE constraints for idempotency). Transactions are scoped via **`AsyncLocalStorage`**
  so nested calls auto-join the open transaction. Helpers: `one/all/run/query`, `tx<T>()`.
  `?`→`$n` placeholder rewriting.
- **`lib/repo.ts`** (~1,000 lines) — typed queries + business logic:
  - *Issue state machine*: `approveIssue` (idempotent; creates `Ticket` from `ticket_seq`;
    computes `draftEditDistance` via jsdiff; race-safe on `UNIQUE(issue_id)` catching `23505`),
    `rejectIssue` (requires one of 7 `RejectionReason`), `manualReviewIssue`,
    `editIssue` (blocked once approved/rejected).
  - *Ticket state machine*: `repairTicket` (sent/in_progress → repaired), `closeTicket`.
  - *Immutable audit history*: every transition appends to `issue_status_history` /
    `ticket_status_history` (never UPDATE/DELETE) — compliance trail **and** RL training signal.
  - *Feedback / RL export*: `getRejectionRecords`, `getDraftPairs`, `getDecisionRecords`,
    `exportFeedbackJsonl` (NDJSON), `getIssueDraftDiff` (word-level diff).
  - *Reports*: `getInspectionReport` + `renderReportHtml` (print-ready HTML string).
  - *Overview aggregation*: `getOverview` (per-runway counts, severity histograms, totals).
  - *Ingestion*: `runInspectionNow` (idempotent per day), `ingestUpload` (transactional),
    plus Airport/Runway/Zone/User/Schedule/Drone CRUD + reads.
- **`lib/storage.ts`** — S3 (`@aws-sdk/client-s3`), dev fallback to `public/uploads`.
- **`lib/llm.ts`** — ticket drafting: `RL_SERVICE_URL/rl/draft` → Claude (`ANTHROPIC_API_KEY`)
  → deterministic template. Never throws. Produces immutable `ai_draft_text`.
- **`lib/mlDetector.ts`** — POSTs to `ML_SERVICE_URL/detect`, validates/clamps, falls back to
  `lib/detector.ts` (deterministic stub).
- **`lib/http.ts`** — `route()` wrapper (uniform error → JSON: 404 on "not found", 400
  validation, 500 internal/Postgres SQLSTATE, no schema leakage) + `actorFrom(req, body)`.
- **`lib/seed-db.ts`** — idempotent seed.

**API surface:** ~25 routes under `frontend/app/api/**/route.ts`, all `runtime="nodejs"`,
`dynamic="force-dynamic"`, wrapped by `route()`. Full inventory in §10.

`/ml-service` is also a **caller** of the frontend: `live_worker.py` POSTs detections to
`/api/live-capture`; `rl/train.py` pulls `GET /api/feedback-export`. These URLs are external
contracts, not just UI ones.

> **Note on the docs.** `docs/prd.md`, `design-plan.md`, `implementation-plan.md` describe a
> *different* intended backend (Python/FastAPI + 3× SQLite + enforced RBAC, perception colocated
> in-process). The running code superseded that (Postgres, S3, separate ml-service, advisory
> roles). The docs are useful for **intent** (lifecycle, enums, RBAC model, feedback semantics)
> but are **not** an accurate description of the running system.

## 3. Locked decisions

| Fork | Decision | Rationale |
|---|---|---|
| Stack | **Python / FastAPI** | Matches `/ml-service` + the user's multi-app archetype. Accepts that Phase 1 is a faithful *reimplementation* of `repo.ts`, guarded by parity tests. |
| Migration path | **Proxy through Next (strangler)** | Each Next route becomes a thin `fetch(BACKEND_URL/...)` forwarder. `lib/api.ts` and all URLs stay identical — browser **and** `live_worker.py` unaffected. Per-slice, reversible, no CORS. |
| Datastore | **Keep Postgres + current schema, frozen** | Reverting to SQLite would be a regression. Backend connects via `asyncpg`. Schema stays owned by frontend `db:setup` during extraction (no DDL churn). |
| Contract | **FastAPI OpenAPI + per-route parity tests; `lib/api.ts` untouched** | Proxying means the frontend keeps calling `/api/*` and getting identical JSON. Parity tests are the drift guardrail. TS-client codegen is a Phase-2 nicety. |
| Schema ownership | **Frozen in Phase 1; Alembic baseline in Phase 2** | Don't let a migration-tooling project block the extraction. Introduce Alembic (baseline = current schema) when Phase 2 first needs DDL. |
| First slices | **Plumbing read → ticket lifecycle; uploads last** | Prove the pipe cheaply, then the first stateful domain. Defer the most-coupled route (S3 + ml + LLM). |
| New backend port | **8080** | 3000 = frontend, 8000 = ml-service, **8080 = backend**. |

## 4. Target architecture

```
Browser ──► /frontend (Next :3000) ──proxy──► /backend (FastAPI :8080)
 lib/api.ts   app/api/**  (thin forwarders)      app/  ──asyncpg──► Postgres (same DB/schema)
 (unchanged)                                          ──boto3────► S3
                                                       ──httpx────► /ml-service (:8000)
                                                       ──anthropic► Claude (drafting)
live_worker.py ──POST /api/live-capture──► (Next proxy) ──► backend   (URL stays stable)
rl/train.py    ──GET  /api/feedback-export ► (Next proxy) ──► backend
```

The frontend stops being the server tier; it becomes UI + a paper-thin proxy layer we can
eventually delete (or keep as a permanent thin BFF).

## 5. `/backend` structure

```
backend/
  app/
    main.py            # FastAPI app, exception handlers, router mounts, OpenAPI metadata
    config.py          # env: DATABASE_URL, DATABASE_CA_CERT/SSL flags, S3_*, ML_SERVICE_URL,
                       #      ML_TIMEOUT_MS, RL_SERVICE_URL, ANTHROPIC_API_KEY, PORT
    db.py              # asyncpg pool + contextvar-scoped tx()  (ports lib/db.ts)
    schema.sql         # baseline DDL copied from lib/db.ts (reference + future Alembic baseline)
    models.py          # Pydantic v2 models, camelCase via alias  (ports lib/types.ts)
    repo/              # ports lib/repo.ts split by domain:
                       #   tickets.py, issues.py, inspections.py, runways.py, zones.py,
                       #   airports.py, schedules.py, users.py, drones.py, overview.py,
                       #   feedback.py, ingest.py
    services/          # storage.py (boto3 S3), llm.py (drafting chain), ml.py (httpx detect),
                       #   report.py (HTML render)
    routers/           # FastAPI routers = the API: tickets.py, issues.py, … (one per domain)
    deps.py            # actor_from(request) dependency  (ports http.ts actorFrom)
    errors.py          # AppError + exception handlers → 404/400/422/500  (ports http.ts route())
  tests/               # contract-parity + unit (state machines, tx atomicity)
  requirements.txt
  run.sh               # uvicorn app.main:app --port 8080
  docs.md              # what lives here + why (per repo convention)
shared/                # Phase 2 (optional): generated OpenAPI / TS client
```

## 6. Core mechanics (the make-or-break ports)

### 6.1 Transactions — `AsyncLocalStorage` → `contextvars`
`lib/db.ts` keeps the open transaction's client in an `AsyncLocalStorage` so a nested `repo`
call joins it without threading a client. Port:

- A module-level `ContextVar[asyncpg.Connection | None]` (`_current_conn`).
- `async with tx():` acquires a pool connection, opens `conn.transaction()`, sets the
  contextvar, yields, commits on success / rolls back on exception, resets the contextvar.
- `one()/all()/run()` read `_current_conn`; if unset, acquire a transient pool connection.
- Nested `tx()` (contextvar already set) **joins** the existing transaction (no new one), exactly
  like the TS behavior. This preserves atomic multi-writes (e.g. approve = insert ticket +
  2 history rows) and the `asyncpg.UniqueViolationError` (Postgres `23505`) catch for idempotent
  approve.

### 6.2 Serialization parity — Pydantic `by_alias`
Pydantic v2 models with `populate_by_name=True` and field `alias` so DB `snake_case` ⇄ the
frontend's `camelCase`. Responses preserve the **named wrappers** the client unwraps
(`{"overview": …}`, `{"issue": …}`, `{"ticket": …}`, `{"airports": …}`, …) and the **exact
enum string values** (`fod`, `manual_review`, `dusk_lit`, …) which are persisted DB values and
must never change. Correctness is enforced by §8 parity tests, not by eye.

### 6.3 Error mapping — `route()` → exception handlers
An `AppError(message, status)` plus FastAPI exception handlers reproduce `http.ts`:
"not found" → 404, validation → 400 (and FastAPI's own 422 for body schema), asyncpg/internal
errors → 500 generic (never leak SQLSTATE/schema). Response body shape: `{"error": "..."}`,
matching the current routes.

### 6.4 Actor / auth — `actorFrom` ported verbatim (Phase 1)
`deps.actor_from(request, body)` mirrors `http.ts actorFrom` **exactly**: role from the
`x-actor-role` header **or** `body.actor.role`; otherwise `None`. **Behavioral note:** the
client (`lib/api.ts`) actually sends `x-strvx-role` (not `x-actor-role`) and carries the role in
`body.actor` for mutations, so in practice the body is the live signal and the header is usually
absent. Phase 1 **replicates this as-is** (no "fixing") for parity; the proxy forwards body +
headers unchanged. Real enforcement is Phase 2.

### 6.5 Config — `config.py`
Pydantic-settings reading the same env vars the frontend uses (`DATABASE_URL`, SSL flags,
`S3_*`, `ML_SERVICE_URL`, `ML_TIMEOUT_MS`, `RL_SERVICE_URL`, `ANTHROPIC_API_KEY`), plus `PORT`
(default 8080). The frontend gains one new var: `BACKEND_URL` (used by the proxy routes).

## 7. Migration sequence (each slice = one PR; app stays green)

0. **Plumbing.** Scaffold FastAPI + `db.py` + `config.py` + `GET /health` + one trivial read
   (`GET /drones`). Next `/api/drones` proxies to `BACKEND_URL`. Land the **parity-test harness**.
1. **Tickets.** `GET /tickets`, `GET /tickets/{id}`, `POST /tickets/{id}/repair`,
   `POST /tickets/{id}/close`. First tx + append-only history + `actor_from`. No S3/LLM/ml.
2. **Issues.** Review state machine (`approve`/`reject`/`manual_review`/`edit`) + draft diff +
   `draftEditDistance`. Word-level edit distance ported to match jsdiff output (parity-tested;
   `difflib`/`rapidfuzz` as needed).
3. **Reads / aggregation.** `getOverview`, inspections list/detail/run-now, runways/zones/users/
   schedules/airports CRUD.
4. **Reports.** `/inspections/{id}/report` returning **`HTMLResponse`** (`renderReportHtml` port)
   and JSON.
5. **Ingestion (last, most coupled).** `uploads` (multipart → `ml.detect` via httpx →
   `llm.draft` → `storage.put` via boto3 → `ingest`), `live-capture`, `feedback-export` (NDJSON).
   Drafting keeps the `rl/draft → Claude → template` fallback chain.
6. **Cleanup.** Delete migrated Next routes (or keep as a permanent thin BFF — decided then).

> The proxy Next routes are still Next.js code. Per `frontend/AGENTS.md` ("This is NOT the
> Next.js you know"), consult `node_modules/next/dist/docs/` before writing them.

## 8. Testing strategy (the rewrite's guardrail)

- **Contract-parity test per endpoint.** Given the same seeded DB, assert the backend's JSON
  response (status + body shape + values) equals the current Next route's response for the same
  request. This is what makes a Python rewrite safe instead of a drift hazard. Implemented by
  running both against a shared seeded Postgres (or fixtures captured from the Next routes).
- **Unit tests** on the state machines: approve idempotency, reject-requires-reason,
  edit-blocked-after-decision, repair/close transitions, ticket-number sequence.
- **Transaction atomicity test:** a forced failure mid-`approve` rolls back the ticket **and**
  the history rows together (nothing partially written).
- Tests follow the repo's testing rules (deterministic, mocked external services: S3, ml-service,
  Anthropic).

## 9. Risks & how they're handled

| Risk | Handling |
|---|---|
| Behavioral drift from TS→Python rewrite | Per-route parity tests (§8) are mandatory before a slice lands. |
| `AsyncLocalStorage` tx semantics | Ported to contextvar + tested for nested-join + atomic rollback (§6.1). |
| Serialization mismatch (snake vs camel, wrappers, enums) | Pydantic `by_alias` + parity tests (§6.2). |
| Uploads coupling (multipart + S3 + ml + LLM) | Migrated **last**, in isolation, after the pattern is proven. |
| `live-capture` / `feedback-export` are external (ml-service) contracts | Proxy keeps their URLs stable; parity tests cover their bodies. |
| Two writers on one DB during migration | Only one service owns each route group at a time (proxy forwards), so there's no concurrent dual-write to the same domain. Schema frozen. |
| Serverless assumptions in `db.ts` (pool size 1, globalThis caches) | Re-derived for a long-lived process: a normal asyncpg pool; revisit SSL/pool config for the new target rather than copying blindly. |

## 10. Contract that must be preserved (inventory)

**Client functions (`lib/api.ts`) → routes** (URLs/methods/payloads unchanged):
Reads — `getOverview`, `getInspection`, `getReport`, `getRunway`, `listZones`, `getIssue`,
`getTicket`, `listTickets`, `listDrones`, `listUsers`.
Mutations (carry `{actor:{role}}`) — `runInspectionNow`, `approveIssue`, `rejectIssue(reason, note?)`,
`manualReviewIssue`, `editIssue(patch)`, `createZone`, `createAirport`, `updateAirport`,
`createRunway`, `createSchedule`, `repairTicket`, `closeTicket`.
Media/export — `uploadImage` (multipart), `exportFeedbackJsonl` (plain-text NDJSON).
Routes wrap payloads in named keys the client unwraps.

**Domain types (`lib/types.ts`)** — keystone `IssueCandidate` (every field consumed by the UI:
`aiDraftText` immutable vs `draft` editable, `confidenceBand`, `severityModel` vs `severity`,
`draftEditDistance`, `ticketId`). Entities: `Airport, Runway, Zone, Inspection, InspectionJob,
Image, IssueCandidate, Ticket, User, Drone, InspectionSchedule`; composites `Overview /
RunwayOverview / IssueBreakdown, InspectionWithJobs, InspectionReport, RunwayWithIssues,
TicketDetail, UploadResult, ApproveResult`; history `IssueStatusHistory / TicketStatusHistory`.

**Enum values (persisted; immutable):** `IssueCategory[fod,pavement,marking,lighting]`,
`Severity[low,medium,high,critical]`, `IssueStatus[pending,approved,rejected,manual_review]`,
`TicketStatus`, `ConfidenceBand`, 7 × `RejectionReason`, `UserRole[admin,inspector,maintenance]`,
`InspectionWindow[daylight,dusk_lit]`, `GeomConfidence`. Helpers `bandFor()`/`severityFor()`
(≥0.85 high, ≥0.6 medium) are part of the contract.

**Invariants:** 1 ticket per issue (`UNIQUE(issue_id)`); append-only history; idempotent
`runInspectionNow`/`ingestUpload`; no auto-ticket (approval is the gate).

## 11. Success criteria (Phase 1)

1. `/backend` is a runnable FastAPI service (`run.sh`) serving all ~25 endpoints against the
   existing Postgres.
2. Every endpoint passes its contract-parity test vs the current Next route.
3. The frontend works unchanged — every `lib/api.ts` call still succeeds via the proxy.
4. `live_worker.py` and `rl/train.py` still function (their URLs unchanged).
5. State-machine + transaction unit tests pass.
6. `/backend/docs.md` documents the service.

## 12. Phase 2 preview (separate spec later)

Real auth/RBAC enforcement (the docs' permission model — 401/403/409/422), a scheduler that
materializes inspections on time, notifications/webhooks on ticket events, multi-airport — built
natively in the clean backend, with **Alembic owning the schema** from there on.

## 13. Out of scope (Phase 1)

- Changing any enum value, response shape, or URL.
- Enforcing auth (roles stay advisory, matching today).
- Reworking `/ml-service` or the RL loop.
- TS-client codegen / deleting `lib/api.ts` (it stays; proxy keeps it valid).
- Schema/DDL changes (frozen).
