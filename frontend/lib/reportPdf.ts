import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit/js/pdfkit.standalone.js";
import { getAirportReportAssets, type AirportReportAsset } from "./airportAssets";
import type { InspectionReport } from "./repo";
import type { Image, IssueCandidate } from "./types";

const INK = "#172026";
const MUTED = "#65717a";
const LINE = "#d9e0e5";
const SOFT = "#f5f8fa";
const BLUE = "#1f6f9f";
const GREEN = "#287a4d";
const AMBER = "#a86716";
const RED = "#b5423a";

const REPORT_CATEGORY: Record<string, string> = {
  fod: "Debris / FOD",
  pavement: "Pavement damage",
  marking: "Runway marking",
  lighting: "Lighting / signage",
};
// Special-inspection trigger labels (§139.327(b)) — kept local so this Node PDF
// module stays free of client-only UI imports.
const SPECIAL_TRIGGER_LABEL: Record<string, string> = {
  weather: "Severe weather",
  aircraft_incident: "Aircraft incident / accident",
  construction: "Construction activity",
  complaint: "Complaint received",
  wildlife: "Wildlife activity",
  other: "Other condition",
};
const REPORT_REVIEW_STATUSES = new Set(["pending", "manual_review"]);
const REPORT_ACTIVE_TICKET_STATUSES = new Set([
  "draft",
  "sent",
  "in_progress",
  "repaired",
  "reinspected",
]);

const titleCase = (s: string): string =>
  s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/** Human label for an inspection type, including a special-inspection trigger. */
function inspectionTypeText(insp: { type: string; trigger?: string | null }): string {
  const base = `${titleCase(insp.type)} inspection`;
  if (insp.type === "special" && insp.trigger) {
    return `${base} (${SPECIAL_TRIGGER_LABEL[insp.trigger] ?? titleCase(insp.trigger)})`;
  }
  return base;
}

const pluralize = (count: number, singular: string, plural = `${singular}s`) =>
  `${count} ${count === 1 ? singular : plural}`;

const assetFile = (publicPath: string): string =>
  path.join(process.cwd(), "public", publicPath.replace(/^\/+/, ""));

const hasAssetFile = (asset: AirportReportAsset | undefined): asset is AirportReportAsset =>
  Boolean(asset && existsSync(assetFile(asset.publicPath)));

const toArrayBuffer = (bytes: Buffer): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

const assetBytes = (publicPath: string): ArrayBuffer => toArrayBuffer(readFileSync(assetFile(publicPath)));

const issueImageBytes = (image: Image | undefined): ArrayBuffer | undefined => {
  if (!image?.fileUrl?.startsWith("/")) return undefined;
  const file = assetFile(image.fileUrl);
  return existsSync(file) ? toArrayBuffer(readFileSync(file)) : undefined;
};

const pageBounds = (doc: PDFKit.PDFDocument) => ({
  left: doc.page.margins.left,
  right: doc.page.width - doc.page.margins.right,
  top: doc.page.margins.top,
  bottom: doc.page.height - doc.page.margins.bottom - 42,
  width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
});

function setY(doc: PDFKit.PDFDocument, y: number): void {
  doc.x = doc.page.margins.left;
  doc.y = y;
}

function ensureSpace(doc: PDFKit.PDFDocument, height: number): boolean {
  const b = pageBounds(doc);
  if (doc.y + height > b.bottom) {
    doc.addPage();
    setY(doc, b.top);
    return true;
  }
  return false;
}

function reserveBlock(doc: PDFKit.PDFDocument, height: number): void {
  ensureSpace(doc, Math.min(height, pageBounds(doc).bottom - pageBounds(doc).top));
}

function rule(doc: PDFKit.PDFDocument, y = doc.y, color = LINE): void {
  const b = pageBounds(doc);
  doc.moveTo(b.left, y).lineTo(b.right, y).lineWidth(1).strokeColor(color).stroke().strokeColor(INK);
}

function fmt(report: InspectionReport, iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: report.airport.timezone || "UTC",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function statusColor(status: string): string {
  if (status === "approved" || status === "completed" || status === "pass") return GREEN;
  if (status === "pending" || status === "manual_review" || status === "needs_review") return AMBER;
  if (status === "rejected" || status === "fail" || status === "high") return RED;
  return BLUE;
}

function drawPill(doc: PDFKit.PDFDocument, text: string, x: number, y: number, color: string, width?: number): void {
  const pillWidth = width ?? Math.max(58, doc.widthOfString(text) + 18);
  doc.roundedRect(x, y, pillWidth, 18, 9).fillColor(color).fill();
  doc
    .font("Helvetica-Bold")
    .fontSize(7.5)
    .fillColor("#ffffff")
    .text(text.toUpperCase(), x, y + 5, { width: pillWidth, align: "center" });
}

function sectionTitle(doc: PDFKit.PDFDocument, title: string, subtitle?: string): void {
  reserveBlock(doc, subtitle ? 70 : 54);
  const b = pageBounds(doc);
  const y = doc.y + 10;
  rule(doc, y);
  doc.font("Helvetica-Bold").fontSize(13).fillColor(INK).text(title, b.left, y + 13, { width: b.width });
  if (subtitle) {
    doc.font("Helvetica").fontSize(8.5).fillColor(MUTED).text(subtitle, b.left, y + 31, { width: b.width });
    setY(doc, y + 48);
  } else {
    setY(doc, y + 34);
  }
}

function summarizeRunway(entry: InspectionReport["runways"][number]) {
  const reviewCount = entry.issues.filter((issue) => REPORT_REVIEW_STATUSES.has(issue.status)).length;
  const approvedCount = entry.issues.filter((issue) => issue.status === "approved").length;
  const openTickets = entry.tickets.filter((ticket) => REPORT_ACTIVE_TICKET_STATUSES.has(ticket.status)).length;
  const closedTickets = entry.tickets.filter((ticket) => ticket.status === "closed").length;
  const state =
    reviewCount > 0
      ? { label: `${pluralize(reviewCount, "finding")} awaiting review`, color: AMBER, priority: 0 }
      : openTickets > 0
        ? { label: `${pluralize(openTickets, "ticket")} active`, color: BLUE, priority: 1 }
        : entry.issues.length > 0
          ? { label: "Reviewed", color: GREEN, priority: 2 }
          : { label: "Clear", color: GREEN, priority: 3 };
  return { ...entry, ...state, reviewCount, approvedCount, openTickets, closedTickets };
}

function inspectionObjective(report: InspectionReport, runwaySummaries: ReturnType<typeof summarizeRunway>[]) {
  const checklistComplete = report.checklist.filter((item) => item.result).length;
  const remainingChecklist = Math.max(0, report.checklist.length - checklistComplete);
  const allChecklistComplete = report.checklist.length > 0 && checklistComplete === report.checklist.length;
  const reviewQueue = runwaySummaries.reduce((sum, entry) => sum + entry.reviewCount, 0);
  const activeTickets = runwaySummaries.reduce((sum, entry) => sum + entry.openTickets, 0);
  const attentionRunways = runwaySummaries.filter((entry) => entry.reviewCount > 0 || entry.openTickets > 0).length;

  const objective = !allChecklistComplete
    ? {
        title: "Finish the inspection checklist",
        detail: `${pluralize(remainingChecklist, "checklist item")} still need a response before sign-off unlocks.`,
        color: AMBER,
      }
    : !report.inspection.signedAt
      ? {
          title: "Capture inspector sign-off",
          detail: "Checklist is complete. Record the inspector attestation to finalize this pass.",
          color: BLUE,
        }
      : reviewQueue > 0
        ? {
            title: "Work the findings queue",
            detail: `${pluralize(reviewQueue, "candidate")} still require review across ${pluralize(attentionRunways, "runway")}.`,
            color: AMBER,
          }
        : activeTickets > 0
          ? {
              title: "Track active remediation",
              detail: `${pluralize(activeTickets, "ticket")} remain open from this inspection.`,
              color: BLUE,
            }
          : report.totals.issues === 0
            ? {
                title: "Inspection is clear",
                detail: `All ${pluralize(report.runways.length, "runway")} were inspected with no findings recorded.`,
                color: GREEN,
              }
            : {
                title: "Inspection record is in good shape",
                detail: "Checklist, sign-off, and runway findings are all documented.",
                color: GREEN,
              };

  return { checklistComplete, remainingChecklist, allChecklistComplete, reviewQueue, activeTickets, objective };
}

function deficiencyStatus(report: InspectionReport, reviewQueue: number): { label: string; color: string; detail: string } {
  const failedChecklist = report.checklist.filter((item) => item.result === "fail").length;
  if (failedChecklist > 0 || reviewQueue > 0) {
    return {
      label: "Discrepancies Open",
      color: AMBER,
      detail: `${pluralize(failedChecklist + reviewQueue, "item")} require inspector disposition, NOTAM review, or corrective action.`,
    };
  }
  if (report.totals.ticketsOpen > 0) {
    return {
      label: "Corrective Action Active",
      color: BLUE,
      detail: `${pluralize(report.totals.ticketsOpen, "work order")} remain open from this inspection record.`,
    };
  }
  return {
    label: "No Open Discrepancies",
    color: GREEN,
    detail: "No unresolved discrepancy is recorded for the movement-area inspection items in this report.",
  };
}

function drawTwoColumnRows(doc: PDFKit.PDFDocument, rows: Array<[string, string]>): void {
  const b = pageBounds(doc);
  const labelWidth = 128;
  for (const [label, value] of rows) {
    const rowHeight = Math.max(24, doc.heightOfString(value || "-", { width: b.width - labelWidth - 24 }) + 12);
    reserveBlock(doc, rowHeight);
    const y = doc.y;
    doc.rect(b.left, y, b.width, rowHeight).fillColor("#ffffff").fill();
    doc.moveTo(b.left, y + rowHeight).lineTo(b.right, y + rowHeight).strokeColor("#edf1f3").stroke();
    doc.font("Helvetica-Bold").fontSize(7.5).fillColor(MUTED).text(label.toUpperCase(), b.left + 8, y + 7, {
      width: labelWidth - 16,
    });
    doc.font("Helvetica").fontSize(8.3).fillColor(INK).text(value || "-", b.left + labelWidth + 8, y + 7, {
      width: b.width - labelWidth - 16,
    });
    setY(doc, y + rowHeight);
  }
}

function drawMetricCards(doc: PDFKit.PDFDocument, metrics: Array<[string, string, string]>): void {
  const b = pageBounds(doc);
  const gap = 10;
  const cardWidth = (b.width - gap * (metrics.length - 1)) / metrics.length;
  const y = doc.y;
  ensureSpace(doc, 74);

  metrics.forEach(([label, value, hint], i) => {
    const x = b.left + i * (cardWidth + gap);
    doc.roundedRect(x, y, cardWidth, 62, 6).fillColor(SOFT).fill();
    doc.roundedRect(x, y, cardWidth, 62, 6).strokeColor("#e4eaee").stroke();
    doc.font("Helvetica-Bold").fontSize(22).fillColor(INK).text(value, x + 14, y + 12, { width: cardWidth - 28 });
    doc.font("Helvetica-Bold").fontSize(7.5).fillColor(MUTED).text(label.toUpperCase(), x + 14, y + 38, {
      width: cardWidth - 28,
    });
    doc.font("Helvetica").fontSize(7).fillColor(MUTED).text(hint, x + 14, y + 49, { width: cardWidth - 28 });
  });

  setY(doc, y + 78);
}

function drawObjectivePanel(
  doc: PDFKit.PDFDocument,
  report: InspectionReport,
  runwaySummaries: ReturnType<typeof summarizeRunway>[],
): void {
  const b = pageBounds(doc);
  const { checklistComplete, remainingChecklist, allChecklistComplete, reviewQueue, activeTickets, objective } =
    inspectionObjective(report, runwaySummaries);
  ensureSpace(doc, 106);
  const y = doc.y;

  doc.roundedRect(b.left, y, b.width, 94, 7).fillColor("#fbfcfd").fill();
  doc.roundedRect(b.left, y, b.width, 94, 7).strokeColor("#d9e0e5").stroke();
  doc.rect(b.left, y, 5, 94).fillColor(objective.color).fill();
  doc.font("Helvetica-Bold").fontSize(7.5).fillColor(MUTED).text("INSPECTION OBJECTIVE", b.left + 16, y + 12);
  doc.font("Helvetica-Bold").fontSize(14).fillColor(INK).text(objective.title, b.left + 16, y + 27, {
    width: b.width - 32,
  });
  doc.font("Helvetica").fontSize(8.5).fillColor(MUTED).text(objective.detail, b.left + 16, y + 45, {
    width: b.width - 32,
  });

  const stepY = y + 70;
  const stepWidth = (b.width - 32 - 12) / 3;
  const steps: Array<[string, string]> = [
    [
      "Checklist",
      report.checklist.length === 0 ? "Not required" : allChecklistComplete ? "Complete" : `${remainingChecklist} remaining`,
    ],
    ["Sign-off", report.inspection.signedAt ? "Recorded" : allChecklistComplete ? "Ready now" : "Blocked"],
    ["Findings queue", reviewQueue > 0 ? `${reviewQueue} to review` : activeTickets > 0 ? `${activeTickets} active` : "Clear"],
  ];
  steps.forEach(([label, value], index) => {
    const x = b.left + 16 + index * (stepWidth + 6);
    doc.roundedRect(x, stepY, stepWidth, 16, 4).fillColor(SOFT).fill();
    doc.font("Helvetica-Bold").fontSize(6.8).fillColor(INK).text(label.toUpperCase(), x + 6, stepY + 5, {
      width: stepWidth / 2,
    });
    doc.font("Helvetica").fontSize(6.8).fillColor(MUTED).text(value, x + stepWidth / 2, stepY + 5, {
      width: stepWidth / 2 - 6,
      align: "right",
    });
  });

  setY(doc, y + 106);
}

function drawCover(doc: PDFKit.PDFDocument, report: InspectionReport): void {
  const assets = getAirportReportAssets(report.airport.code);
  const b = pageBounds(doc);
  const top = b.top;
  const runwaySummaries = report.runways
    .map(summarizeRunway)
    .sort(
      (a, b) =>
        a.priority - b.priority ||
        b.reviewCount - a.reviewCount ||
        b.openTickets - a.openTickets ||
        b.issues.length - a.issues.length ||
        a.runway.name.localeCompare(b.runway.name),
    );
  const findingRunways = runwaySummaries.filter((entry) => entry.issues.length > 0).length;
  const { reviewQueue } = inspectionObjective(report, runwaySummaries);
  const summaryText =
    report.totals.issues === 0
      ? "This pass is clear. No runway findings or work orders were generated."
      : `${pluralize(report.totals.issues, "finding")} were recorded across ${pluralize(
          findingRunways,
          "runway",
        )}. ${reviewQueue > 0 ? `${pluralize(reviewQueue, "candidate")} still need review.` : "All findings have already been dispositioned."}`;

  doc.rect(0, 0, doc.page.width, 96).fillColor("#eef6fa").fill();
  doc.rect(0, 0, 5, 96).fillColor(BLUE).fill();
  if (hasAssetFile(assets?.logo)) {
    doc.image(assetBytes(assets.logo.publicPath), b.left, top - 4, { fit: [155, 48] });
  }

  doc
    .font("Helvetica-Bold")
    .fontSize(20)
    .fillColor(INK)
    .text("14 CFR Part 139 Self-Inspection Record", b.left, top + 52, { width: b.width - 145 });
  drawPill(doc, titleCase(report.inspection.status), b.right - 122, top + 58, statusColor(report.inspection.status), 122);

  setY(doc, 134);
  doc.font("Helvetica-Bold").fontSize(18).fillColor(INK).text(`${report.airport.name} · ${report.airport.code}`);
  doc
    .font("Helvetica")
    .fontSize(10)
    .fillColor(MUTED)
    .text(`${inspectionTypeText(report.inspection)} · Scheduled ${fmt(report, report.inspection.scheduledTime)}`);
  doc.text(`Generated ${fmt(report, report.generatedAt)}`);
  if (report.inspection.signedAt) {
    doc.text(`Signed off by ${report.inspection.signatureName || report.inspection.signedBy || "-"} · ${fmt(report, report.inspection.signedAt)}`);
  } else {
    doc.text("Not yet signed off");
  }
  doc.font("Helvetica").fontSize(9).fillColor(INK).text(summaryText, b.left, doc.y + 6, {
    width: b.width,
  });

  setY(doc, doc.y + 14);
  drawMetricCards(doc, [
    [
      "Checklist",
      report.checklist.length === 0
        ? "N/A"
        : `${report.checklist.filter((item) => item.result).length}/${report.checklist.length}`,
      report.checklist.length === 0 ? "No self-check items" : "Required before sign-off",
    ],
    ["Runways", String(report.runways.length), findingRunways > 0 ? `${findingRunways} with findings` : "No findings recorded"],
    ["Awaiting review", String(reviewQueue), reviewQueue > 0 ? "Immediate review queue" : "No unresolved candidates"],
    ["Tickets open", String(report.totals.ticketsOpen), report.totals.ticketsCompleted > 0 ? `${report.totals.ticketsCompleted} completed` : "No maintenance queue yet"],
  ]);
  drawObjectivePanel(doc, report, runwaySummaries);
}

function drawInspectionRecord(doc: PDFKit.PDFDocument, report: InspectionReport): void {
  const runwaySummaries = report.runways.map(summarizeRunway);
  const { reviewQueue } = inspectionObjective(report, runwaySummaries);
  const deficiency = deficiencyStatus(report, reviewQueue);
  const failedChecklist = report.checklist.filter((item) => item.result === "fail").length;
  const passChecklist = report.checklist.filter((item) => item.result === "pass").length;
  const naChecklist = report.checklist.filter((item) => item.result === "na").length;
  const signedBy = report.inspection.signatureName || report.inspection.signedBy;

  sectionTitle(
    doc,
    "Inspection Record",
    `Part 139-style ${titleCase(report.inspection.type)} self-inspection summary for retained airport operations documentation.`,
  );

  const b = pageBounds(doc);
  reserveBlock(doc, 76);
  const y = doc.y;
  doc.roundedRect(b.left, y, b.width, 62, 6).fillColor("#fbfcfd").fill();
  doc.roundedRect(b.left, y, b.width, 62, 6).strokeColor("#d9e0e5").stroke();
  doc.rect(b.left, y, 5, 62).fillColor(deficiency.color).fill();
  doc.font("Helvetica-Bold").fontSize(8).fillColor(MUTED).text("AIRFIELD CONDITION STATUS", b.left + 16, y + 11);
  doc.font("Helvetica-Bold").fontSize(14).fillColor(INK).text(deficiency.label, b.left + 16, y + 27, {
    width: 210,
  });
  doc.font("Helvetica").fontSize(8.5).fillColor(MUTED).text(deficiency.detail, b.left + 244, y + 15, {
    width: b.width - 260,
  });
  setY(doc, y + 76);

  drawTwoColumnRows(doc, [
    ["Airport", `${report.airport.name} (${report.airport.code}) - ${report.airport.location}`],
    ["Inspection type", `${inspectionTypeText(report.inspection)}${report.inspection.reason ? ` - ${report.inspection.reason}` : ""}`],
    ["Scheduled / window", `${fmt(report, report.inspection.scheduledTime)} - ${titleCase(report.inspection.window)}`],
    ["Generated", fmt(report, report.generatedAt)],
    ["Coverage", `${pluralize(report.runways.length, "runway")} / ${pluralize(report.images.length, "inspection image")} / ${pluralize(report.totals.issues, "recorded finding")}`],
    ["Checklist results", `${passChecklist} pass / ${failedChecklist} fail / ${naChecklist} N/A / ${Math.max(0, report.checklist.length - passChecklist - failedChecklist - naChecklist)} blank`],
    ["Inspector attestation", signedBy && report.inspection.signedAt ? `${signedBy} - ${fmt(report, report.inspection.signedAt)}` : "Not yet signed"],
  ]);
}

function drawChecklist(doc: PDFKit.PDFDocument, report: InspectionReport): void {
  if (!report.checklist.length) return;

  sectionTitle(
    doc,
    "Movement-Area Self-Inspection Checklist",
    "Pass/fail/N/A entries are retained with notes and evidence references where recorded.",
  );
  const b = pageBounds(doc);
  const widths = [260, 76, b.width - 260 - 76];

  const drawHeader = () => {
    const headerY = doc.y;
    doc.rect(b.left, headerY, b.width, 18).fillColor("#eaf1f5").fill();
    ["Inspection Item", "Result", "Notes / Evidence"].forEach((label, i) => {
      const x = b.left + widths.slice(0, i).reduce((sum, w) => sum + w, 0);
      doc.font("Helvetica-Bold").fontSize(7).fillColor(MUTED).text(label.toUpperCase(), x + 8, headerY + 5.5, {
        width: widths[i] - 16,
      });
    });
    setY(doc, headerY + 18);
  };

  reserveBlock(doc, 52);
  drawHeader();

  for (const item of report.checklist) {
    const result = item.result ? (item.result === "na" ? "N/A" : titleCase(item.result)) : "-";
    const notes = [item.notes || "-", item.imageId ? `Evidence image: ${item.imageId}` : ""].filter(Boolean).join("\n");
    const rowHeight = Math.max(
      21,
      doc.heightOfString(item.label, { width: widths[0] - 16 }) + 8,
      doc.heightOfString(notes, { width: widths[2] - 16 }) + 8,
    );
    if (ensureSpace(doc, rowHeight + 26)) drawHeader();
    const y = doc.y;
    doc.rect(b.left, y, b.width, rowHeight).fillColor("#ffffff").fill();
    doc.moveTo(b.left, y + rowHeight).lineTo(b.right, y + rowHeight).strokeColor("#edf1f3").stroke();
    doc.font("Helvetica").fontSize(8).fillColor(INK).text(item.label, b.left + 8, y + 5, { width: widths[0] - 16 });
    doc.font("Helvetica-Bold").fontSize(8).fillColor(statusColor(item.result ?? "")).text(result, b.left + widths[0] + 8, y + 5, {
      width: widths[1] - 16,
    });
    doc.font("Helvetica").fontSize(8).fillColor(MUTED).text(notes, b.left + widths[0] + widths[1] + 8, y + 5, {
      width: widths[2] - 16,
    });
    setY(doc, y + rowHeight);
  }
}

function issueLabel(issue: IssueCandidate): string {
  return REPORT_CATEGORY[issue.category] ?? titleCase(issue.category);
}

function drawIssuesTable(doc: PDFKit.PDFDocument, issues: IssueCandidate[], imageById: Map<string, Image>): void {
  const b = pageBounds(doc);
  const widths = [62, 100, 72, 44, 54, 62, b.width - 62 - 100 - 72 - 44 - 54 - 62];
  const labels = ["Evidence", "Discrepancy", "Location", "Conf.", "Severity", "Status", "Action / Notes"];
  const headerHeight = 22;
  const rowHeightFor = (issue: IssueCandidate): number => {
    const location = [
      issue.zone ?? "Unzoned",
      issue.stationM != null ? `${Math.round(issue.stationM)} m` : "",
      issue.lateralOffsetM != null ? `${issue.lateralOffsetM.toFixed(1)} m lateral` : "",
    ].filter(Boolean).join("\n");
    const actionText = [
      issue.ticketId ? `Work order: ${issue.ticketId}` : "No work order linked",
      issue.inspectorNotes || issue.draft || issue.modelNotes || "",
    ].filter(Boolean).join("\n");
    return Math.max(
      58,
      doc.heightOfString(location, { width: widths[2] - 14 }) + 18,
      doc.heightOfString(actionText, { width: widths[6] - 14 }) + 18,
    );
  };

  const drawHeader = () => {
    let y = doc.y;
    doc.rect(b.left, y, b.width, headerHeight).fillColor("#eaf1f5").fill();
    labels.forEach((label, i) => {
      const x = b.left + widths.slice(0, i).reduce((sum, w) => sum + w, 0);
      doc.font("Helvetica-Bold").fontSize(7).fillColor(MUTED).text(label.toUpperCase(), x + 7, y + 7, {
        width: widths[i] - 14,
      });
    });
    setY(doc, y + headerHeight);
  };

  reserveBlock(doc, headerHeight + (issues[0] ? rowHeightFor(issues[0]) : 36) + 12);
  drawHeader();

  for (const issue of issues) {
    const evidence = issue.imageId ? issueImageBytes(imageById.get(issue.imageId)) : undefined;
    const location = [
      issue.zone ?? "Unzoned",
      issue.stationM != null ? `${Math.round(issue.stationM)} m` : "",
      issue.lateralOffsetM != null ? `${issue.lateralOffsetM.toFixed(1)} m lateral` : "",
    ].filter(Boolean).join("\n");
    const actionText = [
      issue.ticketId ? `Work order: ${issue.ticketId}` : "No work order linked",
      issue.inspectorNotes || issue.draft || issue.modelNotes || "",
    ].filter(Boolean).join("\n");
    const rowHeight = rowHeightFor(issue);
    if (ensureSpace(doc, rowHeight + headerHeight + 12)) drawHeader();
    const y = doc.y;

    doc.rect(b.left, y, b.width, rowHeight).fillColor("#ffffff").fill();
    if (evidence) {
      try {
        doc.image(evidence, b.left + 7, y + 7, { fit: [48, rowHeight - 14], align: "center", valign: "center" });
      } catch {
        doc.font("Helvetica").fontSize(7.5).fillColor(MUTED).text("Image unavailable", b.left + 7, y + 19, { width: 48 });
      }
    } else {
      doc.roundedRect(b.left + 7, y + 7, 48, rowHeight - 14, 4).fillColor(SOFT).fill();
      doc.font("Helvetica").fontSize(7.5).fillColor(MUTED).text("No image", b.left + 7, y + 20, { width: 48, align: "center" });
    }

    let x = b.left + widths[0];
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor(INK).text(issueLabel(issue), x + 7, y + 9, { width: widths[1] - 14 });
    doc.font("Helvetica").fontSize(7.5).fillColor(MUTED).text(issue.modelNotes || issue.draft || "", x + 7, y + 23, {
      width: widths[1] - 14,
      height: rowHeight - 28,
    });

    x += widths[1];
    doc.font("Helvetica").fontSize(8).fillColor(INK).text(location || "-", x + 7, y + 10, { width: widths[2] - 14 });
    x += widths[2];
    doc.font("Helvetica-Bold").fontSize(8).fillColor(INK).text(`${(issue.confidence * 100).toFixed(0)}%`, x + 7, y + 10, {
      width: widths[3] - 14,
    });
    x += widths[3];
    doc.font("Helvetica-Bold").fontSize(8).fillColor(statusColor(issue.severity)).text(titleCase(issue.severity), x + 7, y + 10, {
      width: widths[4] - 14,
    });
    x += widths[4];
    doc.font("Helvetica").fontSize(8).fillColor(INK).text(titleCase(issue.status), x + 7, y + 10, { width: widths[5] - 14 });
    x += widths[5];
    doc.font("Helvetica").fontSize(7.5).fillColor(INK).text(actionText, x + 7, y + 10, {
      width: widths[6] - 14,
      height: rowHeight - 18,
    });

    doc.moveTo(b.left, y + rowHeight).lineTo(b.right, y + rowHeight).strokeColor("#edf1f3").stroke();
    setY(doc, y + rowHeight);
  }
}

function drawRunwaySections(doc: PDFKit.PDFDocument, report: InspectionReport): void {
  const imageById = new Map(report.images.map((image) => [image.id, image]));
  const runwaySummaries = report.runways
    .map(summarizeRunway)
    .sort(
      (a, b) =>
        a.priority - b.priority ||
        b.reviewCount - a.reviewCount ||
        b.openTickets - a.openTickets ||
        b.issues.length - a.issues.length ||
        a.runway.name.localeCompare(b.runway.name),
    );
  const findingRunways = runwaySummaries.filter((entry) => entry.issues.length > 0);
  const clearRunways = runwaySummaries.filter((entry) => entry.issues.length === 0);

  sectionTitle(
    doc,
    "Runway / Movement-Area Discrepancies",
    "Runways with discrepancies appear first. Clear runways are retained at the end for documented coverage.",
  );

  for (const { runway, issues, reviewCount, approvedCount, openTickets, closedTickets } of findingRunways) {
    const high = issues.filter((issue) => issue.severity === "high").length;
    sectionTitle(
      doc,
      `${runway.name} ${runway.designation}`,
      `${pluralize(issues.length, "discrepancy")} - ${high} high severity - ${reviewCount} awaiting review`,
    );

    drawMetricCards(doc, [
      ["Awaiting review", String(reviewCount), "Candidates needing action"],
      ["Approved", String(approvedCount), "Reviewed findings"],
      ["Active tickets", String(openTickets), "Maintenance still open"],
      ["Closed tickets", String(closedTickets), "Resolved work orders"],
    ]);

    drawIssuesTable(doc, issues, imageById);
    setY(doc, doc.y + 8);
  }

  if (clearRunways.length) {
    sectionTitle(
      doc,
      "Clear Runways",
      `${clearRunways.length} runway(s) completed this pass with no recorded findings.`,
    );
    const b = pageBounds(doc);
    for (const { runway } of clearRunways) {
      ensureSpace(doc, 32);
      const y = doc.y;
      doc.roundedRect(b.left, y, b.width, 26, 5).fillColor(SOFT).fill();
      doc.font("Helvetica-Bold").fontSize(8.5).fillColor(INK).text(`${runway.name} ${runway.designation}`, b.left + 12, y + 8, {
        width: b.width * 0.45,
      });
      doc.font("Helvetica").fontSize(8).fillColor(MUTED).text("Inspected - no discrepancies recorded during this pass.", b.left + b.width * 0.45, y + 8, {
        width: b.width * 0.55 - 12,
        align: "right",
      });
      setY(doc, y + 32);
    }
  }
}

function drawCorrectiveActions(doc: PDFKit.PDFDocument, report: InspectionReport): void {
  const tickets = report.runways.flatMap((entry) =>
    entry.tickets.map((ticket) => ({
      ...ticket,
      runwayLabel: `${entry.runway.name} ${entry.runway.designation}`,
    })),
  );
  if (!tickets.length) return;

  sectionTitle(
    doc,
    "Corrective Action Log",
    "Maintenance work orders generated from this inspection and retained with current status.",
  );
  const b = pageBounds(doc);
  const widths = [80, 78, 78, 86, b.width - 80 - 78 - 78 - 86];
  const headerHeight = 20;
  const drawHeader = () => {
    const y = doc.y;
    doc.rect(b.left, y, b.width, headerHeight).fillColor("#eaf1f5").fill();
    ["Work order", "Runway", "Severity", "Status", "Corrective action / notes"].forEach((label, i) => {
      const x = b.left + widths.slice(0, i).reduce((sum, w) => sum + w, 0);
      doc.font("Helvetica-Bold").fontSize(7).fillColor(MUTED).text(label.toUpperCase(), x + 7, y + 6, {
        width: widths[i] - 14,
      });
    });
    setY(doc, y + headerHeight);
  };

  reserveBlock(doc, 56);
  drawHeader();
  for (const ticket of tickets) {
    const notes = [
      ticket.description,
      ticket.maintenanceNotes ? `Maintenance notes: ${ticket.maintenanceNotes}` : "",
      ticket.repairedAt ? `Repaired: ${fmt(report, ticket.repairedAt)}` : "",
      ticket.closedAt ? `Closed: ${fmt(report, ticket.closedAt)}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    const rowHeight = Math.max(36, doc.heightOfString(notes, { width: widths[4] - 14 }) + 16);
    if (ensureSpace(doc, rowHeight + headerHeight + 10)) drawHeader();
    const y = doc.y;
    const values = [
      ticket.id,
      ticket.runwayLabel,
      titleCase(ticket.severity),
      titleCase(ticket.status),
      notes || "-",
    ];
    doc.rect(b.left, y, b.width, rowHeight).fillColor("#ffffff").fill();
    values.forEach((value, i) => {
      const x = b.left + widths.slice(0, i).reduce((sum, w) => sum + w, 0);
      doc
        .font(i === 0 ? "Helvetica-Bold" : "Helvetica")
        .fontSize(7.8)
        .fillColor(i === 2 ? statusColor(ticket.severity) : INK)
        .text(value, x + 7, y + 8, { width: widths[i] - 14, height: rowHeight - 14 });
    });
    doc.moveTo(b.left, y + rowHeight).lineTo(b.right, y + rowHeight).strokeColor("#edf1f3").stroke();
    setY(doc, y + rowHeight);
  }
}

function linkedText(doc: PDFKit.PDFDocument, label: string, url: string, x: number, y: number, width: number): void {
  doc.font("Helvetica").fontSize(8).fillColor(BLUE).text(label, x, y, { width, link: url, underline: true });
  doc.fillColor(INK);
}

function drawAssetSources(doc: PDFKit.PDFDocument, assets: ReturnType<typeof getAirportReportAssets>): void {
  if (!assets) return;
  const rows = [assets.logo, assets.terminalMap, assets.airportDiagram].filter(Boolean) as AirportReportAsset[];
  if (!rows.length) return;

  sectionTitle(doc, "Reference Assets", "Airport-supplied and FAA reference material included with this report.");
  const b = pageBounds(doc);
  if (hasAssetFile(assets.terminalMap)) {
    ensureSpace(doc, 208);
    const y = doc.y;
    doc.roundedRect(b.left, y, b.width, 196, 6).fillColor(SOFT).fill();
    doc.image(assetBytes(assets.terminalMap.publicPath), b.left + 12, y + 10, { fit: [b.width - 24, 160], align: "center" });
    doc.font("Helvetica").fontSize(8).fillColor(MUTED).text(assets.terminalMap.label, b.left + 12, y + 176, { width: b.width - 24 });
    setY(doc, y + 208);
  }

  for (const asset of rows) {
    ensureSpace(doc, 55);
    const y = doc.y;
    doc.roundedRect(b.left, y, b.width, 45, 5).strokeColor("#e4eaee").stroke();
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor(INK).text(asset.label, b.left + 12, y + 9, { width: 170 });
    linkedText(doc, asset.sourceName, asset.sourceUrl, b.left + 192, y + 9, 150);
    doc.font("Helvetica").fontSize(7.5).fillColor(MUTED).text(`Cached: ${asset.publicPath}`, b.left + 352, y + 9, { width: b.width - 364 });
    doc.text(`Retrieved ${asset.retrievedAt}${asset.licenseNote ? ` · ${asset.licenseNote}` : ""}`, b.left + 352, y + 22, {
      width: b.width - 364,
    });
    setY(doc, y + 54);
  }
}

function drawFooters(doc: PDFKit.PDFDocument, report: InspectionReport): void {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const b = {
      left: doc.page.margins.left,
      right: doc.page.width - doc.page.margins.right,
      width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
    };
    const y = doc.page.height - doc.page.margins.bottom - 16;
    doc.moveTo(b.left, y - 8).lineTo(b.right, y - 8).lineWidth(1).strokeColor("#e6ebef").stroke().strokeColor(INK);
    doc.font("Helvetica").fontSize(7.5).fillColor(MUTED).text(`${report.airport.code} inspection report`, b.left, y, {
      width: b.width / 2,
    });
    doc.text(
      `Page ${i + 1} of ${range.count} · Retain ≥12 months (14 CFR §139.327)`,
      b.left + b.width / 2,
      y,
      { width: b.width / 2, align: "right" },
    );
  }
}

export async function renderReportPdf(report: InspectionReport): Promise<Buffer> {
  const assets = getAirportReportAssets(report.airport.code);
  const doc = new PDFDocument({
    size: "LETTER",
    margin: 44,
    bufferPages: true,
    info: {
      Title: `Inspection report - ${report.airport.code}`,
      Author: "STRVX Runway Inspection",
      Subject: `${report.airport.name} runway inspection`,
    },
  });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk: Buffer | Uint8Array) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  drawCover(doc, report);
  doc.addPage();
  drawInspectionRecord(doc, report);
  drawChecklist(doc, report);
  drawRunwaySections(doc, report);
  drawCorrectiveActions(doc, report);
  drawAssetSources(doc, assets);
  drawFooters(doc, report);

  doc.end();
  return done;
}
