---
name: gsd
description: Plans and executes feature work through the project's GSD workflow. Use when the user asks for GSD, gsd, roadmap-driven execution, phase planning, implementation with verification, or to build a feature using GSD.
---

# GSD Workflow

Use this skill for feature work that needs structured discovery, planning,
execution, review, and verification.

## Operating Model

When invoked:

1. Clarify the feature goal and success criteria.
2. Map the current codebase before editing.
3. Produce an implementation plan with concrete files, data model changes, UI
   flows, tests, and rollout notes.
4. Execute in small slices.
5. Verify each slice with the narrowest meaningful checks.
6. Update docs when behavior or setup changes.

## Agent Routing

Prefer the available GSD agents for heavy workflow steps:

- `gsd-pattern-mapper` for existing code patterns before planning.
- `gsd-phase-researcher` for implementation research.
- `gsd-planner` for executable phase plans.
- `gsd-plan-checker` for plan validation.
- `gsd-executor` for implementation.
- `gsd-code-reviewer` for post-implementation review.
- `gsd-verifier` for goal-backward verification.

Use normal repo tools for small direct reads, edits, tests, and lint checks.

## Quality Bar

Every GSD-built feature should include:

- Clear user workflow.
- Data model and API contract decisions.
- Migration/backfill strategy if persisted data changes.
- UI states for empty, loading, error, draft, and active data.
- Duplicate/conflict handling when the domain can produce overlapping records.
- Tests sized to the blast radius.
- Updated docs for operators and contributors.

## Feature Notes For This Repo

This repo is a three-service airport inspection app:

- `frontend/`: Next.js App Router UI and BFF routes.
- `backend/`: FastAPI data/API service.
- `ml-service/`: CV, live detection relay, and RL endpoints.

The runway mapping feature should treat manual runway geometry as operational
data. Use manual polygons, explicit intersections/shared surfaces, observation
traceability, dedupe/merge/split review, unmapped observation handling, geometry
versioning, and map lifecycle status.
