// GET /api/inspections/[id]/report?format=html|json|csv|pdf — rendered inspection report.

import { getInspectionReport, renderReportCsv, renderReportHtml } from "@/lib/repo";
import { renderReportPdf } from "@/lib/reportPdf";
import { json, notFound, route, type RouteContext } from "@/lib/http";
import { evaluateCompleteness } from "@/lib/compliance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route<{ id: string }>(async (req, { params }: RouteContext<{ id: string }>) => {
  const { id } = await params;
  const report = await getInspectionReport(id);
  if (!report) return notFound(`Inspection not found: ${id}`);

  const format = new URL(req.url).searchParams.get("format") ?? "json";
  const finality = evaluateCompleteness({
    checklistTotal: report.checklist.length,
    checklistAnswered: report.checklist.filter((item) => item.result).length,
    signedAt: report.inspection.signedAt,
    attestation: report.inspection.attestation,
    completedAt: report.inspection.completedAt,
  });
  if (format !== "json" && !finality.isFinal) {
    return json(
      {
        error: `Export blocked: this inspection is not a final compliance record (${finality.missing.join(", ")}).`,
        missing: finality.missing,
      },
      { status: 409 },
    );
  }
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
