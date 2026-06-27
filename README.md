# STRVX Airport — AI Runway Inspection

Drone-assisted runway inspection for airport operations teams. A drone flies each
runway before the first commercial flights, an AI flags possible issues, a human
inspector reviews them, and approved findings become maintenance tickets — with a
**feedback loop that makes the system better every time an inspector corrects it.**

> Standalone hackathon build. Single Next.js full-stack app (UI + API + SQLite),
> one command to run. The autonomy/CV core migrates into the Valanor multi-drone
> product later; this repo is the self-contained product slice.

## The loop

```
Schedule (6 AM) → drone captures runway images → AI detects issues
   → reviewable issue cards → inspector approves / rejects / edits
   → approved → maintenance ticket → repaired → reinspected → closed
```

**Four issue categories:** Debris/FOD · Pavement damage · Runway markings · Lighting/signage.

## Self-improving (why this is more than a CRUD app)

Every human decision is captured as a training signal:

- **Rejections require a reason** (`not_an_issue`, `wrong_category`, …) → hard-negative
  mining + threshold recalibration for the detector.
- **The AI's ticket draft is preserved immutably** next to the inspector's final text;
  the **diff** between them trains the ticket-writer (few-shot now, SFT/DPO later).
- An admin **feedback export** emits the accumulated learning records as JSONL.

## Stack

Next.js (App Router) · TypeScript · Tailwind · SQLite · server-side LLM drafting
(Anthropic, with a templated fallback so it runs with no API key).

## Run

```bash
npm run setup     # installs frontend deps
npm run dev       # → http://localhost:3000
```

Optional, for real LLM-drafted tickets: set `ANTHROPIC_API_KEY` in `frontend/.env.local`
(otherwise drafts use a deterministic template).

## Status

MVP — human-in-the-loop review with a stubbed detector and real persistence. Real
CV detectors, drone flight integration, and the offline training pipeline are the
next milestones (see `docs/`).
