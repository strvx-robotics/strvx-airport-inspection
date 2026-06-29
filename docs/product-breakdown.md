# Overview

STRVX Runway Inspection is an AI-assisted tool for airport operations teams. A
drone or operator captures runway imagery, computer vision flags possible issues,
an inspector reviews each one, and approved findings become maintenance tickets.
A human stays in the loop at every decision.

**Core problem.** Ops staff walk the runway before flights, spot issues by eye,
log them by hand, write work orders, wait for repair, and reinspect. It is slow,
labor-intensive, and produces inconsistent documentation.

**MVP goal.** A dashboard that runs or reviews drone-based runway inspections,
detects four issue categories, presents reviewable candidates per runway and
zone, and turns approved findings into maintenance-ready tickets.

**Key principle.** The model is an assistant, not the authority. The MVP proves
STRVX helps teams inspect faster and document better, not that it replaces
inspectors. No ticket is finalized on a confidence score alone.

At a glance:

| Dimension | Count |
| --- | --- |
| Issue categories | 4 |
| User roles | 3 |
| App screens | 10 |
| Services | 3 |
| Build phases | 5 |

# Primary Users

Three roles, each with a distinct job and landing screen.

| Role | Lands on | What they do |
| --- | --- | --- |
| Admin | `/admin` | Create airport, runways, zones, and the map; configure inspection schedules; manage users and roles; set app and stream settings. |
| Inspector | `/` | Review findings by runway; approve, reject, or send to manual review; edit the AI ticket draft and severity; create tickets and close after repair. |
| Maintenance | `/ticket` | See assigned tickets with images and location; update ticket status; mark repair complete; attach repair notes. |

# The Workflow

The product replaces a manual walk-down with an AI-assisted review loop.

**Today (manual).** Ops staff physically inspect each runway, spot issues by eye,
log them by hand, and route work orders that are later repaired and reinspected.

**With STRVX (AI-assisted).** Imagery is captured on a schedule or on demand, CV
flags reviewable candidates per runway and zone, the inspector approves a
pre-drafted ticket, and the result is exportable as a report.

Inspection-to-closeout pipeline:

1. Schedule or run-now
2. Capture (manual upload or live drone feed)
3. CV plus VLM detection
4. Issue candidates created
5. Human review (approve / reject / manual review / edit)
6. Approved ticket
7. Maintenance repair
8. Inspector closeout
9. Report plus feedback export

# Issue Categories

The MVP inspects for four issue types. Each maps to a detection approach.

| Category | Examples | Detection approach |
| --- | --- | --- |
| Debris / FOD (`fod`) | Trash, tools, metal, rubber chunks, loose objects | Object / anomaly detection |
| Pavement damage (`pavement`) | Cracks, potholes, spalling, standing water | Detection / segmentation |
| Marking issues (`marking`) | Faded centerline, worn thresholds, rubber buildup | Visual degradation / VLM |
| Lighting & signage (`lighting`) | Damaged or missing lights, obstructed signage | Asset check / VLM |

# Feature Inventory

Twenty-six tracked capabilities across the product surface. Most of the MVP
workflow is shipped on real Postgres; detection quality and external integrations
are the open frontier.

Status summary: **19 Built, 4 Partial, 3 Planned.**

- **Built** — shipped on real persistence.
- **Partial** — early or proxy CV models, functional but not airport-trained.
- **Planned** — scheduled for a later build phase.

### Setup & configuration

| Capability | What it does | Status |
| --- | --- | --- |
| Airport / runway / zone setup | Admin defines the physical airfield layout and map | Built |
| Inspection schedules | Recurring daily window (default 6:00 AM) per airport | Built |
| Users & roles | Admin / inspector / maintenance accounts (advisory RBAC) | Built |
| Fleet registry | Drone status, battery, and assignment tracking | Built |
| App settings | Runtime config such as the live stream URL | Built |

### Capture & ingestion

| Capability | What it does | Status |
| --- | --- | --- |
| Run-now inspection | Create an inspection job on demand, per runway | Built |
| Manual image upload | Upload runway imagery and tag it to a zone | Built |
| Live drone feed | HLS video on the Live page with detection overlay | Built |
| Live capture ingestion | Stream worker files candidates automatically | Built |
| Drone flight integration | Predefined routes plus auto job creation after a flight | Planned |

### Detection (CV / AI)

| Capability | What it does | Status |
| --- | --- | --- |
| FOD / debris detection | YOLO object detection for foreign objects | Partial |
| Pavement damage | Public road-damage detection weights | Partial |
| Marking degradation | Claude vision (VLM) advisory pass | Partial |
| Lighting / signage | Claude vision (VLM) advisory pass | Partial |
| Confidence banding | High / medium / low routing per PRD thresholds | Built |
| Deterministic fallback | Full workflow still runs with no ML service | Built |

### Review & ticketing

| Capability | What it does | Status |
| --- | --- | --- |
| Issue review | Approve, reject, manual-review, edit category and severity | Built |
| AI ticket drafting | Suggested ticket text via RL / Claude / template | Built |
| Ticket lifecycle | Draft to sent to in progress to repaired to closed | Built |
| Maintenance tracker | Maintenance worklist with repair notes | Built |
| Reinspection closeout | Inspector closes the ticket after repair (manual) | Built |
| Automated reinspection | Drone re-fly plus before/after image compare | Planned |

### Reporting & learning

| Capability | What it does | Status |
| --- | --- | --- |
| Inspection report export | Per-inspection JSON / HTML report | Built |
| Feedback export (JSONL) | Decisions, rejections, and AI-vs-final draft pairs | Built |
| RL training & eval | Reward model, policy, threshold tuning, eval harness | Built |
| External work-order integration | Aeros Simple / email / PDF-CSV handoff | Planned |

# Product Screens

| Route | Screen | Audience | Purpose |
| --- | --- | --- | --- |
| `/` | Dashboard / tracker | All | Inspection overview; maintenance sees its worklist |
| `/inspection/[id]` | Inspection detail | Inspector | Per-runway status for one run |
| `/runway/[id]` | Runway issues | Inspector | Issue candidate list for a runway |
| `/issue/[id]` | Issue review | Inspector | Approve / reject / edit a candidate |
| `/ticket/[id]` | Work order | Maintenance | Repair details and closeout |
| `/upload` | Upload | Inspector / Admin | Manual imagery upload plus zone tag |
| `/live` | Live feed | Inspector | HLS feed with live detection overlay |
| `/map` | Map | All | Airport / runway map view |
| `/admin` | Admin setup | Admin | Airport, runway, zone, schedule, users, settings |
| `/logs` | Logs | All | Inspection plus ticket history |

# Architecture

Three services share one Postgres database.

| Service | Port | Stack | Owns |
| --- | --- | --- | --- |
| `frontend` | 3000 | Next.js App Router + BFF | Browser UI for every screen; proxies most `/api/*` to the backend; owns uploads, reports, settings, feedback, and live-capture routes |
| `backend` | 8080 | FastAPI + asyncpg | Reads and writes; issues, tickets, airports, drones, runways, zones, schedules, users |
| `ml-service` | 8000 | FastAPI + YOLO + VLM | Upload and live detection; live detection relay (WebSocket); RL draft / reward / threshold plus eval |

When the ML service is absent, the app falls back to deterministic detection and
ticket drafting so the full workflow still runs.

# Data Model & Lifecycles

Core entity chain:

Airport to Runway to Zone to Inspection to Job to Image to Issue candidate to
Ticket.

State machines:

- **Inspection:** not_started, in_progress, processing, needs_review, no_issues, tickets_created, completed, failed.
- **Issue candidate:** pending, approved, rejected, manual_review.
- **Ticket:** draft, sent, in_progress, repaired, closed, rejected.

# Build Phases

| Phase | Goal | Status |
| --- | --- | --- |
| Phase 0 | Clickable demo with mock data | Done |
| Phase 1 | Image-upload MVP on real Postgres | Done |
| Phase 2 | Drone flight integration | In progress |
| Phase 3 | Work-order integration | Partial |
| Phase 4 | Automated reinspection | Planned |

Phase 2 has the live feed and capture path built; predefined routes and
auto-flight remain. Phase 3 has report and feedback export built; the external
work-order handoff remains.

# Scope Guardrails

Out of scope for the MVP:

- Wildlife detection
- Threat detection
- Voice communications
- Fully autonomous ticketing
- FAA-critical autonomy
- Multi-drone or swarm coordination
- GPS-denied autonomy
- Edge-compute requirement
- Day-one Aeros Simple integration

# Direction Read

The product surface and workflow are essentially complete and well-scoped. The
remaining value and risk are concentrated in two places: detection quality (the
four detectors are functional but proxy-grade and not airport-trained) and the
last-mile integrations in Phase 2 and Phase 3 (drone flight automation and the
external work-order handoff). The next unit of effort is better spent there than
on building more application features.
