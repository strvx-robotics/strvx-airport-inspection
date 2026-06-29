import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit/js/pdfkit.standalone.js";
import { getAirportReportAssets, type AirportReportAsset } from "./airportAssets";
import type { InspectionReport } from "./repo";

const REPORT_CATEGORY: Record<string, string> = {
  fod: "Debris / FOD",
  pavement: "Pavement damage",
  marking: "Runway marking",
  lighting: "Lighting / signage",
};

const titleCase = (s: string): string =>
  s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

const assetFile = (publicPath: string): string =>
  path.join(process.cwd(), "public", publicPath.replace(/^\/+/, ""));

const hasAssetFile = (asset: AirportReportAsset | undefined): asset is AirportReportAsset =>
  Boolean(asset && existsSync(assetFile(asset.publicPath)));

const assetBytes = (publicPath: string): ArrayBuffer => {
  const bytes = readFileSync(assetFile(publicPath));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};

function drawRule(doc: PDFKit.PDFDocument): void {
  doc
    .moveTo(doc.page.margins.left, doc.y)
    .lineTo(doc.page.width - doc.page.margins.right, doc.y)
    .strokeColor("#d7dce0")
    .lineWidth(1)
    .stroke()
    .strokeColor("#181b1e");
}

function ensureSpace(doc: PDFKit.PDFDocument, height = 96): void {
  if (doc.y + height > doc.page.height - doc.page.margins.bottom) {
    doc.addPage();
  }
}

function sectionTitle(doc: PDFKit.PDFDocument, title: string): void {
  ensureSpace(doc, 72);
  doc.moveDown(0.9);
  drawRule(doc);
  doc.moveDown(0.65);
  doc.font("Helvetica-Bold").fontSize(12).fillColor("#181b1e").text(title);
  doc.moveDown(0.35);
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

function linkedText(doc: PDFKit.PDFDocument, label: string, url: string): void {
  doc
    .font("Helvetica")
    .fontSize(9)
    .fillColor("#2f5b85")
    .text(label, { link: url, underline: true })
    .fillColor("#181b1e");
}

function kv(doc: PDFKit.PDFDocument, label: string, value: string): void {
  doc
    .font("Helvetica-Bold")
    .fontSize(9)
    .fillColor("#5b6166")
    .text(label.toUpperCase(), { continued: true })
    .font("Helvetica")
    .fillColor("#181b1e")
    .text(`  ${value}`);
}

function issueRow(doc: PDFKit.PDFDocument, cols: string[]): void {
  const widths = [112, 92, 72, 72, 72];
  const totalWidth = widths.reduce((sum, w) => sum + w, 0);
  const startX = doc.page.margins.left;
  const startY = doc.y;
  const height = Math.max(...cols.map((col, i) => doc.heightOfString(col, { width: widths[i] - 8 })), 13) + 8;
  ensureSpace(doc, height + 6);

  cols.forEach((col, i) => {
    const x = startX + widths.slice(0, i).reduce((sum, w) => sum + w, 0);
    doc.font("Helvetica").fontSize(9).fillColor("#181b1e").text(col, x + 4, startY + 4, {
      width: widths[i] - 8,
      height,
    });
  });
  doc
    .moveTo(startX, startY + height)
    .lineTo(startX + totalWidth, startY + height)
    .strokeColor("#edf0f2")
    .stroke()
    .strokeColor("#181b1e");
  doc.y = startY + height;
}

function issueHeader(doc: PDFKit.PDFDocument): void {
  const widths = [112, 92, 72, 72, 72];
  const labels = ["Category", "Zone", "Confidence", "Severity", "Status"];
  const startX = doc.page.margins.left;
  const y = doc.y;
  labels.forEach((label, i) => {
    const x = startX + widths.slice(0, i).reduce((sum, w) => sum + w, 0);
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#6b7176").text(label.toUpperCase(), x + 4, y, {
      width: widths[i] - 8,
    });
  });
  doc.y = y + 14;
  drawRule(doc);
  doc.moveDown(0.15);
}

function drawAssetSources(doc: PDFKit.PDFDocument, assets: ReturnType<typeof getAirportReportAssets>): void {
  if (!assets) return;

  const rows = [assets.logo, assets.terminalMap, assets.airportDiagram].filter(Boolean) as AirportReportAsset[];
  if (!rows.length) return;

  sectionTitle(doc, "Airport reference assets");
  if (hasAssetFile(assets.terminalMap)) {
    const maxWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    doc.image(assetBytes(assets.terminalMap.publicPath), { fit: [maxWidth, 250], align: "center" });
    doc.moveDown(0.45);
    doc.font("Helvetica").fontSize(8).fillColor("#5b6166").text(assets.terminalMap.label);
    doc.moveDown(0.5);
  }

  for (const asset of rows) {
    ensureSpace(doc, 54);
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#181b1e").text(asset.label);
    linkedText(doc, asset.sourceName, asset.sourceUrl);
    doc.font("Helvetica").fontSize(8).fillColor("#5b6166").text(`Cached in app: ${asset.publicPath}`);
    doc.text(`Retrieved: ${asset.retrievedAt}${asset.licenseNote ? ` | ${asset.licenseNote}` : ""}`);
    doc.moveDown(0.45);
  }
}

export async function renderReportPdf(report: InspectionReport): Promise<Buffer> {
  const assets = getAirportReportAssets(report.airport.code);
  const doc = new PDFDocument({
    size: "LETTER",
    margin: 48,
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

  if (hasAssetFile(assets?.logo)) {
    doc.image(assetBytes(assets.logo.publicPath), doc.page.margins.left, doc.y, { width: 210 });
    doc.moveDown(2.0);
  }

  doc.font("Helvetica-Bold").fontSize(18).fillColor("#181b1e").text(`${report.airport.name} · ${report.airport.code}`);
  doc.moveDown(0.25);
  doc
    .font("Helvetica")
    .fontSize(10)
    .fillColor("#5b6166")
    .text(`${titleCase(report.inspection.type)} inspection · ${fmt(report, report.inspection.scheduledTime)} · status ${titleCase(report.inspection.status)}`);
  doc.text(`Generated ${fmt(report, report.generatedAt)}`);
  if (report.inspection.signedAt) {
    doc.text(`Signed off by ${report.inspection.signatureName || report.inspection.signedBy || "-"} · ${fmt(report, report.inspection.signedAt)}`);
  } else {
    doc.text("Not yet signed off");
  }
  doc.moveDown(0.8);
  drawRule(doc);
  doc.moveDown(0.8);

  const metricY = doc.y;
  const metrics = [
    ["Issues", String(report.totals.issues)],
    ["Tickets", String(report.totals.tickets)],
    ["Open", String(report.totals.ticketsOpen)],
    ["Completed", String(report.totals.ticketsCompleted)],
  ];
  metrics.forEach(([label, value], i) => {
    const x = doc.page.margins.left + i * 126;
    doc.font("Helvetica-Bold").fontSize(16).fillColor("#181b1e").text(value, x, metricY, { width: 100 });
    doc.font("Helvetica").fontSize(8).fillColor("#6b7176").text(label.toUpperCase(), x, metricY + 20, { width: 100 });
  });
  doc.y = metricY + 42;

  if (report.checklist.length) {
    sectionTitle(doc, "Daily self-inspection checklist");
    for (const item of report.checklist) {
      ensureSpace(doc, 34);
      const result = item.result ? (item.result === "na" ? "N/A" : titleCase(item.result)) : "-";
      doc.font("Helvetica-Bold").fontSize(9).fillColor("#181b1e").text(item.label, { continued: true });
      doc.font("Helvetica").fillColor("#5b6166").text(`  ${result}`);
      if (item.notes) {
        doc.font("Helvetica").fontSize(8).fillColor("#5b6166").text(item.notes, { indent: 12 });
      }
      doc.moveDown(0.25);
    }
  }

  for (const { runway, issues } of report.runways) {
    sectionTitle(doc, `${runway.name} ${runway.designation}`);
    kv(doc, "Issues", String(issues.length));
    doc.moveDown(0.4);
    if (!issues.length) {
      doc.font("Helvetica").fontSize(9).fillColor("#6b7176").text("No issues found.");
      continue;
    }
    issueHeader(doc);
    for (const issue of issues) {
      issueRow(doc, [
        REPORT_CATEGORY[issue.category] ?? titleCase(issue.category),
        issue.zone ?? "-",
        `${(issue.confidence * 100).toFixed(0)}%`,
        titleCase(issue.severity),
        titleCase(issue.status),
      ]);
    }
  }

  drawAssetSources(doc, assets);

  doc.end();
  return done;
}
