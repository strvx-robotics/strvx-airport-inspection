# Backend Extraction — Issues Review Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the issue-candidate review domain (read + the approve/reject/manual-review/edit state machine + draft diff) and the now-unblocked ticket **detail** route off the Next.js API into the Python/FastAPI backend, each guarded by a contract-parity test.

**Architecture:** Continues the strangler migration from the foundation+tickets slice. Adds the `IssueCandidate` Pydantic model (+ nested `BBox`/`LngLat`), the `toIssue` mapper, issue reads, the review state machine (incl. `approveIssue` which creates a ticket from `ticket_seq` and writes append-only history), the draft-diff (jsdiff edit-distance ported via captured ground truth), and the issue + ticket-detail routes. Each Next route becomes a thin proxy.

**Tech Stack:** Python 3.13, FastAPI, asyncpg, Pydantic v2. Reuses the existing `app/db.py`, `app/serialize.py`, `app/errors.py`, `app/deps.py`, `app/repo/helpers.py`, `app/repo/tickets.py` from the prior slice.

## Global Constraints

- **Port:** backend 8080. **Datastore:** existing Postgres, schema frozen. [prior slice]
- **Serialization parity (mandatory):** `camelCase` field names (Pydantic `to_camel` alias), named wrappers, **null fields omitted** (`serialize.dump` = `by_alias=True, exclude_none=True`), **enum string values unchanged**. [spec §6.2]
- **Enum values (immutable):** `IssueCategory[fod,pavement,marking,lighting]`, `Severity[low,medium,high,critical]`, `IssueStatus[pending,approved,rejected,manual_review]`, `ConfidenceBand[high,medium,low]`, 7×`RejectionReason[not_an_issue,wrong_category,duplicate,not_actionable,below_threshold,image_unclear,already_known,other]`. [spec §10]
- **Faithful port** of `frontend/lib/repo.ts`: `approveIssue` idempotent (returns existing ticket if already approved; race-safe on `UNIQUE(issue_id)` catching SQLSTATE `23505`); `rejectIssue` requires a reason; `editIssue` blocked once approved/rejected; every transition appends to `issue_status_history`; transitions are atomic via `db.tx()`. [spec §2, §6.1]
- **Error contract:** `{"error": msg}`, 404 on `/not found/i`, else 400; internal → 500 generic. [spec §6.3]
- **Advisory actor:** `actor_from` (header `x-actor-role` or `body.actor.role`); proxies forward body verbatim + `x-strvx-role`→`x-actor-role`. [spec §6.4]
- **Test DB:** Docker Postgres at `TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5544/strvx_test` (container `strvx-test-pg`). Run pytest with that env set.
- **Next proxy caveat:** read `frontend/node_modules/next/dist/docs/` before editing proxy routes (per `frontend/AGENTS.md`). Each proxy carries `if (!BACKEND_URL) throw new Error("BACKEND_URL is not set")`.
- **Commit scope:** explicit `git add <paths>` only; never `git add -A`/`.`.

## File Structure

```
backend/app/
  models.py          # ADD: BBox, LngLat, IssueCandidate
  difftext.py        # NEW: word-diff + compute_draft_edit_distance (jsdiff port)
  repo/
    runways.py       # NEW: to_runway(), get_runway()
    issues.py        # NEW: ISSUE_SELECT, _to_issue, get_issue, list_issues_by_inspection,
                     #      approve_issue, reject_issue, manual_review_issue, edit_issue,
                     #      get_issue_draft_diff, _append_issue_history
    tickets.py       # MODIFY: add get_ticket_detail() (ticket + issue + runway)
  routers/
    issues.py        # NEW: GET /issues/{id}; POST approve/reject/manual-review/edit
    tickets.py       # MODIFY: add GET /tickets/{id}
backend/tests/
  test_difftext.py   # NEW: edit-distance ground-truth parity
  test_issues_repo.py     # NEW: state-machine units
  test_issues_api.py      # NEW: route parity
  test_ticket_detail.py   # NEW: GET /tickets/{id} parity
frontend/app/api/
  issues/[id]/route.ts, approve, reject, manual-review, edit   # MODIFY → proxy
  tickets/[id]/route.ts                                        # MODIFY → proxy
```

---

## Task 1: Runway read (to_runway + get_runway)

**Files:** Create `backend/app/repo/runways.py`; modify `backend/app/models.py` (add `Runway`); test `backend/tests/test_issues_repo.py` (shared file, runway helper used later).

**Interfaces:**
- Produces `app.models.Runway` (fields: id, airport_id, name, designation, length, description|None, length_m|None, threshold_heading_deg|None, threshold_lat|None, threshold_lng|None, active_status|None, created_at).
- `app.repo.runways.to_runway(r) -> Runway`, `get_runway(id) -> Runway | None` (`SELECT * FROM runways WHERE id = $1`).

- [ ] **Step 1: Add `Runway` to `backend/app/models.py`**

```python
class Runway(_Camel):
    id: str
    airport_id: str
    name: str
    designation: str
    length: str
    description: str | None = None
    length_m: float | None = None
    threshold_heading_deg: float | None = None
    threshold_lat: float | None = None
    threshold_lng: float | None = None
    active_status: str | None = None
    created_at: str
```

- [ ] **Step 2: Write `backend/app/repo/runways.py`**

```python
from app import db
from app.models import Runway


def to_runway(r) -> Runway:
    # Mirrors lib/repo.ts toRunway: length defaults "", the rest omit when NULL.
    return Runway(
        id=r["id"],
        airport_id=r["airport_id"],
        name=r["name"],
        designation=r["designation"],
        length=r["length"] if r["length"] is not None else "",
        description=r["description"],
        length_m=r["length_m"],
        threshold_heading_deg=r["threshold_heading_deg"],
        threshold_lat=r["threshold_lat"],
        threshold_lng=r["threshold_lng"],
        active_status=r["active_status"],
        created_at=r["created_at"],
    )


async def get_runway(id: str) -> Runway | None:
    r = await db.one("SELECT * FROM runways WHERE id = $1", id)
    return to_runway(r) if r else None
```

- [ ] **Step 3: Write the failing test** `backend/tests/test_issues_repo.py` (start the file)

```python
import pytest

from app import db
from app.repo import runways


@pytest.mark.asyncio
async def test_get_runway(seed):
    await seed.execute(
        "INSERT INTO runways (id, airport_id, name, designation, length, created_at) "
        "VALUES ('r1','ags','Runway 1','17 - 35','8,001 ft','2026-06-22T06:30:00.000Z')"
    )
    await db.connect()
    try:
        rw = await runways.get_runway("r1")
        assert rw is not None and rw.name == "Runway 1" and rw.designation == "17 - 35"
        assert rw.length == "8,001 ft"
    finally:
        await db.disconnect()
```

- [ ] **Step 4: Run** `TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5544/strvx_test .venv/bin/pytest tests/test_issues_repo.py -v` → PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/models.py backend/app/repo/runways.py backend/tests/test_issues_repo.py
git commit -m "feat(backend): runway read (to_runway + get_runway)"
```

---

## Task 2: IssueCandidate model + BBox/LngLat

**Files:** Modify `backend/app/models.py`.

**Interfaces:** Produces `app.models.BBox` (x,y,w,h: float), `app.models.LngLat` (lat,lng: float), `app.models.IssueCandidate` (all fields from `lib/types.ts IssueCandidate`, snake_case + camelCase alias; optional ones default `None`).

- [ ] **Step 1: Add models to `backend/app/models.py`**

```python
class BBox(_Camel):
    x: float
    y: float
    w: float
    h: float


class LngLat(_Camel):
    lat: float
    lng: float


class IssueCandidate(_Camel):
    id: str
    inspection_id: str
    runway_id: str
    zone_id: str | None = None
    image_id: str | None = None
    image_url: str | None = None
    category: str            # DB column issue_type
    zone: str | None = None
    confidence: float
    confidence_band: str
    severity: str
    severity_model: str | None = None
    status: str
    bbox: BBox
    gps: LngLat | None = None
    station_m: float | None = None
    lateral_offset_m: float | None = None
    size_m: float | None = None
    ai_draft_text: str
    draft: str
    inspector_notes: str
    model_notes: str | None = None
    rejection_reason: str | None = None
    rejection_note: str | None = None
    draft_edit_distance: int | None = None
    ticket_id: str | None = None
    created_by: str | None = None
    created_at: str
```

> Note: `category` serializes to `category` (the frontend field), even though the DB column is `issue_type` — the mapper (Task 3) reads `issue_type` into `category`.

- [ ] **Step 2: Quick import check**

Run: `.venv/bin/python -c "from app.models import IssueCandidate, BBox, LngLat; print('ok')"`
Expected: `ok`.

- [ ] **Step 3: Commit**

```bash
git add backend/app/models.py
git commit -m "feat(backend): IssueCandidate model (+ BBox, LngLat)"
```

---

## Task 3: Issue read mapper + get_issue + parity

**Files:** Create `backend/app/repo/issues.py`; test `backend/tests/test_issues_repo.py` (append).

**Interfaces:**
- `app.repo.issues.ISSUE_SELECT` (str), `_to_issue(r) -> IssueCandidate`, `get_issue(id) -> IssueCandidate | None`, `list_issues_by_inspection(inspection_id) -> list[IssueCandidate]`.

- [ ] **Step 1: Write `backend/app/repo/issues.py` (reads only for now)**

```python
import json

from app import db
from app.models import BBox, IssueCandidate, LngLat

# Mirrors lib/repo.ts ISSUE_SELECT (joins zone name + image url).
ISSUE_SELECT = (
    "SELECT ic.*, z.name AS zone_name, im.file_url AS image_url "
    "FROM issue_candidates ic "
    "LEFT JOIN zones z ON z.id = ic.zone_id "
    "LEFT JOIN images im ON im.id = ic.image_id"
)


def _gps(lat, lng) -> LngLat | None:
    if lat is None or lng is None:
        return None
    return LngLat(lat=lat, lng=lng)


def _to_issue(r) -> IssueCandidate:
    # Mirrors lib/repo.ts toIssue exactly.
    return IssueCandidate(
        id=r["id"],
        inspection_id=r["inspection_id"] if r["inspection_id"] is not None else "",
        runway_id=r["runway_id"],
        zone_id=r["zone_id"],
        image_id=r["image_id"],
        image_url=r["image_url"],
        category=r["issue_type"],
        zone=r["zone_name"],
        confidence=r["confidence"],
        confidence_band=r["confidence_band"],
        severity=r["severity"],
        severity_model=r["severity_model"],
        status=r["status"],
        bbox=BBox(**json.loads(r["bbox_json"])),
        gps=_gps(r["gps_lat"], r["gps_lng"]),
        station_m=r["station_m"],
        lateral_offset_m=r["lateral_offset_m"],
        size_m=r["size_m"],
        ai_draft_text=r["ai_draft_text"],
        draft=r["draft"],
        inspector_notes=r["inspector_notes"],
        model_notes=r["model_notes"],
        rejection_reason=r["rejection_reason"],
        rejection_note=r["rejection_note"],
        draft_edit_distance=r["draft_edit_distance"],
        ticket_id=r["ticket_id"],
        created_by=r["created_by"],
        created_at=r["created_at"],
    )


async def get_issue(id: str) -> IssueCandidate | None:
    r = await db.one(f"{ISSUE_SELECT} WHERE ic.id = $1", id)
    return _to_issue(r) if r else None


async def list_issues_by_inspection(inspection_id: str) -> list[IssueCandidate]:
    rows = await db.all(f"{ISSUE_SELECT} WHERE ic.inspection_id = $1 ORDER BY ic.confidence DESC", inspection_id)
    return [_to_issue(r) for r in rows]
```

- [ ] **Step 2: Add a shared seed helper + parity test to `backend/tests/test_issues_repo.py`**

```python
from app.repo import issues as issues_repo


async def seed_issue(conn, *, id="ic1", status="pending", zone_id=None, image_id=None,
                     draft="Repair the spall.", ai="Repair spall in pavement."):
    await conn.execute(
        "INSERT INTO runways (id, airport_id, name, designation, length, created_at) "
        "VALUES ('r1','ags','Runway 1','17 - 35','8,001 ft','2026-06-22T06:30:00.000Z') ON CONFLICT DO NOTHING"
    )
    await conn.execute(
        "INSERT INTO inspections (id, airport_id, scheduled_time, \"window\", status, created_at) "
        "VALUES ('insp1','ags','2026-06-22T06:00:00.000Z','daylight','needs_review','2026-06-22T06:30:00.000Z') "
        "ON CONFLICT DO NOTHING"
    )
    await conn.execute(
        "INSERT INTO issue_candidates "
        "(id, inspection_id, runway_id, zone_id, image_id, issue_type, confidence, confidence_band, "
        " severity, severity_model, status, bbox_json, ai_draft_text, draft, inspector_notes, created_at) "
        "VALUES ($1,'insp1','r1',$2,$3,'pavement',0.9,'high','high','high',$4,"
        "'{\"x\":10,\"y\":20,\"w\":5,\"h\":5}',$5,$6,'',$7)",
        id, zone_id, image_id, status, ai, draft, "2026-06-22T06:30:00.000Z",
    )


@pytest.mark.asyncio
async def test_get_issue_parity(seed):
    await seed_issue(seed)
    await db.connect()
    try:
        i = await issues_repo.get_issue("ic1")
        assert i is not None
        from app.serialize import dump
        d = dump(i)
        # camelCase, bbox nested, null fields (zoneId/imageId/gps/...) omitted.
        assert d["id"] == "ic1"
        assert d["category"] == "pavement"
        assert d["confidenceBand"] == "high"
        assert d["bbox"] == {"x": 10.0, "y": 20.0, "w": 5.0, "h": 5.0}
        assert d["aiDraftText"] == "Repair spall in pavement."
        assert d["draft"] == "Repair the spall."
        assert "zoneId" not in d and "gps" not in d and "ticketId" not in d
        assert d["inspectorNotes"] == ""
    finally:
        await db.disconnect()
```

- [ ] **Step 3: Run** the issues-repo tests (`pytest tests/test_issues_repo.py -v`, with the TEST_DATABASE_URL env) → PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/app/repo/issues.py backend/tests/test_issues_repo.py
git commit -m "feat(backend): issue read mapper + get_issue with parity"
```

---

## Task 4: Draft edit-distance (jsdiff port) — PARITY-CRITICAL

**Files:** Create `backend/app/difftext.py`, `backend/tests/test_difftext.py`.

**Background:** the frontend computes `draftEditDistance` via jsdiff `diffWords(ai, final)`, summing `len(value)` over added/removed parts. We must reproduce that integer for the same inputs (it is stored on approve and asserted in parity). Strategy: tokenize like jsdiff (split on word boundaries, keeping whitespace tokens), diff token sequences, and sum changed-token lengths. **Validate against ground truth captured from the real jsdiff.**

**Interfaces:** Produces `app.difftext.diff_words(a, b) -> list[dict]` (each `{"value": str, "added": bool, "removed": bool}`) and `app.difftext.compute_draft_edit_distance(ai, final) -> int`.

- [ ] **Step 1: Capture jsdiff ground truth (run in the frontend)**

Run this from `frontend/` to print the authoritative numbers + parts for the test cases:

```bash
cd frontend && node -e '
const {diffWords} = require("diff");
const cases = [
  ["Repair spall in pavement.", "Repair the spall."],
  ["FOD on runway", "FOD on runway"],
  ["", "New text here"],
  ["Crack near centerline marking", "Crack near the centerline marking; reseal"],
];
for (const [a,b] of cases) {
  const parts = diffWords(a,b);
  const ed = parts.reduce((s,p)=> (p.added||p.removed)? s+p.value.length : s, 0);
  console.log(JSON.stringify({a,b,ed,parts: parts.map(p=>({value:p.value,added:!!p.added,removed:!!p.removed}))}));
}
'
```
Record the printed `ed` (and `parts`) for each case — these become the expected values in Step 3. (If `diff` is not resolvable from `frontend/`, run from the dir that has it in `node_modules`.)

- [ ] **Step 2: Write `backend/app/difftext.py`**

```python
import re
from difflib import SequenceMatcher

# jsdiff diffWords tokenizes on word boundaries, keeping whitespace runs as tokens.
_TOKEN = re.compile(r"\s+|\w+|[^\s\w]+")


def _tokens(text: str) -> list[str]:
    return _TOKEN.findall(text)


def diff_words(a: str, b: str) -> list[dict]:
    """Word-level diff returning ordered {value, added, removed} parts.
    Removed (a-only) parts precede added (b-only) parts within a change, matching jsdiff."""
    ta, tb = _tokens(a), _tokens(b)
    parts: list[dict] = []
    for op, i1, i2, j1, j2 in SequenceMatcher(a=ta, b=tb, autojunk=False).get_opcodes():
        if op == "equal":
            parts.append({"value": "".join(ta[i1:i2]), "added": False, "removed": False})
        elif op == "delete":
            parts.append({"value": "".join(ta[i1:i2]), "added": False, "removed": True})
        elif op == "insert":
            parts.append({"value": "".join(tb[j1:j2]), "added": True, "removed": False})
        elif op == "replace":
            parts.append({"value": "".join(ta[i1:i2]), "added": False, "removed": True})
            parts.append({"value": "".join(tb[j1:j2]), "added": True, "removed": False})
    return parts


def compute_draft_edit_distance(ai: str, final: str) -> int:
    return sum(len(p["value"]) for p in diff_words(ai, final) if p["added"] or p["removed"])
```

- [ ] **Step 3: Write `backend/tests/test_difftext.py` using the captured ground truth**

```python
from app.difftext import compute_draft_edit_distance

# Expected edit distances captured from jsdiff diffWords (Task 4 Step 1).
# Fill EACH expected value from the node output before running.
GROUND_TRUTH = [
    ("Repair spall in pavement.", "Repair the spall.", None),   # ← replace None with captured ed
    ("FOD on runway", "FOD on runway", 0),
    ("", "New text here", None),                                 # ← captured ed
    ("Crack near centerline marking", "Crack near the centerline marking; reseal", None),  # ← captured ed
]


def test_edit_distance_matches_jsdiff():
    for ai, final, expected in GROUND_TRUTH:
        assert expected is not None, "fill expected from jsdiff ground truth (Step 1)"
        assert compute_draft_edit_distance(ai, final) == expected, (ai, final)


def test_identical_text_is_zero():
    assert compute_draft_edit_distance("same words", "same words") == 0
```

- [ ] **Step 4: Run** `.venv/bin/pytest tests/test_difftext.py -v`. If any case mismatches jsdiff, adjust `_TOKEN`/opcode handling until all captured values match. **Do not change the expected values to match the code** — the code must match jsdiff. If exact parity proves infeasible for a case after reasonable effort, STOP and report it (DONE_WITH_CONCERNS) with the diff between your output and jsdiff's — the controller decides.

- [ ] **Step 5: Commit**

```bash
git add backend/app/difftext.py backend/tests/test_difftext.py
git commit -m "feat(backend): draft edit-distance word-diff (jsdiff parity)"
```

---

## Task 5: approve_issue (ticket creation + history + idempotency)

**Files:** Modify `backend/app/repo/issues.py` (add history helper + approve); test `backend/tests/test_issues_repo.py`.

**Interfaces:**
- `app.repo.issues._append_issue_history(issue_id, action, *, from_status=None, to_status=None, from_category=None, to_category=None, reason=None, reason_note=None, note=None, actor=None)`.
- `app.repo.issues.approve_issue(id, actor) -> tuple[IssueCandidate, Ticket]` (raises `AppError` if not found; idempotent; race-safe).

- [ ] **Step 1: Add to `backend/app/repo/issues.py`**

```python
import asyncpg

from app.deps import Actor
from app.errors import AppError
from app.models import Ticket
from app.repo.helpers import actor_name, actor_role, gid, now
from app.repo.tickets import get_ticket
from app.difftext import compute_draft_edit_distance


async def _append_issue_history(issue_id, action, *, from_status=None, to_status=None,
                                from_category=None, to_category=None, reason=None,
                                reason_note=None, note=None, actor=None):
    await db.run(
        "INSERT INTO issue_status_history "
        "(id, issue_id, action, from_status, to_status, from_category, to_category, "
        " reason, reason_note, note, actor, actor_role, ts) "
        "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
        gid("ish"), issue_id, action, from_status, to_status, from_category, to_category,
        reason, reason_note, note, await actor_name(actor), actor_role(actor), now(),
    )


async def _user_name_by_role(role: str) -> str | None:
    r = await db.one("SELECT name FROM users WHERE role = $1 LIMIT 1", role)
    return r["name"] if r else None


async def approve_issue(id: str, actor: Actor | None) -> tuple[IssueCandidate, Ticket]:
    issue = await get_issue(id)
    if issue is None:
        raise AppError(f"Issue not found: {id}")
    if issue.status == "approved" and issue.ticket_id:
        existing = await get_ticket(issue.ticket_id)
        if existing:
            return issue, existing

    edit_distance = compute_draft_edit_distance(issue.ai_draft_text, issue.draft)
    assigned_to = (await _user_name_by_role("maintenance")) or "Field Maintenance"
    created_by = await actor_name(actor)
    ts = now()
    try:
        async with db.tx():
            seq = await db.one("SELECT 'WO-' || nextval('ticket_seq') AS id")
            tid = seq["id"]
            await db.run(
                "INSERT INTO tickets (id, issue_id, runway_id, zone_id, zone, category, status, "
                " description, severity, assigned_to, created_by, maintenance_notes, created_at) "
                "VALUES ($1,$2,$3,$4,$5,$6,'sent',$7,$8,$9,$10,'',$11)",
                tid, issue.id, issue.runway_id, issue.zone_id, issue.zone or "",
                issue.category, issue.draft, issue.severity, assigned_to, created_by, ts,
            )
            await db.run(
                "UPDATE issue_candidates SET status = 'approved', ticket_id = $1, draft_edit_distance = $2 WHERE id = $3",
                tid, edit_distance, id,
            )
            await _append_issue_history(
                id, "approve", from_status=issue.status, to_status="approved",
                note=f"Created ticket {tid} (edit distance {edit_distance})", actor=actor,
            )
            # ticket "create" history (mirror appendTicketHistory)
            from app.repo.tickets import _append_ticket_history
            await _append_ticket_history(tid, "create", None, "sent", "Approved & sent to maintenance", actor)
    except asyncpg.UniqueViolationError:
        fresh = await get_issue(id)
        ticket = await get_ticket(fresh.ticket_id) if fresh and fresh.ticket_id else None
        if fresh and ticket:
            return fresh, ticket
        raise
    issue2 = await get_issue(id)
    ticket2 = await get_ticket(tid)
    assert issue2 is not None and ticket2 is not None
    return issue2, ticket2
```

> The `assert` here is a "can't happen" guard; if you prefer, raise `AppError` like the tickets repo does. Keep consistent with `repo/tickets.py`.

- [ ] **Step 2: Write the failing tests** (`backend/tests/test_issues_repo.py`)

```python
from app.repo import issues as issues_repo
from app.deps import Actor
from app.errors import AppError


@pytest.mark.asyncio
async def test_approve_creates_ticket_and_history(seed):
    await seed_issue(seed, draft="Reseal the centerline.", ai="Reseal centerline marking.")
    await db.connect()
    try:
        issue, ticket = await issues_repo.approve_issue("ic1", Actor(role="inspector"))
        assert issue.status == "approved" and issue.ticket_id == ticket.id
        assert ticket.id.startswith("WO-") and ticket.status == "sent"
        assert ticket.description == "Reseal the centerline."  # final draft, not ai
        assert issue.draft_edit_distance is not None and issue.draft_edit_distance >= 0
        ih = await db.one("SELECT action, to_status FROM issue_status_history WHERE issue_id='ic1' AND action='approve'")
        assert ih["to_status"] == "approved"
        th = await db.one("SELECT action FROM ticket_status_history WHERE ticket_id=$1", ticket.id)
        assert th["action"] == "create"
    finally:
        await db.disconnect()


@pytest.mark.asyncio
async def test_approve_is_idempotent(seed):
    await seed_issue(seed)
    await db.connect()
    try:
        _, t1 = await issues_repo.approve_issue("ic1", Actor(role="inspector"))
        _, t2 = await issues_repo.approve_issue("ic1", Actor(role="inspector"))
        assert t1.id == t2.id  # no second ticket
        n = await db.one("SELECT count(*) AS c FROM tickets WHERE issue_id='ic1'")
        assert n["c"] == 1
    finally:
        await db.disconnect()


@pytest.mark.asyncio
async def test_approve_missing_raises(seed):
    await db.connect()
    try:
        with pytest.raises(AppError, match="Issue not found"):
            await issues_repo.approve_issue("nope", None)
    finally:
        await db.disconnect()
```

- [ ] **Step 3: Run** the issues-repo tests → PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/app/repo/issues.py backend/tests/test_issues_repo.py
git commit -m "feat(backend): approve_issue (ticket creation + history + idempotency)"
```

---

## Task 6: reject / manual_review / edit + draft diff

**Files:** Modify `backend/app/repo/issues.py`; test `backend/tests/test_issues_repo.py`.

**Interfaces:**
- `reject_issue(id, reason, note, actor) -> IssueCandidate` (raises `AppError("A rejection reason is required")` if no reason; `AppError("Issue not found: ...")`).
- `manual_review_issue(id, actor) -> IssueCandidate`.
- `edit_issue(id, patch: dict, actor) -> IssueCandidate` (`AppError("Cannot edit a {status} issue")` if approved/rejected; records category change).
- `get_issue_draft_diff(id) -> dict | None` (`{aiDraftText, draft, finalText, parts, editDistance}`).

- [ ] **Step 1: Add to `backend/app/repo/issues.py`**

```python
from app.difftext import diff_words


async def reject_issue(id: str, reason: str | None, note: str | None, actor: Actor | None) -> IssueCandidate:
    issue = await get_issue(id)
    if issue is None:
        raise AppError(f"Issue not found: {id}")
    if not reason:
        raise AppError("A rejection reason is required")
    async with db.tx():
        await db.run(
            "UPDATE issue_candidates SET status='rejected', rejection_reason=$1, rejection_note=$2 WHERE id=$3",
            reason, note, id,
        )
        await _append_issue_history(
            id, "reject", from_status=issue.status, to_status="rejected",
            reason=reason, reason_note=note, note="Rejected candidate", actor=actor,
        )
    result = await get_issue(id)
    assert result is not None
    return result


async def manual_review_issue(id: str, actor: Actor | None) -> IssueCandidate:
    issue = await get_issue(id)
    if issue is None:
        raise AppError(f"Issue not found: {id}")
    async with db.tx():
        await db.run("UPDATE issue_candidates SET status='manual_review' WHERE id=$1", id)
        await _append_issue_history(
            id, "manual_review", from_status=issue.status, to_status="manual_review",
            note="Flagged for manual inspection", actor=actor,
        )
    result = await get_issue(id)
    assert result is not None
    return result


async def edit_issue(id: str, patch: dict, actor: Actor | None) -> IssueCandidate:
    issue = await get_issue(id)
    if issue is None:
        raise AppError(f"Issue not found: {id}")
    if issue.status in ("approved", "rejected"):
        raise AppError(f"Cannot edit a {issue.status} issue")
    category = patch.get("category") or issue.category
    severity = patch.get("severity") or issue.severity
    draft = patch["draft"] if patch.get("draft") is not None else issue.draft
    inspector_notes = patch["notes"] if patch.get("notes") is not None else issue.inspector_notes
    category_changed = patch.get("category") is not None and patch["category"] != issue.category
    async with db.tx():
        await db.run(
            "UPDATE issue_candidates SET issue_type=$1, severity=$2, draft=$3, inspector_notes=$4 WHERE id=$5",
            category, severity, draft, inspector_notes, id,
        )
        await _append_issue_history(
            id, "edit", from_status=issue.status, to_status=issue.status,
            from_category=issue.category if category_changed else None,
            to_category=category if category_changed else None,
            note=(f"Recategorized {issue.category} → {category}" if category_changed else "Edited candidate"),
            actor=actor,
        )
    result = await get_issue(id)
    assert result is not None
    return result


async def get_issue_draft_diff(id: str) -> dict | None:
    issue = await get_issue(id)
    if issue is None:
        return None
    final_text = issue.draft
    if issue.ticket_id:
        t = await get_ticket(issue.ticket_id)
        if t:
            final_text = t.description
    ed = issue.draft_edit_distance
    if ed is None:
        ed = compute_draft_edit_distance(issue.ai_draft_text, final_text)
    return {
        "aiDraftText": issue.ai_draft_text,
        "draft": issue.draft,
        "finalText": final_text,
        "parts": diff_words(issue.ai_draft_text, final_text),
        "editDistance": ed,
    }
```

- [ ] **Step 2: Write the failing tests** (append to `test_issues_repo.py`)

```python
@pytest.mark.asyncio
async def test_reject_requires_reason(seed):
    await seed_issue(seed)
    await db.connect()
    try:
        with pytest.raises(AppError, match="rejection reason is required"):
            await issues_repo.reject_issue("ic1", None, None, Actor(role="inspector"))
        i = await issues_repo.reject_issue("ic1", "duplicate", "dupe of ic0", Actor(role="inspector"))
        assert i.status == "rejected" and i.rejection_reason == "duplicate" and i.rejection_note == "dupe of ic0"
    finally:
        await db.disconnect()


@pytest.mark.asyncio
async def test_manual_review(seed):
    await seed_issue(seed)
    await db.connect()
    try:
        i = await issues_repo.manual_review_issue("ic1", Actor(role="inspector"))
        assert i.status == "manual_review"
    finally:
        await db.disconnect()


@pytest.mark.asyncio
async def test_edit_records_category_change_and_blocks_after_decision(seed):
    await seed_issue(seed)
    await db.connect()
    try:
        i = await issues_repo.edit_issue("ic1", {"category": "marking", "draft": "New draft"}, Actor(role="inspector"))
        assert i.category == "marking" and i.draft == "New draft"
        h = await db.one("SELECT from_category, to_category FROM issue_status_history WHERE issue_id='ic1' AND action='edit'")
        assert h["from_category"] == "pavement" and h["to_category"] == "marking"
        await issues_repo.reject_issue("ic1", "not_an_issue", None, Actor(role="inspector"))
        with pytest.raises(AppError, match="Cannot edit a rejected issue"):
            await issues_repo.edit_issue("ic1", {"draft": "x"}, Actor(role="inspector"))
    finally:
        await db.disconnect()


@pytest.mark.asyncio
async def test_draft_diff_shape(seed):
    await seed_issue(seed, ai="Repair spall in pavement.", draft="Repair the spall.")
    await db.connect()
    try:
        d = await issues_repo.get_issue_draft_diff("ic1")
        assert d["aiDraftText"] == "Repair spall in pavement."
        assert d["finalText"] == "Repair the spall."
        assert isinstance(d["parts"], list) and all({"value", "added", "removed"} <= set(p) for p in d["parts"])
        assert isinstance(d["editDistance"], int)
    finally:
        await db.disconnect()
```

- [ ] **Step 3: Run** the issues-repo tests → PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/app/repo/issues.py backend/tests/test_issues_repo.py
git commit -m "feat(backend): reject/manual-review/edit + draft diff"
```

---

## Task 7: Issue API routes + parity

**Files:** Create `backend/app/routers/issues.py`; modify `backend/app/main.py`; test `backend/tests/test_issues_api.py`.

**Interfaces (routes):**
- `GET /issues/{id}` → `{"issue": <issue>, "diff": <diff>|null}`
- `POST /issues/{id}/approve` (body `{actor?}`) → `{"issue": <issue>, "ticket": <ticket>, "ticketId": <id>}`
- `POST /issues/{id}/reject` (body `{reason, note?, actor?}`) → `{"issue": <issue>}` (400 if reason missing/invalid)
- `POST /issues/{id}/manual-review` (body `{actor?}`) → `{"issue": <issue>}`
- `POST /issues/{id}/edit` (body `{category?, severity?, draft?, notes?, actor?}`) → `{"issue": <issue>, "diff": <diff>}`

- [ ] **Step 1: Write `backend/app/routers/issues.py`**

```python
from fastapi import APIRouter, Request

from app.deps import actor_from
from app.errors import AppError
from app.repo import issues as repo
from app.serialize import dump

router = APIRouter()

VALID_REASONS = {
    "not_an_issue", "wrong_category", "duplicate", "not_actionable",
    "below_threshold", "image_unclear", "already_known", "other",
}


async def _json(request: Request) -> dict:
    try:
        data = await request.json()
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


@router.get("/issues/{id}")
async def get_issue(id: str) -> dict:
    issue = await repo.get_issue(id)
    if issue is None:
        raise AppError(f"Issue not found: {id}")
    return {"issue": dump(issue), "diff": await repo.get_issue_draft_diff(id)}


@router.post("/issues/{id}/approve")
async def approve(id: str, request: Request) -> dict:
    body = await _json(request)
    issue, ticket = await repo.approve_issue(id, actor_from(request, body))
    return {"issue": dump(issue), "ticket": dump(ticket), "ticketId": ticket.id}


@router.post("/issues/{id}/reject")
async def reject(id: str, request: Request) -> dict:
    body = await _json(request)
    reason = body.get("reason")
    if reason not in VALID_REASONS:
        raise AppError("A valid rejection reason is required")
    issue = await repo.reject_issue(id, reason, body.get("note"), actor_from(request, body))
    return {"issue": dump(issue)}


@router.post("/issues/{id}/manual-review")
async def manual_review(id: str, request: Request) -> dict:
    body = await _json(request)
    issue = await repo.manual_review_issue(id, actor_from(request, body))
    return {"issue": dump(issue)}


@router.post("/issues/{id}/edit")
async def edit(id: str, request: Request) -> dict:
    body = await _json(request)
    patch = {k: body.get(k) for k in ("category", "severity", "draft", "notes")}
    issue = await repo.edit_issue(id, patch, actor_from(request, body))
    return {"issue": dump(issue), "diff": await repo.get_issue_draft_diff(id)}
```

- [ ] **Step 2: Mount in `backend/app/main.py`**

```python
from app.routers import issues as issues_router

app.include_router(issues_router.router)
```

- [ ] **Step 3: Write `backend/tests/test_issues_api.py`** (reuse `seed_issue` by importing from the repo test module, or duplicate the helper)

```python
import pytest

from tests.test_issues_repo import seed_issue


@pytest.mark.asyncio
async def test_get_issue_route(seed, client):
    await seed_issue(seed)
    res = await client.get("/issues/ic1")
    assert res.status_code == 200
    body = res.json()
    assert body["issue"]["id"] == "ic1"
    assert body["issue"]["category"] == "pavement"
    assert "diff" in body and body["diff"]["aiDraftText"] == "Repair spall in pavement."


@pytest.mark.asyncio
async def test_get_issue_missing_404(seed, client):
    res = await client.get("/issues/nope")
    assert res.status_code == 404
    assert res.json()["error"].startswith("Issue not found")


@pytest.mark.asyncio
async def test_approve_route(seed, client):
    await seed_issue(seed)
    res = await client.post("/issues/ic1/approve", json={"actor": {"role": "inspector"}})
    assert res.status_code == 200
    body = res.json()
    assert body["issue"]["status"] == "approved"
    assert body["ticket"]["status"] == "sent"
    assert body["ticketId"] == body["ticket"]["id"]


@pytest.mark.asyncio
async def test_reject_requires_valid_reason_400(seed, client):
    await seed_issue(seed)
    res = await client.post("/issues/ic1/reject", json={"reason": "bogus", "actor": {"role": "inspector"}})
    assert res.status_code == 400
    assert res.json() == {"error": "A valid rejection reason is required"}


@pytest.mark.asyncio
async def test_edit_route_returns_diff(seed, client):
    await seed_issue(seed)
    res = await client.post("/issues/ic1/edit", json={"draft": "Edited text", "actor": {"role": "inspector"}})
    assert res.status_code == 200
    body = res.json()
    assert body["issue"]["draft"] == "Edited text"
    assert "diff" in body
```

- [ ] **Step 4: Run** `pytest tests/test_issues_api.py -v` (with env) → PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/issues.py backend/app/main.py backend/tests/test_issues_api.py
git commit -m "feat(backend): issue API routes (get/approve/reject/manual-review/edit)"
```

---

## Task 8: Ticket detail route (now unblocked)

**Files:** Modify `backend/app/repo/tickets.py` (add `get_ticket_detail`); modify `backend/app/routers/tickets.py` (add `GET /tickets/{id}`); test `backend/tests/test_ticket_detail.py`.

**Interfaces:** `app.repo.tickets.get_ticket_detail(id) -> dict | None` = `{"ticket": Ticket, "issue": IssueCandidate|None, "runway": Runway|None}`; route `GET /tickets/{id}` → `{"ticket": ..., "issue": ...|omitted, "runway": ...|omitted}`.

- [ ] **Step 1: Add `get_ticket_detail` to `backend/app/repo/tickets.py`**

```python
async def get_ticket_detail(id: str):
    from app.repo.issues import get_issue
    from app.repo.runways import get_runway
    ticket = await get_ticket(id)
    if ticket is None:
        return None
    return {
        "ticket": ticket,
        "issue": await get_issue(ticket.issue_id),
        "runway": await get_runway(ticket.runway_id),
    }
```

- [ ] **Step 2: Add the route to `backend/app/routers/tickets.py`**

```python
from app.errors import AppError


@router.get("/tickets/{id}")
async def get_ticket_detail_route(id: str) -> dict:
    detail = await repo.get_ticket_detail(id)
    if detail is None:
        raise AppError(f"Ticket not found: {id}")
    out = {"ticket": dump(detail["ticket"])}
    if detail["issue"] is not None:
        out["issue"] = dump(detail["issue"])
    if detail["runway"] is not None:
        out["runway"] = dump(detail["runway"])
    return out
```

> Place this route AFTER the existing `GET /tickets` (FastAPI matches `/tickets` and `/tickets/{id}` distinctly, so order is not strictly required, but keep list-then-detail for readability).

- [ ] **Step 3: Write `backend/tests/test_ticket_detail.py`**

```python
import pytest

from tests.test_issues_repo import seed_issue


@pytest.mark.asyncio
async def test_ticket_detail_includes_issue_and_runway(seed, client):
    await seed_issue(seed)
    # approve to create a ticket
    ap = await client.post("/issues/ic1/approve", json={"actor": {"role": "inspector"}})
    wo = ap.json()["ticket"]["id"]
    res = await client.get(f"/tickets/{wo}")
    assert res.status_code == 200
    body = res.json()
    assert body["ticket"]["id"] == wo
    assert body["issue"]["id"] == "ic1"
    assert body["runway"]["id"] == "r1"


@pytest.mark.asyncio
async def test_ticket_detail_missing_404(seed, client):
    res = await client.get("/tickets/WO-0000")
    assert res.status_code == 404
    assert res.json()["error"].startswith("Ticket not found")
```

- [ ] **Step 4: Run** `pytest tests/test_ticket_detail.py -v` (with env) → PASS, then the FULL suite once → all green.

- [ ] **Step 5: Commit**

```bash
git add backend/app/repo/tickets.py backend/app/routers/tickets.py backend/tests/test_ticket_detail.py
git commit -m "feat(backend): ticket detail route (ticket + issue + runway)"
```

---

## Task 9: Proxy the issue + ticket-detail routes

**Files:** Modify the 5 issue route files + `frontend/app/api/tickets/[id]/route.ts`.

- [ ] **Step 1: Re-read the Next route-handler doc** (`frontend/AGENTS.md`): `ls frontend/node_modules/next/dist/docs/`.

- [ ] **Step 2: Replace `frontend/app/api/issues/[id]/route.ts`** (GET proxy)

```typescript
// GET /api/issues/[id] — proxied to the Python backend.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const BACKEND_URL = process.env.BACKEND_URL;
if (!BACKEND_URL) throw new Error("BACKEND_URL is not set");

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const res = await fetch(`${BACKEND_URL}/issues/${id}`, { cache: "no-store" });
  return new Response(await res.text(), {
    status: res.status,
    headers: { "content-type": "application/json" },
  });
}
```

- [ ] **Step 3: Replace each POST issue route** (`approve`, `reject`, `manual-review`, `edit`) with this shape, substituting the backend path segment (`approve` / `reject` / `manual-review` / `edit`):

```typescript
// POST /api/issues/[id]/<segment> — proxied to the Python backend.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const BACKEND_URL = process.env.BACKEND_URL;
if (!BACKEND_URL) throw new Error("BACKEND_URL is not set");

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const res = await fetch(`${BACKEND_URL}/issues/${id}/<segment>`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-actor-role": req.headers.get("x-strvx-role") ?? "",
    },
    body: await req.text(),
  });
  return new Response(await res.text(), {
    status: res.status,
    headers: { "content-type": "application/json" },
  });
}
```

- [ ] **Step 4: Replace `frontend/app/api/tickets/[id]/route.ts`** (GET detail proxy)

```typescript
// GET /api/tickets/[id] — proxied to the Python backend.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const BACKEND_URL = process.env.BACKEND_URL;
if (!BACKEND_URL) throw new Error("BACKEND_URL is not set");

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const res = await fetch(`${BACKEND_URL}/tickets/${id}`, { cache: "no-store" });
  return new Response(await res.text(), {
    status: res.status,
    headers: { "content-type": "application/json" },
  });
}
```

- [ ] **Step 5: Typecheck** `cd frontend && npx tsc --noEmit` → no errors.

- [ ] **Step 6: Commit**

```bash
git add "frontend/app/api/issues/[id]/route.ts" "frontend/app/api/issues/[id]/approve/route.ts" "frontend/app/api/issues/[id]/reject/route.ts" "frontend/app/api/issues/[id]/manual-review/route.ts" "frontend/app/api/issues/[id]/edit/route.ts" "frontend/app/api/tickets/[id]/route.ts"
git commit -m "refactor(frontend): proxy issue routes + ticket detail to the backend"
```

---

## Definition of done

- `cd backend && pytest` all-green (prior 25 + issues repo/api + difftext + ticket detail).
- `/api/issues/[id]` (+approve/reject/manual-review/edit) and `/api/tickets/[id]` are proxies; the frontend review loop (Overview → issue review wizard → approve/reject/edit → work order) works unchanged.
- `draftEditDistance` matches jsdiff for the captured ground-truth cases.

---

## Self-Review

**Spec coverage:** issue read (Tasks 2–3), state machine approve/reject/manual/edit (Tasks 5–6) ✓; draft diff + jsdiff edit-distance with ground-truth parity (Task 4) ✓; issue routes (Task 7) ✓; ticket detail route now unblocked (Task 8) ✓; proxies + guards (Task 9) ✓; runway read dependency (Task 1) ✓.

**Parity risks flagged:** (1) jsdiff edit-distance — Task 4 captures ground truth from the real `diff` package and matches it; if exact parity is infeasible the implementer reports rather than fudging expected values. (2) `_to_issue` uses explicit `None`-checks (not `or`) to mirror `??` — `inspectorNotes` stays `""`, `zone`/`gps`/optional fields omit when null via `exclude_none`.

**Type consistency:** `approve_issue` returns `(IssueCandidate, Ticket)`; routers `dump()` both; `get_ticket_detail` returns a dict the router unwraps; `Actor`, `db.{one,all,run,tx}`, `gid/now/actor_name/actor_role` reused from the prior slice with identical signatures.

**Deferred (later plans):** reads/overview (`getOverview`, inspections, runway-with-issues, zones/schedules/airports CRUD), reports (HTML), uploads + live-capture + feedback-export (S3/ml — last). Phase 2: auth enforcement, scheduler, TOCTOU hardening.
