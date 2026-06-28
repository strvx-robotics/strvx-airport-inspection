// LLM ticket drafting (design §13.2).
//
// draftTicket() turns a detection into a short, maintenance-ready ticket
// description. When ANTHROPIC_API_KEY is set it asks Claude (Haiku) for the
// wording; otherwise — and on ANY error — it falls back to a deterministic
// template so the app runs with no key and never throws.
//
// The returned string becomes the IMMUTABLE ai_draft_text on the IssueCandidate;
// the inspector edits a separate `draft`, and the git-style diff between the two
// is the learning signal.

import Anthropic from "@anthropic-ai/sdk";
import type { IssueCategory, Severity } from "./types";

export interface DraftContext {
  category: IssueCategory;
  confidence: number;
  severity?: Severity;
  runwayDesignation?: string;
  zoneName?: string;
  sizeM?: number;
  stationM?: number;
  modelNotes?: string;
}

const CATEGORY_LABEL: Record<IssueCategory, string> = {
  fod: "Debris / FOD",
  pavement: "Pavement damage",
  marking: "Runway marking",
  lighting: "Lighting / signage",
};

const ACTION: Record<IssueCategory, string> = {
  fod: "Dispatch a FOD sweep and remove the object before the next operating window.",
  pavement: "Crack-seal and inspect the surrounding surface before returning the runway to service.",
  marking: "Schedule remarking of the affected segment to restore visibility.",
  lighting: "Inspect and repair or replace the affected fixture before night operations.",
};

const pct = (c: number): string => `${Math.round(c * 100)}%`;

/** Deterministic, no-network draft. Also the fallback when the LLM is unavailable. */
export function templateDraft(ctx: DraftContext): string {
  const where = ctx.zoneName ? ` in ${ctx.zoneName}` : "";
  const rwy = ctx.runwayDesignation ? ` on runway ${ctx.runwayDesignation}` : "";
  const size = ctx.sizeM != null ? ` (~${ctx.sizeM} m)` : "";
  const sev = ctx.severity ? `${ctx.severity} severity` : "severity TBD";
  const detail = ctx.modelNotes ? ` ${ctx.modelNotes}` : "";
  return (
    `${CATEGORY_LABEL[ctx.category]} detected${rwy}${where}${size} ` +
    `at ${pct(ctx.confidence)} confidence (${sev}).${detail} ${ACTION[ctx.category]}`
  ).trim();
}

function buildPrompt(ctx: DraftContext): string {
  const lines = [
    `Category: ${CATEGORY_LABEL[ctx.category]}`,
    `Detection confidence: ${pct(ctx.confidence)}`,
    ctx.severity ? `Model severity: ${ctx.severity}` : undefined,
    ctx.runwayDesignation ? `Runway: ${ctx.runwayDesignation}` : undefined,
    ctx.zoneName ? `Zone: ${ctx.zoneName}` : undefined,
    ctx.sizeM != null ? `Estimated size: ${ctx.sizeM} m` : undefined,
    ctx.stationM != null ? `Station: ${ctx.stationM} m` : undefined,
    ctx.modelNotes ? `Detector notes: ${ctx.modelNotes}` : undefined,
  ].filter(Boolean);

  return (
    "You are an FAA-savvy airfield maintenance assistant. Draft a concise " +
    "maintenance ticket description (2–3 sentences) for the runway inspection " +
    "finding below. State what was found and where, then a clear recommended " +
    "action. Plain text only — no preamble, headings, or markdown.\n\n" +
    lines.join("\n")
  );
}

/**
 * Draft a ticket description for a detection. Uses Claude (claude-haiku-4-5) when
 * ANTHROPIC_API_KEY is present; otherwise returns the deterministic template.
 * Never throws — any SDK/network error falls back to the template.
 */
export async function draftTicket(ctx: DraftContext): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY) return templateDraft(ctx);

  try {
    const client = new Anthropic();
    const msg = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 512,
      messages: [{ role: "user", content: buildPrompt(ctx) }],
    });
    const block = msg.content[0];
    if (block && block.type === "text") {
      const text = block.text.trim();
      if (text) return text;
    }
    return templateDraft(ctx);
  } catch {
    return templateDraft(ctx);
  }
}
