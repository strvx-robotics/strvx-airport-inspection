// GET /api/inspections/[id]/report?format=html|json|csv|pdf — rendered inspection report.

import { getInspectionReport, renderReportCsv, renderReportHtml } from "@/lib/repo";
import { renderReportPdf } from "@/lib/reportPdf";
import { json, notFound, route, type RouteContext } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route<{ id: string }>(async (req, { params }: RouteContext<{ id: string }>) => {
  const { id } = await params;
  const report = await getInspectionReport(id);
  if (!report) return notFound(`Inspection not found: ${id}`);

  const format = new URL(req.url).searchParams.get("format") ?? "json";
  if (format === "html") {
    return new Response(renderReportHtml(report), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
  if (format === "csv") {
    return new Response(renderReportCsv(report), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="inspection-${id}.csv"`,
      },
    });
  }
  if (format === "pdf") {
    const pdf = await renderReportPdf(report);
    return new Response(new Uint8Array(pdf), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="inspection-${id}.pdf"`,
      },
    });
  }
  return json(report);
});
