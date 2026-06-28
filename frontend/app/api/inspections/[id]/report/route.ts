// GET /api/inspections/[id]/report?format=html|json — rendered inspection report.

import { getInspectionReport, renderReportHtml } from "@/lib/repo";
import { json, notFound, route, type RouteContext } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route<{ id: string }>(async (req, { params }: RouteContext<{ id: string }>) => {
  const { id } = await params;
  const report = await getInspectionReport(id);
  if (!report) return notFound(`Inspection not found: ${id}`);

  const format = new URL(req.url).searchParams.get("format") ?? "json";
  if (format === "html") {
    return new Response(await renderReportHtml(report), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
  return json(report);
});
