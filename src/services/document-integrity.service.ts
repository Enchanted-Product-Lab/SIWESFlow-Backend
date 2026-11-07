import { prisma } from "../lib/prisma.js";
import { listStoredObjects } from "../modules/storage/storage.service.js";
import { auditDocumentRow, type IntegrityIssue, type IntegrityReport } from "./document-integrity.rules.js";

// File, MIME and access integrity audit. Read-only: it reports, a human fixes.
export type { IntegrityIssue, IntegrityReport, IssueCode } from "./document-integrity.rules.js";

export async function auditDocumentIntegrity(): Promise<IntegrityReport> {
  const [documents, objects] = await Promise.all([
    prisma.document.findMany({ include: { verification: { select: { status: true } } } }),
    listStoredObjects(),
  ]);
  const stored = new Map(objects.map((o) => [o.key, o.size]));
  const known = new Set(documents.map((d) => d.storageKey));

  const issues = documents.flatMap((d) => auditDocumentRow(d, stored));
  for (const o of objects) {
    if (!known.has(o.key)) {
      issues.push({ code: "ORPHAN_STORAGE_OBJECT", storageKey: o.key, detail: "Object has no matching document row" });
    }
  }

  return {
    checkedAt: new Date().toISOString(),
    documentsChecked: documents.length,
    storageObjects: objects.length,
    issueCount: issues.length,
    issues,
  };
}
