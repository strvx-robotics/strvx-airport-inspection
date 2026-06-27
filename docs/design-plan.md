# Design Plan — Airport Runway Inspection Vertical on strvx-robotics-product

> Phase 1 (design) of design → implementation → execute. Scope: integrate a new commercial **runway-inspection mission vertical** into `/Users/nicolasdossantos/strvx-robotics-product`, reusing the autonomy core, vision, contracts, storage, auth, and console. Resolves the five PRD-review gaps inline (tagged **[GAP n]**). Authoritative PRD: `/Users/nicolasdossantos/valanor-airport/Planning/prd.md`. Follows the repo's schema-first contracts, per-dir `docs.md`, and `.superpowers/sdd` slice conventions. Net-new build is larger than a single subsystem (see §1) — the review corrected three "reuse" claims into "net-new."

## 1. Integration thesis

Runway inspection is not a new product — it is a **commercial mission vertical** that re-uses the same Detect → Designate → Assign → Observe → Reassign → Recover loop the ISR product already runs, with the human and the timescale shifted. The drone **Detects** (onboard/cloud CV finds FOD, pavement, marking, and lighting anomalies on a nadir runway pass), the system **Designates** each detection as a reviewable *Issue Candidate*, the inspector **Assigns** it (approve → maintenance ticket, reject, manual review, or **edit category** — PRD §9.5) over an LLM-drafted ticket, maintenance **Observes/repairs**, and the inspector **Reassigns/Recovers** by reinspecting and closing. The autonomous flight itself is the existing draw-zone → lawnmower → geofence-contained survey (`docs/tello-survey-mvp-design.md`) re-pointed at a runway zone instead of an AOI.

The reused machinery is real and large (perception inference/NMS, geolocation math, contracts codegen, storage seam, RBAC primitives, the "LLM proposes / human approves" *pattern*, the console feature shell). But the review correctly forced three things out of the "reuse" column and into **net-new**:
1. **The ticket / work-order lifecycle** — no ticket concept exists; alerts are ack-only. The ticket and issue **state machines are net-new** (the `missions` table has no status column and the mission state machine is "plan / not started" in `docs/strvx-product-phase1-plan.md` — there is no precedent to copy).
2. **The inspection scheduler** — no scheduling code exists anywhere in `backend/app/` (PRD §9.2 / §14 require a 6 AM inspection record to be created). This is net-new, minimal, and built in the first slice.
3. **The LLM ticket-drafting seam** — `Reasoner.propose()` returns `list[AutonomyCommand]` over a `TelemetryFrame`, *not* free text over an `IssueCandidate`. Drafting ticket copy needs a **new `draft_ticket()` method + a new IssueCandidate-shaped context builder** (the genuine reuse is the `_chat` plumbing, the propose/approve pattern, and the guardrail's reasoner-always-requires-approval rule).

The vertical lands on top of the finished autonomy capability track and is the forcing function that pulls selected productization items forward **only when a second tenant or production deploy is real** (org tenancy / Postgres / S3 are explicitly *not* in the first slice — see §9).

## 2. Reuse map

| Existing capability | File(s) | How runway inspection uses it |
|---|---|---|
| **Zone survey flight** (draw zone → lawnmower → geofence containment, manual launch, never auto-takeoff) | `docs/tello-survey-mvp-design.md`; `backend/app/geo.py` (`lawnmower()`); `backend/app/guardrail.py` (`point_in_polygon`); `backend/app/mission.py` (`MissionBrain`) | The predefined per-runway-zone route *is* a lawnmower over a `SearchArea(kind="zone")`. Reuse the waypoint sequencer + containment clamp verbatim; a runway zone is the survey box. Human-in-the-loop launch is preserved. |
| **ONNX detection core** (letterbox → infer → conf-filter → NMS → map) + `Detector` ABC + `StubDetector` | `backend/app/vision/detector.py` | Reuse the entire inference/NMS path for FOD and pavement detectors; swap in fine-tuned airport `.onnx` + an airport names list (see §3, §6). `StubDetector` ships the full pipeline/screens before weights exist. CPU onnxruntime → identical code runs cloud-side now, edge-side later. **Prerequisite (§3):** parametrize `names`/`class_map` (the class *count* is already dynamic). |
| **Frame ingestion** (`FrameSource` ABC, `FileFrameSource`) | `backend/app/vision/frame_source.py` | `FileFrameSource` iterates an uploaded inspection video (PRD Phase 1/2). Add a sibling `ImageFrameSource` for discrete GPS-tagged stills (PRD `Image` entity). Downstream pipeline unchanged. |
| **px→m ground sizing math** (altitude + HFOV) | `backend/app/vision/vision_perception.py:60-61` (inline `px_to_m` calc) | Convert a detection bbox to real-world size (crack length, FOD dimension). **Note:** `px_to_m` is an *inline local variable*, not a callable — small prerequisite refactor to extract `ground_sizing(alt, cam)` into a shared helper before reuse (alongside the detector parametrization). This, not `depth.py`, is the sizing tool for nadir imagery. |
| **Geolocation** (`project_to_ground`, `CameraModel`, `DronePose`) | `backend/app/geolocation.py`; used by `vision_perception.py` and `adapters/agent_perception.py` | Turn a detection's bbox-center pixel into a `LngLat` from drone pose, then snap to a `Zone` and compute station+offset **[GAP 3]**. **Requires airframe pose + altitude + GPS** (`project_to_ground` is flat-earth nadir, clamps alt to 10 m, fixed `CameraModel` hfov 60 / 1280×720). Precise addressing is therefore a **Slice-D capability**; Slices A–C use manual zone-tagging + EXIF-GPS (§3, §9). |
| **Edge-detection consumption seam** (poll on-drone agent, map JSON → `Detection`) | `backend/app/adapters/agent_perception.py` | The template proving cloud-now / edge-later parity. **It is a polling *consumer*, not an inference runtime** — the edge-resident detector is future work that plugs into this seam; perception runs cloud-side at MVP (§5, §12). |
| **Eval/metrics CI gate** (`run_gate`, `precision_recall`, `mean_ap`, dataset loaders) + model card + offline fetch | `backend/app/vision/eval/gate.py`, `eval/metrics.py`, `eval/datasets.py`; `models/model_card.md`; `scripts/fetch-models.sh` | Reuse for airport **bbox** models (FOD/pavement): add airport dataset loaders, pin per-`IssueType` thresholds in a new airport model card. **This is the offline FP metric [GAP 5]** for bbox categories only. VLM categories (markings/lighting) need a *separate* held-out-crop accuracy measure (§6) — the bbox gate does not apply. |
| **Graceful-degrade model construction** (build detector only if weights exist, else None + one log line) + env weight paths | `backend/app/adapters/__init__.py` (`_build_tello_vision:147`); `backend/app/config.py` | Mirror as `_build_airport_vision()`; add `VALANOR_AIRPORT_FOD_MODEL` / `VALANOR_AIRPORT_PAVEMENT_MODEL`. System boots before models are trained (PRD Phase 0/1). |
| **Pillow bbox overlay drawing** (cached boxes, inference-free) | `backend/app/adapters/tello_adapter.py` (`get_video_frame`) | Render the "image evidence" thumbnails with the issue bounding box drawn on the captured still (PRD 8.2/8.3 highlighted region). |
| **Schema-first contracts codegen** (one IR → TS+Zod + pydantic, CI drift gate) | `shared/contracts.schema.json`; `scripts/gen_contracts.py`; `shared/contracts.ts`; `backend/app/contracts.py`; `Makefile` (`make contracts` / `make check-contracts`) | Add the **8 PRD §11 entities** + a `User` contract type + new enums in the one schema; codegen emits both sides for free. Zero new tooling. (`User` is *typed* here but **persisted in AuthStore**, not the mission DB — see §3/§4 [GAP 2].) |
| **Storage seam + migration runner + data-mode gate + seed pattern** | `backend/app/storage/store.py` (`MissionStore`, `allows`, `_GATE`, `NullStore` is the **default no-op**); `backend/app/storage/sqlite_store.py` (`_apply_migrations:39`); `database/migrations/0001_init.sql`, `0002_events.sql`; `backend/app/storage/seed.py` | Drop in `0003_airport.sql`; the runner picks it up by sort order. **But the mission `SqliteStore` is opt-in (NullStore default), so airport CRUD cannot ride its connection** — `inspection_store.py` gets its **own always-on connection** (the AuthStore pattern). `events`/`start_mission` are *structural references*, not code reuse (no state machine to copy). `seed.py` pattern seeds one airport / 3 runways / zones / a 6 AM inspection. |
| **Auth + RBAC primitives** (3 roles, fail-closed matrix, sessions, last-admin guard) | `backend/app/auth/permissions.py`; `backend/app/auth/service.py`; `backend/app/auth/store.py`; `frontend/src/auth/permissions.ts`, `frontend/src/auth/types.ts` | Widen `ROLES`/`ROLE_PERMS` with `inspector` + `maintenance`; add review/ticket permissions. **`UserRecord` already has `role`** — the real work is widening the `Role` enum + adding org/airport scoping **inside AuthStore** (a separate DB with *no migration runner*; needs an additive schema extension). New command kinds fail closed to admin (`_FAIL_CLOSED = MANAGE_USERS`) until mapped. **[GAP 2]** |
| **"LLM proposes / human approves / LLM never executes" pattern** | `backend/app/reasoner.py` (`Reasoner` ABC, `narrate`/`explain`/`_chat`); `backend/app/guardrail.py` (`source='reasoner' → Ok(auto=False)`); `backend/app/reasoner_context.py` | Reuse the **pattern** + the `_chat` Ollama plumbing + the guardrail's reasoner-always-requires-approval rule. **Do NOT reuse `propose`** (it returns drone commands). Ticket drafting is a **net-new** `draft_ticket(issue) -> str` ABC method + a net-new IssueCandidate context builder (`reasoner_context.build_context` is TelemetryFrame-shaped). |
| **Agree/override bookkeeping** | `backend/app/earned.py` (`AutonomyMetrics.record/rate`) | Operational FP **derived cache only [GAP 5]** — `earned.py` is an in-memory dataclass that resets on restart, so it **cannot** be a durable source of truth. The durable source is the `issue_status_history` table; earned metrics are a derived in-memory view of it. |
| **Events/alerts split + Logs UI** (detection rows carry det_class/confidence/position/image_id; severity dots; snapshot thumbnails; click→map) | `database/migrations/0002_events.sql`; `backend/app/mission.py` (`_log_event:151`, `_capture_snapshot`); `frontend/src/features/logs/LogsView.tsx`; `frontend/src/features/alerts/AlertIndicator.tsx` | `LogsView` (MissionRoster/MissionDetail + `GET /capture/{id}` thumbnails) is ~80% of the Issue-Candidate review screen. `Alert`/`AlertIndicator` is the notification ping for new critical candidates (kept ack-only — *not* overloaded for review lifecycle). |
| **Console feature-module shell** (feature dir + `docs.md`, Zustand store, Zod-at-boundary, MapLibre, theme tokens) | `frontend/src/features/*`; `docs/SLICE_1_PLAN.md`; `frontend/src/index.css` (`@theme`) | The four PRD §8 screens land as `frontend/src/features/inspection/*` etc., porting the Phase-0 UX onto the real Vite stack + contracts. |
| **Brand / theme** (Valanor monochrome, status-only color) | `brand/`; `brand/docs.md`; `frontend/src/index.css` | Reuse logos + tokens directly; color reserved for severity/status semantics. |
| **Phase-0 demo UX to port** (4 screens, flow, state machine, confidence bands) | `/Users/nicolasdossantos/valanor-airport/frontend/` — `app/{page,runway/[id],issue/[id],ticket/[id]}.tsx`; `lib/{types,seed,store,ui}.ts(x)`; `components/{Badge,RunwayImage,Header}.tsx` | Port the *flow + screens + status maps* (not Next.js) into Vite features; the in-memory `store.tsx` actions become contract-typed API calls. (Demo lacks `setCategory` — add it, PRD §9.5.) |

## 3. Architecture by subsystem

**Mission type (flight + capture).**
- **Reused:** the survey loop end-to-end — `lawnmower()` (`geo.py`), containment clamp + geofence (`guardrail.py`, `mission.py._world_view` boundary), manual-launch discipline, latest-wins command semantics. A runway zone is a `SearchArea(kind="zone")`.
- **New:** a per-runway route is an ordered set of zone polygons stored on the `Runway`/`Zone` rows (PRD 9.1 "manual route setup OK for V1").
- **Changes:** none to MissionBrain; the vertical does not run through its live-track loop. Capture is post-pass.

**Scheduling (NET-NEW, minimal).**
- No scheduling code exists in the repo; this is built in Slice A. A minimal in-process scheduler (APScheduler, or a lightweight `asyncio` cron loop) reads admin-created schedule rows and **materializes** an `Inspection` + one `InspectionJob` per runway at the scheduled time. **Decisive semantics for MVP:** "scheduled" auto-fire creates *records only* (satisfying PRD §14 "create a 6 AM inspection record"); it **never auto-launches the drone** — the inspector manually launches (HITL constraint, §12). For the demo, the same materialization can be triggered on-demand.

**Perception.**
- **Reused:** `OnnxYoloDetector` inference/NMS, `Detector`/`StubDetector` ABCs, `FrameSource`, `project_to_ground`, `IouTracker` (dedup only), eval gate (bbox categories), fetch-models discipline.
- **New:** `backend/app/vision/airport_detector.py` (thin wrappers instantiating the **parametrized** `OnnxYoloDetector` with airport weights/names for FOD + pavement, plus a flag-gated VLM path for markings/lighting); `backend/app/vision/airport_inspection.py` (the static post-flight pipeline `FrameSource → Detector → [geolocate] → zone/station snap → IssueCandidate`); `ImageFrameSource`; `_build_airport_vision()`; the extracted `ground_sizing()` helper.
- **Changes (surgical prerequisites):** (1) parametrize `OnnxYoloDetector` so **`names` and `class_map`** are constructor params defaulting to the module COCO constants (`detector.py:27,45`); a non-COCO head otherwise silently mis-maps via the `_COCO_NAMES[id] → CLASS_MAP.get(..., "unknown")` fallback (`detector.py:164-165`). No class-count param — the count is already derived dynamically from `out[:, 4:]` (`detector.py:135`). (2) extract the inline `px_to_m` math (`vision_perception.py:60-61`) into a shared helper. The ISR path stays on the defaults, untouched.

**LLM ticket drafting (NET-NEW seam).**
- Add `draft_ticket(issue: IssueCandidate) -> str` to the `Reasoner` ABC (`StubReasoner` returns a templated draft; `LocalLlmReasoner` reuses `_chat`). Add a net-new IssueCandidate-shaped context builder alongside `reasoner_context.build_context` (which is TelemetryFrame-shaped and not reusable here). The inspector approval is the existing human gate; the guardrail's `source='reasoner' → Ok(auto=False)` rule is the architectural guarantee the draft never auto-executes.

**Contracts + DB.**
- **Reused:** the whole codegen pipeline; `LngLat`; `SearchArea(parentId, kind=zone)` as the geometry template; the migration runner; `start_mission`/`events` as *structural references*.
- **New:** 8 enums + the **8 PRD §11 record models** + a `User` contract type in `shared/contracts.schema.json` (§4); migration `database/migrations/0003_airport.sql`; the **own-connection, non-fail-open** `backend/app/storage/inspection_store.py`.
- **Changes:** `DetectionClass` is not overloaded — airport categories live in a separate `IssueType` enum. Airport entities are record entities, **not** part of `TelemetryFrame`.
- **Decisive call — do NOT reuse `_execute_write`'s fail-open pattern for airport CRUD.** `sqlite_store.py` swallows errors because storage is never in the drone-safety path; but "approve ticket"/"mark repaired" are user-facing CRUD where a silent no-op is a correctness bug. `inspection_store.py` **opens its own always-on sqlite connection** (mirroring AuthStore, because the mission `SqliteStore` is opt-in / `NullStore` by default), applies `0003`, and **raises on write failure**.

**Users / identity (cross-database) [GAP 2].**
- Airport records live in the mission DB (via `0003`); **users live in the separate AuthStore DB** (`auth/store.py` — deliberately a different DB with its own inline `CREATE TABLE IF NOT EXISTS` schema and **no migration runner**). Consequences, handled explicitly: (a) `users` is **not** in `0003_airport.sql`; (b) airport `created_by` / `assigned_to` columns are **soft text references** (store `user_id`/`username` as `TEXT`, *not* SQL FKs — SQLite FKs cannot span databases); (c) adding `airport_id`/`org_id` to users is an **additive schema extension inside AuthStore** (extend the inline `_SCHEMA` + an idempotent "add column if missing" on init, since there is no migration mechanism); (d) `UserRecord` already carries `role`, so the work is widening the `Role` enum + org scoping, not adding role.

**Adapter + capture.**
- **Reused:** Pillow overlay drawing for evidence thumbnails; the `agent_perception` seam as the edge-later contract; `_capture_snapshot`-style write to `<VALANOR_DATA_DIR>/captures/`.
- **New:** capture sink for full-res GPS-tagged stills tied to `Image` rows, behind the green/`capture` gate. The partner airframe supplies **nadir imagery + pose** (the live Tello path is forward-facing/overlay-only).
- **Changes:** none to the Tello adapter; airport imagery comes from upload (Phase 1) or the partner airframe's nadir camera (Phase 2).

**Frontend.**
- **Reused:** the feature-module pattern, MapLibre, Zustand, Zod-at-boundary, the `LogsView` thumbnail pattern, the auth gate, brand theme.
- **New:** `frontend/src/features/inspection/` (overview dashboard), `runway/`, `issue/`, `ticket/` — porting the Phase-0 screens onto contract types; an admin setup surface for airport/runway/zone/schedule; manual zone-select on image upload (Slices A–C).
- **Changes — correct RBAC target:** mirror new permissions in **`frontend/src/auth/permissions.ts`** (`ROLE_PERMS`, `roleCan`, new `Permission` strings) and **`frontend/src/auth/types.ts`** (widen the `Role` union from `'admin'|'operator'|'viewer'`). `AuthGate.tsx` is only the login/first-run UI and has no permission logic — it is *not* the mirror point. Note `AuthSource`/`UserPatch` carry no org/airport scoping today; add it.

**NET-NEW ticket / work-order subsystem.** Build: (1) `IssueCandidate` (detection promoted to reviewable, with review state + LLM-drafted ticket text + confidence band); (2) `Ticket` with a **net-new** status state machine (no mission state machine exists to copy); (3) `0003_airport.sql` tables; (4) `inspection_store.py` CRUD + transitions (own connection, raises); (5) HTTP/WS command kinds `approve_issue` / `reject_issue` / `manual_review` / `edit_issue` (incl. **edit issue category**, PRD §9.5) / `create_ticket` / `mark_repaired` / `close_ticket`, each RBAC-checked via `command_permission()` + audit-logged; (6) ticket drafting via the net-new `draft_ticket()` seam.

## 4. Domain data model

The **8 PRD §11 entities** + a `User` contract type go into `shared/contracts.schema.json` (then `make contracts`). Float epoch-ms for timestamps; `@LngLat` for coordinates; no native date/JSON type in the DSL, so `metadata`/`bbox`/`polygon` are `@Ref` sub-models or stringified JSON. (The draft's "9 §11 entities" was off-by-one: PRD §11 lists 8; `User` is the **GAP-2 addition the PRD omits**, and it persists in AuthStore, not via `0003`.)

**New enums.** `IssueType [fod, pavement, marking, lighting]`; `Severity [low, medium, high, critical]` **[GAP 1]**; `ConfidenceBand [high, medium, low]` **(PRD §10.4)**; `IssueStatus [pending, approved, rejected, manual_review]`; `TicketStatus [draft, approved, sent, in_progress, repaired, ready_for_reinspection, closed, rejected]` (PRD 8.4); `InspectionStatus [not_started, in_progress, processing, no_issues, needs_review, tickets_created, completed, failed]` (PRD 8.1); `JobStatus`; `InspectionWindow [daylight, dusk_lit]` **[GAP 4]**; `UserRole [admin, inspector, maintenance]` **[GAP 2]**.

**New models.** `Airport(id,name,location,timezone,createdAt)`; `Runway(id,airportId,name,description,lengthM,thresholdRefHeadingDeg,activeStatus)`; `Zone(id,runwayId,name,polygon:[@LngLat],stationStartM,stationEndM,notes)` **[GAP 3]**; `Inspection(id,airportId,scheduledTime,window:@InspectionWindow,startedAt,completedAt,status,createdBy)` **[GAP 4]**; `InspectionJob(id,inspectionId,runwayId,status,startedAt,completedAt,imageCount,issueCount)`; `Image(id,jobId,runwayId,zoneId,fileUrl,gps:@LngLat?,stationM?,lateralOffsetM?,timestamp,sourceFile,geomConfidence:enum[gps,pose,manual])`; `IssueCandidate(id,inspectionId,runwayId,zoneId,imageId,issueType,confidence,confidenceBand,severityModel,severityFinal,status,stationM?,lateralOffsetM?,sizeM?,modelNotes,inspectorNotes,createdBy,createdAt)`; `Ticket(id,issueId,runwayId,zoneId,status,description,severity,assignedTo,createdBy,createdAt,repairedAt,closedAt,maintenanceNotes)`; `User(id,username,role:@UserRole,airportId)` (typed contract; **persisted in AuthStore**, the existing `UserRecord` extended with org scoping).

**Migration sketch — `database/migrations/0003_airport.sql`** (idempotent `CREATE TABLE IF NOT EXISTS`, sorts after `0002`, applied by `inspection_store.py`'s own connection; update `database/docs.md` same commit). **`users` is intentionally absent — it lives in AuthStore.**
```
airports(id PK, name, location, timezone, created_at)
runways(id PK, airport_id FK, name, description, length_m, threshold_heading_deg, active_status)
zones(id PK, runway_id FK, name, polygon_json, station_start_m, station_end_m, notes)
inspection_schedules(id PK, airport_id FK, cron_or_time, window, created_by, enabled)   -- scheduler source [NET-NEW]
inspections(id PK, airport_id FK, scheduled_time, window, started_at, completed_at, status, created_by TEXT)
inspection_jobs(id PK, inspection_id FK, runway_id FK, status, started_at, completed_at, image_count, issue_count)
images(id PK, job_id FK, runway_id FK, zone_id FK, file_url, gps_lat, gps_lng, station_m,
       lateral_offset_m, geom_confidence, timestamp, source_file, metadata_json)
issue_candidates(id PK, inspection_id FK, runway_id FK, zone_id FK, image_id FK, issue_type, confidence,
                 confidence_band, severity_model, severity_final, status, station_m, lateral_offset_m, size_m,
                 bbox_json, model_notes, inspector_notes, created_by TEXT, created_at)
tickets(id PK, issue_id FK, runway_id FK, zone_id FK, status, description, severity, assigned_to TEXT,
        created_by TEXT, created_at, repaired_at, closed_at, maintenance_notes)
issue_status_history(id PK, issue_id FK, from_status, to_status, from_type, to_type, actor TEXT, ts)  -- immutable; DURABLE FP source [GAP 5]
ticket_status_history(id PK, ticket_id FK, from_status, to_status, actor TEXT, ts)                    -- audit trail
-- created_by / assigned_to / actor are SOFT TEXT references to AuthStore user ids (cross-DB; not SQL FKs) [GAP 2]
-- USER identity + role + airport_id: extend AuthStore inline schema (additive, no migration runner) [GAP 2]
```

**[GAP 1] Severity — scale + source of truth.** Canonical `Severity [low, medium, high, critical]` (a dedicated enum, *not* `AlertSeverity` which stays the ISR notification scale). **Source of truth:** a deterministic scoring function emits `severity_model = f(issue_type baseline, confidence, measured size_m, zone criticality)`. **When ground geometry is absent (Slices A–C, no pose/GPS), `size_m` is null and `severity_model` degrades to `f(issue_type baseline, confidence, zone criticality)`** — honest, not fabricated. The inspector may override into `severity_final` (recorded in `issue_status_history`); the `Ticket` inherits `severity_final`. One emitter, one stored value per stage.

**[GAP 3] Zone granularity + degraded addressing.** `Zone` carries both a polygon (coarse buckets: threshold / touchdown / midfield / rollout) **and linear referencing** (`station_start_m`/`station_end_m`). The *precise* address — *"RWY 08, 1,180 m from threshold, 4 m right of centerline"* — is computed from `project_to_ground` + pose + `ground_sizing()` and **requires airframe GPS (ideally RTK); it is a Slice-D capability.** Each `Image`/`IssueCandidate` records a `geom_confidence` ∈ {gps, pose, manual}: **with GPS → fine station/offset; GPS-degraded → fine value marked low-confidence and the UI falls back to the coarse zone bucket; uploaded images (Slices A–C) → manual zone selection + EXIF-GPS when present.** Camera intrinsics + pose accuracy are a **partner-airframe acceptance requirement** (§11), not the default `CameraModel`.

**Confidence banding (PRD §10.4).** `IssueCandidate` stores raw `confidence` *and* a derived `confidence_band` from **per-`IssueType` thresholds pinned in the airport model card** (the single source of truth). High = "Likely issue", Medium = "Needs review", **Low = retained in storage but hidden by default** in the review UI. No threshold lives in UI code.

## 5. End-to-end MVP flow

```
[CLOUD] Scheduler (NET-NEW) fires at the airport's configured time (PRD 9.2)
        → MATERIALIZES Inspection + one InspectionJob per runway. RECORDS ONLY — never auto-launches.
[EDGE]  Per runway/zone: inspector MANUALLY launches; drone flies the lawnmower route over each
        Zone, geofence-contained, nadir camera + pose, autonomous capture (HITL launch; never auto-takeoff).
[EDGE]  Edge OWNS flight control, geofence/safety. (Edge-resident perception is the agent_perception
        seam = future; at MVP perception runs cloud-side.)
[CLOUD] airport_inspection.py: frames → detect (FOD/pavement bbox; markings/lighting VLM if reachable)
        → geolocate IF pose/GPS present, else manual zone tag → IssueCandidate rows (status=pending,
        confidence_band derived) + evidence stills (captures/, green gate) → draft_ticket() DRAFTS text;
        severity_model scored (size term only when geometry present)
[CLOUD] Overview dashboard: per-runway status (no_issues / needs_review / ...) (PRD 8.1)
[HITL]  Inspector reviews each candidate (Runway/Issue screens): approve / reject / manual_review /
        EDIT category (§9.5); edits severity_final, draft text, notes. (Reject = false positive [GAP 5])
[CLOUD] Approve → Ticket(status=draft→sent), assigned_to maintenance. (Never auto-created.)
[HITL]  Maintenance: view ticket + evidence + (coarse-or-fine) location → in_progress → repaired
        (+ repair notes/images) → ready_for_reinspection
[HITL]  Inspector reinspects → close. Report export (PRD 14): minimal HTML/JSON in Slice A; PDF/CSV in Slice E.
```

**Edge vs cloud split (hard constraint):** the **edge owns** flight control and geofence/safety; **cloud is optional** and owns scheduling, dashboards, the candidate/ticket lifecycle, history, and reports. **At MVP, perception inference runs cloud-side** (identical CPU-onnxruntime code), and moves to an edge agent later via the `agent_perception.py` seam (a polling consumer) with no rewrite. If cloud is unreachable mid-mission, capture + (future edge) detection continue and sync later.

## 6. Perception strategy

**Reality check: pretrained YOLO11n is useless here** — COCO has no FOD, cracks, faded paint, or broken signage. This is genuine ML work, not a config swap. **Launch deliverable, stated plainly:** **pavement = real detector; markings + lighting = VLM advisory; FOD = best-effort/weak until a real nadir FOD set is collected.** This honestly meets PRD §12's "detect ≥2 of 4 reasonably well" — it does *not* claim four reliable detectors at launch.

- **Pavement damage — extend-YOLO (fine-tune), detection first. The flagship real detector.** Strong public road-damage base exists; map to `IssueType=pavement`. bbox + `ground_sizing()` is enough for a reviewable candidate; segmentation is a later upgrade. Eval gate enforced.
- **FOD / Debris — extend-YOLO, but no public nadir set exists.** Bootstrap with public + synthetic + a staged-FOD apron pass, fine-tune on a first pilot pass. **Set the FOD eval-gate threshold to reflect best-effort, not parity with pavement;** ships behind `StubAirportDetector` until weights clear that (lower) bar.
- **Runway markings — interim VLM (cloud-assisted), flag-gated.** Crop known marking regions, ask a VLM "faded / obscured / missing / nominal" + draft text. Offline runs disable it cleanly.
- **Lighting / signage — asset-registry verification + interim VLM, physical-condition only.** Given known fixture/sign locations (PRD 10.5), verify present + undamaged + unobstructed.

**VLM quality / FP measure [GAP 5, markings + lighting].** The bbox eval gate (`1 − precision`) does **not** apply to a VLM yes/no answer. Define a **separate measure: labeled accuracy (and per-class precision/recall) on a held-out crop set** per VLM category, tracked in the model card. So all four categories have a defined offline quality measure; only the two bbox categories use `eval/gate.py`.

**Sizing:** the extracted `ground_sizing()` (altitude + HFOV), **not** `depth.py`/`metric_depth.py` (relative-only / indoor-tuned; they stay an ISR safety stop-gate).

**[GAP 4] Illumination window — corrected from "6am = daylight."** 6:00 AM is daylight only seasonally/by latitude (e.g. Augusta GA winter dawn is well after 6am). So the window is defined by **illumination state, not a clock**: (a) a **`window=daylight`** inspection requires sufficient light (after civil twilight) or onboard lighting for the *visible-light* categories (FOD/pavement/markings + physical fixture condition) — if it's actually dark, *all* visible-light categories degrade, not just lighting; (b) a daylight pass **cannot** tell an electrically dead-but-intact light from a working one — that needs darkness — so electrical illumination is a **separate `window=dusk_lit` pass**. Crucially, a genuinely **dark early window is an asset, not a problem**: it is exactly the `dusk_lit` pass that reveals dead lights. The scheduler picks the window per the airport's twilight table. The lighting success metric measures **physical condition** in daylight and **illumination** in the dusk-lit pass — each honest to its window.

**How the drone "actually catches these things":** nadir camera + pose from the partner airframe → GPS-tagged stills → pavement detector (real) + FOD (best-effort) on cloud now / edge later → `project_to_ground` + `ground_sizing()` give a runway address + size **when geometry is present** → candidates with evidence thumbnails. Markings + lighting are VLM-assisted advisory candidates.

**[GAP 5] False-positive measurement — defined per category + durable source.** (1) **Model quality (offline):** bbox categories use FP-rate = `1 − precision` via `eval/gate.py`; VLM categories use held-out-crop accuracy (above). (2) **Operational (in-loop):** a false positive = an `IssueCandidate` the inspector **rejects**; FP-rate = `rejected / (approved + rejected)` computed from the **immutable `issue_status_history` table — the single durable source of truth**. `earned.AutonomyMetrics` is a **derived in-memory cache** of that table (it resets on restart and cannot be authoritative).

## 7. Roles & auth

Extend the fail-closed matrix in `backend/app/auth/permissions.py`; reuse `AuthService`/`AuthStore` (sessions, last-admin guard, `must_change_password`). **[GAP 2]** The PRD `User` entity = the existing `UserRecord` (which **already has `role`**) extended with `airport_id`/`org_id` scoping — an **additive AuthStore schema change** (AuthStore has no migration runner; add the column on init if missing). Identity stays in the AuthStore DB; airport tables reference it via **soft text ids** (§3/§4).

- **admin → `admin`** (1:1). Superset; sets up airport/runways/zones/schedules + manages users (PRD §6).
- **inspector → NEW role `inspector`** — *not* `operator`, because `operator` grants `FLY` (the drone is autonomous; the inspector reviews). Grant `WATCH` + new `REVIEW_ISSUES` (approve/reject/manual_review/**edit category §9.5**/edit severity/notes), `CREATE_TICKET`, `CLOSE_TICKET`, `LAUNCH_INSPECTION` (manual HITL launch of a scheduled inspection).
- **maintenance → NEW role `maintenance`** — no existing equivalent (`viewer` is read-only; `operator` can fly). Grant scoped read of assigned tickets + new `UPDATE_TICKET`/`MARK_REPAIRED`; **no** ISR/flight read.

New `Permission` members: `REVIEW_ISSUES`, `CREATE_TICKET`, `CLOSE_TICKET`, `LAUNCH_INSPECTION`, `UPDATE_TICKET`, `MARK_REPAIRED`. Map the new command kinds (incl. `edit_issue`) in `_COMMAND_PERMS`; unmapped kinds **fail closed to admin** (`_FAIL_CLOSED = MANAGE_USERS`) until mapped. **Mirror in the frontend at `frontend/src/auth/permissions.ts` + `types.ts`** (not `AuthGate.tsx`) — same anti-drift contract; add org/airport scoping to `AuthSource`/`UserPatch`, which lack it today.

## 8. Real images

**Current reality (verified):** there are **no runway images in either repo**. The 6 JPGs in `/Users/nicolasdossantos/valanor-airport/Planning/` (`IMG_7596`–`7601`) are **whiteboard planning photos**; `components/RunwayImage.tsx` in the Phase-0 demo is a CSS asphalt stand-in. "Real images now" is a genuine acquisition workstream.

- **Where they live:** full-res GPS-tagged stills in `captures/` (the green-mode `capture` sink), referenced by `Image.file_url`; promoted to S3 `media_assets` *only when the productization slice lands* (deferred, §9). Each `Image` ties to `job_id → runway_id → zone_id` (+ `gps`/`station_m` *when geometry is present*).
- **How tied to runway+zone:** Slice D → `project_to_ground` (pose + nadir geometry) → snap to `Zone` + compute `station_m`. **Slices A–C → manual zone selection at upload + EXIF-GPS when present** (PRD §9.3 explicitly allows "Zone if known" + "GPS metadata if available"). `geom_confidence` records which path produced the location.
- **Demo dataset (decisive plan):** (1) collect a first real nadir set from a Tello/partner-airframe pass over an apron or marked surface; (2) augment with public pavement/road-damage imagery + a small staged-FOD set; (3) seed one airport / 3 runways / zones / a 6 AM inspection (mirror `storage/seed.py` and the Phase-0 fixtures: Augusta Regional, RWY 17-35 / 08-26 / 11-29) so the ported screens render against real JPEGs with drawn bounding boxes via the Pillow overlay path.

**[GAP 4 evidence note]** daylight demo images = daylight physical-condition shots; lit/dead-light demo images come from a `dusk_lit` pass.

## 9. Phasing

Reconcile PRD Phases 0-4 with the repo's `.superpowers/sdd` one-phase-one-PR slice convention. Each slice is independently reviewable. The vertical spans contracts/auth/storage/vision/frontend, so strict slicing avoids the documented multi-session-on-main collision.

- **Slice A (FIRST shippable vertical slice) — Contracts + storage + scheduler + ticket lifecycle + ported screens on real persistence, stubbed CV.** Build list: the 8 §11 entities + a `User` type + enums in the schema (`make contracts`); `0003_airport.sql` (no `users` table); **AuthStore role-widening + `airport_id` scoping**; `inspection_store.py` (**own connection, non-fail-open**, state machines); new roles/permissions (**backend `permissions.py` + frontend `auth/permissions.ts`/`types.ts`**); **the minimal scheduler** (materializes Inspection + InspectionJob records; never auto-launches); **manual zone-select + EXIF-GPS upload path**; `StubAirportDetector`; **the `draft_ticket()` seam + IssueCandidate context builder** (stub draft is fine here); **confidence banding (per-IssueType thresholds + default-hidden Low)**; `edit_issue` (incl. category) command; port the 4 PRD §8 screens into `features/inspection/*`; seed one airport/3 runways/a 6 AM inspection; **a minimal HTML/JSON report export** (to honestly satisfy PRD §14). **On SQLite + local `captures/` — no Postgres/S3/org-tenancy.** **Verify (= PRD §14):** admin creates airport/runways/zones + a schedule; the scheduler creates a 6 AM inspection record; upload an image → manual zone tag ties it to runway/zone; candidates show with bands; inspector approve/reject/edit-category creates a ticket from an LLM-drafted text; maintenance marks repaired; inspector closes; **report exports (HTML/JSON)**. Absorbs PRD Phase 0 + Phase 1 onto the real stack.
- **Slice B — Real pavement detector + best-effort FOD.** Parametrize `OnnxYoloDetector` (`names`/`class_map`); extract `ground_sizing()`; `airport_detector.py` + `_build_airport_vision()`; airport dataset loaders + per-`IssueType` gate thresholds (FOD threshold set to best-effort) + model card; fetch-script entries. **Verify:** held-out gate passes per category; real pavement detections on the demo set. (PRD Phase 1 CV.)
- **Slice C — Markings + lighting VLM path (cloud-assisted, flag-gated, daylight physical-condition).** Plus the **held-out-crop accuracy measure** for the two VLM categories. **Verify:** VLM crops produce advisory candidates + drafted text; offline run cleanly disables them; crop-accuracy tracked. (PRD 10.5.)
- **Slice D — Drone flight integration (nadir capture, pose → real geometry).** Re-point the survey loop at runway zones; partner-airframe nadir + pose; capture per route → auto-create job → process after flight; **precise station/offset/size + `geom_confidence=gps/pose`**, with degraded-mode coarse-bucket fallback. **Verify:** a real pass creates a job, candidates, and a findable address (RTK present) or a coarse bucket (degraded). (PRD Phase 2.)
- **Slice E — Work-order export/integration + richer reports.** PDF/CSV export, email to maintenance; later Aeros Simple. (PRD Phase 3.)
- **Slice F — Automated reinspection / before-after.** Reinspect a zone, compare before/after. (PRD Phase 4.)

**Productization deferred:** org tenancy, Postgres, S3 media, X.509 device identity, CI/CD from `docs/strvx-product-phase1-plan.md` are **not** in Slice A — the PRD MVP (1 airport, 3 runways) is fully served by the existing SQLite store + local `captures/`. Model `org_id` as a **nullable column now** for forward-compat; build the tenancy/Postgres/S3 stack only when a second tenant or a production deploy is real (alongside a later slice).

## 10. Risks & mitigations

- **Cross-database user identity [GAP 2].** Airport tables (mission DB) cannot SQL-FK to users (AuthStore DB). → Soft text refs for `created_by`/`assigned_to`/`actor`; AuthStore gets an additive `airport_id` column on init (no migration runner); `users` is never in `0003`.
- **Scheduler is net-new, not pre-existing.** No scheduling code in the repo. → Build the minimal scheduler in Slice A; "scheduled" = auto-create records, manual HITL launch.
- **Ticket-text drafting is net-new, not `propose` reuse.** `propose` returns drone commands. → New `draft_ticket()` ABC method + IssueCandidate context builder, reusing `_chat` + the propose/approve pattern + the guardrail HITL rule.
- **Precise localization unavailable without pose/GPS.** Slices A–C have no geometry. → Manual zone-tag + EXIF; `geom_confidence`; severity degrades to baseline+confidence; fine station/offset deferred to Slice D and marked low-confidence under GPS-degradation (coarse bucket fallback). Camera intrinsics + pose are a partner-airframe acceptance requirement.
- **No airport training data; FOD has no public nadir set.** → Data acquisition is a workstream; ship pipeline/screens on `StubAirportDetector`; pavement is the reliable launch detector, FOD best-effort with a relaxed gate, markings/lighting VLM-advisory.
- **`OnnxYoloDetector` hardcodes COCO names/map (`detector.py:27,45,164`).** → Parametrize `names`/`class_map` (count is already dynamic; no count param) before any airport weights.
- **`px_to_m` is an inline local, not an API.** → Extract `ground_sizing()` helper (Slice B prerequisite).
- **Fail-open writes / opt-in store are wrong for CRUD.** `_execute_write` swallows errors; `NullStore` is the default. → `inspection_store.py` opens its **own always-on connection** and **raises** on failure.
- **Overloading shared contracts.** → Separate `IssueType`/`Severity`/`IssueCandidate`; keep `Alert` ack-only.
- **Edge vs PRD "no edge requirement."** PRD assumes cloud post-processing; hard constraint says edge owns control/safety/perception. → Control/safety are edge today; perception is cloud at MVP and edge-later via the `agent_perception` consumer seam — documented so the cloud-first MVP isn't read as a violation.
- **Illumination window.** 6am is not reliably daylight. → Window defined by twilight/illumination, not clock; dark early window repurposed as the `dusk_lit` lit/dead-light pass.
- **VLM categories have no bbox gate.** → Separate held-out-crop accuracy measure.
- **Multi-subsystem branch collision.** → Strict SDD slicing, one PR per slice, per-dir `docs.md` updated in the same commit.
- **Over-scoping productization.** → Postgres/S3/tenancy deferred; Slice A on SQLite + local captures.

## 11. Open decisions for owner sign-off

- **Data mode for the airport vertical:** confirm it runs **green** (persist real imagery) for this commercial, non-classified tenant — required or images are dropped by the `_GATE`.
- **Severity scale [GAP 1]:** approve the dedicated 4-level `Severity [low, medium, high, critical]`, distinct from ISR `AlertSeverity`. (Recommend approve.)
- **Roles [GAP 2]:** approve new `inspector` + `maintenance` roles (not reusing `operator`), with the §7 permission set, and the cross-DB soft-reference + AuthStore-extension approach for user identity.
- **Lighting / window scope [GAP 4]:** approve daylight = **physical condition only**, electrical lit-check deferred to an optional `dusk_lit` pass, and the **illumination-driven (not clock-driven) window**.
- **Scheduling semantics:** approve **auto-fire = record creation only; flight launch stays manual HITL** for the MVP (vs full auto-fire that still cannot auto-takeoff).
- **First-slice scope:** approve **Slice A** (contracts + scheduler + ticket lifecycle + ported screens on real persistence, stubbed CV, **on SQLite + local captures**), collapsing PRD Phase 0 + Phase 1, with productization deferred.
- **Partner airframe nadir camera + pose (+ RTK):** confirm the launch airframe delivers downward imagery + accurate pose/GPS — the dependency for precise zone/station localization (Slice D).
- **First training dataset source:** pilot-airport pass vs bootstrap pavement from public data + a staged FOD/apron pass.
- **Report format:** minimal HTML/JSON in Slice A is assumed; confirm PDF vs structured JSON+HTML for the pilot deliverable in Slice E.

## 12. Hard-constraint compliance check

- **Edge-resilient / cloud-assisted:** edge owns flight control and geofence/safety; cloud (scheduling, dashboards, ticket lifecycle, history, reports) is optional. **Perception runs cloud-side at MVP; it is edge-resident later via the `agent_perception` seam (a polling consumer, not shipped at MVP).** ✅ (scoped honestly)
- **GPS-degraded capable:** flight reuses the survey loop's GPS-or-dead-reckoning path. **Precise station/offset addressing requires airframe GPS (ideally RTK); under degradation the system falls back to coarse zone-bucket addressing and marks fine values low-confidence (`geom_confidence`).** Slices A–C use manual zone-tag + EXIF. ✅ (with explicit degraded-mode behavior)
- **ISR-only (no weapons/engagement):** pure infrastructure inspection; ISR `DetectionClass` untouched (airport uses separate `IssueType`). ✅
- **Human-in-the-loop:** manual launch (never auto-takeoff); the scheduler **auto-creates records only**; every ticket is `draft_ticket()`-then-approve, guaranteed non-auto by the guardrail's `source='reasoner' → auto=False` rule. ✅
- **Partner airframes:** Valanor adds the inspection mission, detectors, contracts, console screens, scheduler, and ticket subsystem; nadir camera + pose + GPS are supplied by the partner airframe (an acceptance requirement). ✅

## Changelog from review

- **§1, §3, §9 — Scheduler is net-new (major, lens 2).** Removed the implication the scheduler pre-exists; added a minimal net-new scheduler to Slice A; defined "scheduled" = auto-create records, manual HITL launch. Corrected the "only one net-new subsystem" thesis to name three (ticket lifecycle, scheduler, drafting seam).
- **§1, §2, §3, §6, §10 — Ticket drafting is net-new, not `reasoner.propose` (major, both lenses).** `propose` returns `list[AutonomyCommand]`; replaced with a net-new `draft_ticket(issue)->str` ABC method + IssueCandidate context builder, reusing `_chat` + the propose/approve pattern + the guardrail HITL rule.
- **§2, §3, §4, §7, §10 — Cross-DB user identity (major, lens 1, GAP 2).** Users stay in AuthStore (separate DB, no migration runner); removed `users` from `0003`; `created_by`/`assigned_to`/`actor` are soft TEXT refs (no cross-DB FK); `airport_id` added via additive AuthStore schema extension; noted `UserRecord` already has `role`.
- **§2, §3, §4, §8, §12 — GPS-degraded localization honesty (major, lens 1, GAP 3).** Precise station/offset now scoped to Slice D + airframe GPS/RTK; added `geom_confidence`, coarse-bucket degraded fallback, manual zone-tag + EXIF for Slices A–C; camera intrinsics/pose made a partner-airframe acceptance requirement; severity degrades when geometry absent.
- **§9, §10 — Productization de-scoped from Slice A (major, lens 2).** Postgres/S3/org-tenancy/X.509 deferred to a later slice; Slice A runs on SQLite + local `captures/`; `org_id` nullable now for forward-compat.
- **§1, §6, §9 — FOD/launch-deliverable realism (major, lens 2).** Stated plainly: pavement = real, markings/lighting = VLM advisory, FOD = best-effort with a relaxed eval gate; dropped the implication all four are reliable detectors at launch.
- **§2, §3, §7 — Frontend RBAC target corrected (minor, lens 1).** Retargeted from the nonexistent `AuthGate.tsx` `can()`/`AuthGuard` to `frontend/src/auth/permissions.ts` + `types.ts`; noted `AuthSource`/`UserPatch` lack org scoping.
- **§1, §2, §3 — Ticket/issue state machines are net-new (minor, lens 1).** Dropped "modeled on the existing mission state machine" (the `missions` table has no status column; that machine is "plan / not started"); `events`/`start_mission` recast as structural references, not reuse.
- **§2, §3, §10 — `OnnxYoloDetector` parametrization wording (minor, lens 1).** Diagnosis corrected to the hardcoded `_COCO_NAMES`/`CLASS_MAP` + silent `"unknown"` fallback; class count is already dynamic; parametrize `names`/`class_map` only (no count param).
- **§2, §3, §10 — Edge ✅ + storage connection (minor, lens 1).** Reworded the edge checkmark (perception is cloud-side at MVP; the seam is a polling consumer); `inspection_store.py` gets its own always-on connection because `NullStore` is the default.
- **§2, §6 — `earned.py` is a derived cache, not a source of truth (minor, lens 2, GAP 5).** `issue_status_history` is the single durable operational-FP source; earned metrics are an in-memory derived view.
- **§6 — VLM quality gate (minor, lens 2, GAP 5).** Added a held-out-crop accuracy measure for markings/lighting (the bbox gate doesn't apply); all four categories now have a defined offline measure.
- **§6, §11, §12 — Illumination window (minor, lens 2, GAP 4).** Window defined by twilight/illumination, not the 6am clock; dark early window repurposed as the `dusk_lit` dead-light pass; visible-light categories degrade together if it's actually dark.
- **§4, §6 — Confidence banding (minor, lens 2, PRD §10.4).** Added `ConfidenceBand` + per-`IssueType` thresholds in the model card + default-hidden-but-retained Low band.
- **§3, §7, §9 — Edit issue category (minor, lens 2, PRD §9.5).** Added `edit_issue` (incl. category) command + folded into `REVIEW_ISSUES`, mutation recorded in `issue_status_history`.
- **§2, §3, §6, §10 — `px_to_m` extraction (minor, lens 2).** Noted it is an inline local variable; added the `ground_sizing()` extraction as a Slice-B prerequisite.
- **§9, §13-acceptance — Report-export contradiction (minor, lens 2).** Added a minimal HTML/JSON export to Slice A so its PRD §14 claim holds; PDF/CSV/email remain Slice E.
- **§4 — Entity count corrected (minor).** PRD §11 has 8 entities; `User` is the GAP-2 addition the PRD omits and persists in AuthStore — the draft's "9 §11 entities" was off-by-one.

## 13. Addendum — Self-improvement / feedback loop (added post-review)

Two capabilities requested after the main design: **(A)** every rejection must capture *why*, as a learning signal; **(B)** capture the diff between the AI's ticket draft and the inspector's final text so the drafting model improves. Principle: **capture the signals in Slice A (cheap now, impossible to recover later); consume them to improve models in a later slice.**

### 13.1 Rejection feedback — signal for the detector + calibration
- New enum `RejectionReason [not_an_issue, wrong_category, duplicate, not_actionable, below_threshold, image_unclear, already_known, other]`.
- `reject_issue` is **gated on a reason**: requires `reason: RejectionReason` + optional `reason_note` (free text). Stored on the **immutable `issue_status_history` row** (add `reason`, `reason_note` columns — the durable source) and denormalized onto `issue_candidates` (`rejection_reason`, `rejection_note`) for query.
- How each reason improves the system (offline, later): `not_an_issue` / `below_threshold` → **hard-negative mining** + threshold recalibration for the detector; `wrong_category` (paired with the `edit_issue` corrected category) → **relabeling** data; `duplicate` → dedup tuning; `not_actionable` / `already_known` → triage policy, not model.

### 13.2 Draft differential — signal for the ticket-writer
- Preserve the **immutable `ai_draft_text`** (original `draft_ticket()` output) on `issue_candidates`, separate from the inspector-edited text. On approve, `Ticket.description` = the final edited text; `ai_draft_text` is **never overwritten**.
- The **diff** between `ai_draft_text` and the final is the learning datum, used two ways: (a) a **git-style diff-view UI** on the issue screen so the inspector sees their changes; (b) the feedback export. Store `draft_edit_distance` (cheap metric); the `(issue context, ai_draft_text, human_final)` triple is the training pair.

### 13.3 The improvement mechanism — supervised first, RL later (recommended)
What this needs *first* is **structured human-feedback capture feeding supervised improvement**, not classic RL:
- **Detector:** hard-negative mining + threshold recalibration from rejected candidates; relabel from `wrong_category`.
- **Writer:** **(1) immediate, no training — in-context few-shot:** retrieve recent high-quality human corrections for the same `IssueType` and inject as exemplars into the `draft_ticket()` prompt (quality rises with zero ML infra); **(2) later — SFT/DPO** on accumulated draft→correction pairs.
- **True RL** (reward model + policy optimization) is a heavier later option, justified only if preference-data volume warrants it. **Recommendation: supervised/DPO + hard-negative mining + few-shot first; revisit RL later.**
- Promotion guard: a new model/prompt ships only if it **beats the incumbent on the held-out set** (reuse `backend/app/vision/eval/gate.py` for detectors; the held-out-crop / draft-quality measure for the writer).

### 13.4 Data-model deltas (additive to §4)
- enums: `+ RejectionReason`.
- `IssueCandidate`: `+ ai_draft_text` (immutable), `+ rejection_reason?`, `+ rejection_note?`, `+ draft_edit_distance?`.
- `issue_status_history`: `+ reason?`, `+ reason_note?` columns.
- **Feedback export** (new, read-only, **admin-only**): `GET /inspection/feedback-export` emitting JSONL learning records — rejections `{image_id, bbox, issue_type, model_confidence, reason, corrected_category?}` and draft pairs `{issue_context, ai_draft_text, final_description, edit_distance}`. This is the dataset; training is offline/later.

### 13.5 Phasing
- **Slice A (now — capture only):** `RejectionReason` enum + required reason on reject; `ai_draft_text` preservation; the diff-view UI; the feedback-export endpoint.
- **Slice G (later — learning loop):** detector hard-negative retraining + threshold recalibration; in-context few-shot drafting (could land early — it's cheap); optional SFT/DPO; offline eval-gate promotion.

### 13.6 Open decisions (added)
- Approve the `RejectionReason` taxonomy (8 values) with **reason required on reject**.
- Confirm **supervised (hard-negative + SFT/DPO + few-shot) first, RL later** (recommended) vs commit to RL now.
- Enable **in-context few-shot drafting** as a cheap early win (recommended) vs defer all writer improvement to training.
