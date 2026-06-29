# STRVX Tooling Decision Memo — CTO to Founders

> Produced by a 6-domain web-research pass (realtime streaming, labeling/MLOps, GPU, edge/drone, RLHF/eval, datasets) with 2026 pricing/capability verification, then synthesized. Skeptical and STRVX-specific (small team, one-airport pilot, cost-sensitive).

**TL;DR:** For the one-airport pilot, we buy almost nothing new. The biggest "we need X" instincts (LiveKit for latency, edge compute, a fine-tuned writer LLM) are premature. The two purchases that actually move the needle: **Roboflow Core ($79/mo)** to cold-start runway-specific YOLO weights from our review-loop feedback, and a **DJI Mavic 3 Enterprise (~$3–6k one-time)** to get programmatic control our consumer Mavic categorically cannot do. Everything else is either already in our stack (MediaMTX) or a deliberate "later."

## 1. Recommended stack (pilot scale)

| Area | Pick | Why | Effort | ~$/mo at pilot |
|---|---|---|---|---|
| **Realtime video** | Keep **MediaMTX**, flip Live page HLS→WHEP + WebSocket overlay relay | Sub-second latency today, zero new infra; worker already reads frames server-side off RTSP | LOW | $0 |
| **Labeling / MLOps** | **Roboflow Core** (never Public tier) | Only tool that cold-starts labels with zero data (Auto Label / Grounding DINO), versions, trains YOLOv11, exports `best.pt` straight into our `*_MODEL_PATH` slots | LOW | $79 + overage |
| **— OSS fallback** | Label Studio + FiftyOne + Ultralytics | On-prem if data-residency kills the hosted vendor | MED | ~$0 |
| **Cold-start dataset** | **UAV-PDD2023** (+ RDD2022, self-supervised clean-runway FOD) | Only public set matching our nadir UAV pavement geometry | LOW | $0 |
| **GPU train + serve** | **Modal** | One Python SDK does ad-hoc YOLO training *and* scale-to-zero inference; free credits cover the pilot | LOW | ~$20–40 |
| **— fallback** | RunPod | Cheaper raw GPU once utilization favors a dedicated pod | MED | ~$25–43 |
| **Writer LLM / eval** | **Langfuse** (keep Claude; defer DPO) | LLM-as-judge evals to *gate* RL promotion; MIT, self-hosts on our Postgres+S3 | LOW | $0–29 |
| **— FT later** | Fireworks (DPO) | Cheapest managed LoRA, no idle GPU bill — when pairs ≳ few hundred | LOW-MED | usage |
| **Edge / drone** | **DJI Mavic 3 Enterprise** + cloud inference (no edge) | Unlocks scripted transects + clean ingest; consumer Mavic has *zero* SDK | LOW-MED | ~$3–6k one-time |
| **— edge prototype** | Jetson Orin Nano Super | $249, YOLO recompiles to TensorRT near-zero change — only if we must prototype edge | LOW-MED | $249 one-time |

**All-in recurring pilot cost: roughly $100–150/mo** + ~$3–6k one-time airframe.

## 2. Highest-leverage tool per gap

1. **Low-latency live video + data channels → MediaMTX + WHEP (already own it).** MediaMTX already does sub-second WebRTC/WHEP. "We need LiveKit for latency" is false. The only real gap is a bidirectional data channel + rooms/auth — solved for a handful of operators by a thin WebSocket relay off the app, which already receives the worker's frames/events. LiveKit is the *graduation* target (real ops room, multi-site, drone teleop), not a pilot buy.
2. **Labeling → fine-tuned runway YOLO → Roboflow Core.** With zero labeled imagery, the cold-start (Grounding DINO auto-label from text prompts) is the thing nothing else does well. Exports a `best.pt` that drops into our pluggable `*_MODEL_PATH` slots with zero code change.
3. **GPU train + inference serving → Modal.** Matches our FastAPI/Python service 1:1; per-second scale-to-zero fits the bursty, idle-between-flights shape. Free credits cover the pilot.
4. **Writer LLM fine-tuning → Langfuse (eval/gate), NOT a fine-tune yet.** We have no volume and Claude drafts are already strong (human edits are small). The cheapest win is *measuring and gating* the RL promotion step on a no-regression judge eval — not training a new writer. DPO on Fireworks comes later.
5. **Edge vs cloud + DJI → DJI Mavic 3 Enterprise, stay cloud.** Inspection is human-in-the-loop, not closed-loop control — a 1–3s cloud round-trip is fine, so edge solves a problem we don't have. The airframe is the move: the consumer Mavic supports no SDK; Enterprise unlocks scripted missions and clean stream ingest while keeping 100% of our cloud stack.

## 3. Build vs buy (small team)

- **Realtime video — BUILD (thin).** We own MediaMTX; a small WebSocket relay beats LiveKit's operational tax (SFU + Redis + TURN) for a few operators.
- **Labeling/MLOps — BUY (Roboflow).** The cold-start auto-label + training pipeline is months to replicate. Keep the OSS stack documented as an exit.
- **GPU — BUY (Modal).** Never run our own GPU boxes at pilot scale.
- **Datasets — BUY/FREE + BUILD the labeler.** Public sets are free pre-trainers; the real runway dataset is *built* by routing our review loop back as labels.
- **Writer eval — BUY-as-OSS (Langfuse).** Don't build an eval harness.
- **Edge — BUY hardware, BUILD nothing.** Defer all edge engineering.

## 4. Phased rollout

**NOW (pilot, next 1–2 quarters):**
- Flip Live page HLS→WHEP; add WebSocket overlay relay (MediaMTX, $0).
- Buy **Roboflow Core**; wire feedback-export → dataset → `best.pt`. Pre-train on UAV-PDD2023 + RDD2022; stand up self-supervised clean-runway FOD.
- Adopt **Modal** for training + inference (free credits).
- Adopt **Langfuse**; gate the RL reranker promotion on judge evals.
- Procure **one DJI Mavic 3 Enterprise**; keep cloud inference. Start collecting our own marking/lighting passes (zero public data exists for these).

**LATER (scale / multi-airport):**
- **LiveKit** when we need a true multi-operator ops room, multi-site, or drone teleop.
- **Fireworks DPO** once we cross ~a few hundred clean preference pairs and Claude+reranking plateaus; hold **HF TRL** as the OSS exit.
- **DJI Dock 3 / Matrice 4D** (~10 TOPS onboard + Edge SDK) *if* we go pilot-less autonomous — the right edge home, not a bespoke Jetson rig.
- **RunPod** if utilization beats Modal's per-second; **W&B** only at many-experiments scale.

## 5. Top 3 risks / lock-in traps

1. **Roboflow data-publicity + hosted lock-in.** The free Public tier **publishes our imagery on Roboflow Universe — unacceptable for airport security.** Mandate Core, meter credit burn, and keep the Label Studio + FiftyOne + Ultralytics OSS path documented so hosted training is never a one-way door.
2. **DJI procurement gate (NDAA/FCC).** As of Dec 2025 the FCC put all new foreign UAS on the Covered List — existing DJI stays legal to fly, but **new DJI hardware can't clear import/sale**, and many airport/AIP-funded operators already restrict DJI. Fine to fly DJI for the pilot; do **not** architect the multi-airport roadmap on buying *new* DJI docks without a compliance answer (validate Skydio / BRINC / Anzu).
3. **Fine-tuning vendor instability + dataset copyleft.** OpenPipe (→CoreWeave, stops new jobs Jul 2026) and Predibase (→Rubrik) both churned — **don't build on either.** Use Fireworks with HF TRL as the OSS exit. **RDD2022 is CC BY-SA (ShareAlike)** — derivative images must be re-shared; get counsel before baking it into shipped weights, and treat FOD-A as non-commercial until verified.

## Where the research was thin / contested
- **LiveKit** server-side frame access is via SDK `VideoStream`, not egress — fine for us, but *not* a clean drop-in for our RTSP frame-pull, so the "graduation" migration is real work, not a flip.
- **Roboflow** credit pricing can balloon with training/inference volume — $79 is a floor, not a ceiling; meter it.
- **Public dataset licenses** (FOD-A non-commercial, RDD2022 copyleft, AssistTaxi unstated) are genuinely unsettled and need legal sign-off before commercial weights ship.
