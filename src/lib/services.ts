import fs from "node:fs";
import path from "node:path";
import { getConfig } from "@/lib/config";
import { insertAnalyticsEvent, insertAuditEvent, type AnalyticsEventName } from "@/lib/db/repositories";

export function audit(actor: string, action: string, detail?: unknown): void {
  try {
    insertAuditEvent(actor, action, detail);
  } catch (err) {
    console.error("[audit] failed to record", action, err);
  }
}

export function track(name: AnalyticsEventName, assessmentId?: string, questionId?: string): void {
  try {
    insertAnalyticsEvent(name, assessmentId, questionId);
  } catch (err) {
    console.error("[analytics] failed to record", name, err);
  }
}

// ---------------------------------------------------------------- PDF storage

export function pdfStoragePath(reportId: string): string {
  const dir = path.resolve(path.dirname(getConfig().databasePath), "pdfs");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${reportId}.pdf`);
}

export function savePdf(reportId: string, bytes: Buffer): string {
  const p = pdfStoragePath(reportId);
  fs.writeFileSync(p, bytes);
  return p;
}

export function readPdf(storageKey: string): Buffer | null {
  try {
    return fs.readFileSync(storageKey);
  } catch {
    return null;
  }
}
