// GET /api/feedback-export — admin learning export.
//
// Streams JSONL: one {type:"rejection", ...} record per rejected candidate plus
// one {type:"draft_pair", ...} record per ai_draft_text → final-text pair
// (design §13.4). Served as application/x-ndjson for download.

import { exportFeedbackJsonl } from "@/lib/repo";
import { route } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const body = await exportFeedbackJsonl();
  return new Response(body, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "content-disposition": 'attachment; filename="strvx-feedback.jsonl"',
    },
  });
});
