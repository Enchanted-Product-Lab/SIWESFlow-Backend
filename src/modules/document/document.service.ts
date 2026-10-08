import type { Document, DocumentType } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { badRequest, forbidden, notFound } from "../../lib/http-error.js";
import { loadActor } from "../access/actor.js";
import { studentRelation } from "../access/relations.js";
import {
  canDeleteDocument,
  canReadDocument,
  canUploadDocument,
  OWNER_TYPES,
  type OwnerType,
} from "../access/document-policy.js";

import {
  uploadDocumentFile,
  getSignedDocumentUrl,
  deleteDocumentFile,
} from "../storage/storage.service.js";

export type { OwnerType };

const OWNER_FIELD = {
  student: "studentId",
  school: "schoolId",
  company: "companyId",
  supervisor: "supervisorId",
} as const;

async function ownerExists(ownerType: OwnerType, ownerId: string): Promise<boolean> {
  switch (ownerType) {
    case "student":
      return !!(await prisma.student.findUnique({ where: { id: ownerId }, select: { id: true } }));
    case "school":
      return !!(await prisma.school.findUnique({ where: { id: ownerId }, select: { id: true } }));
    case "company":
      return !!(await prisma.company.findUnique({ where: { id: ownerId }, select: { id: true } }));
    case "supervisor":
      return !!(await prisma.supervisor.findUnique({ where: { id: ownerId }, select: { id: true } }));
  }
}

export async function createDocument(params: {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  ownerType: OwnerType;
  ownerId: string;
  documentType: DocumentType;
  uploadedById: string;
}): Promise<Document> {
  const { buffer, filename, mimeType, ownerType, ownerId, documentType, uploadedById } = params;

  // Exactly one owner: the type is picked from a closed list, so a request can
  // never set two owner columns. The database CHECK is the backstop.
  if (!OWNER_TYPES.includes(ownerType)) throw badRequest("Invalid ownerType");
  if (!(await ownerExists(ownerType, ownerId))) throw notFound(`${ownerType} not found`);

  const actor = await loadActor(uploadedById);
  const decision = await canUploadDocument(actor, ownerType, ownerId, documentType);
  if (!decision.ok) throw forbidden(decision.reason);

  const { storageKey, fileSizeBytes, fileFormat } = await uploadDocumentFile({
    buffer,
    filename,
    mimeType,
    ownerType,
    ownerId,
    documentType,
  });

  try {
    return await prisma.document.create({
      data: {
        [OWNER_FIELD[ownerType]]: ownerId,
        documentType,
        filename,
        fileFormat,
        fileSizeBytes,
        storageKey,
        uploadedById,
      },
    });
  } catch (err) {
    // Don't leave an orphaned object in storage when the row was rejected.
    await deleteDocumentFile(storageKey).catch(() => undefined);
    throw err;
  }
}

export async function canUserAccessDocument(userId: string, document: Document): Promise<boolean> {
  return canReadDocument(await loadActor(userId), document);
}

async function findDocument(documentId: string): Promise<Document> {
  const document = await prisma.document.findUnique({ where: { id: documentId } });
  if (!document) throw notFound("Document not found");
  return document;
}

export async function getDocumentSignedUrl(userId: string, documentId: string): Promise<string> {
  const document = await findDocument(documentId);
  if (!(await canUserAccessDocument(userId, document))) {
    throw forbidden("No permission to access this document");
  }
  return getSignedDocumentUrl(document.storageKey);
}

export async function listDocumentsForOwner(
  userId: string,
  ownerType: OwnerType,
  ownerId: string,
  documentType?: DocumentType
): Promise<Document[]> {
  const actor = await loadActor(userId);
  const documents = await prisma.document.findMany({
    where: {
      [OWNER_FIELD[ownerType]]: ownerId,
      ...(documentType ? { documentType } : {}),
    },
    orderBy: { uploadedAt: "desc" },
  });
  const allowed = await Promise.all(documents.map((d) => canReadDocument(actor, d)));
  return documents.filter((_, i) => allowed[i]);
}

const COMPLETION_TYPES: DocumentType[] = ["COMPLETION_LETTER", "COMPLETION_CERTIFICATE"];

// Completion paperwork for a student: what the caller can see, and whether the
// set is complete. Used by the completion workflow to decide a student is done.
export async function getCompletionDocuments(userId: string, studentId: string) {
  const actor = await loadActor(userId);
  if (!(await studentRelation(actor, studentId))) throw notFound("Student not found");

  const documents = (
    await prisma.document.findMany({
      where: { studentId, documentType: { in: COMPLETION_TYPES } },
      orderBy: { uploadedAt: "desc" },
    })
  );
  const visible: Document[] = [];
  for (const d of documents) if (await canReadDocument(actor, d)) visible.push(d);

  const has = (t: DocumentType) => visible.some((d) => d.documentType === t);
  return {
    documents: visible,
    hasCompletionLetter: has("COMPLETION_LETTER"),
    hasCompletionCertificate: has("COMPLETION_CERTIFICATE"),
    complete: has("COMPLETION_LETTER") && has("COMPLETION_CERTIFICATE"),
  };
}

export async function deleteDocument(userId: string, documentId: string): Promise<void> {
  const document = await findDocument(documentId);
  const actor = await loadActor(userId);
  if (!(await canDeleteDocument(actor, document))) {
    throw forbidden("No permission to delete this document");
  }

  // Row first: if storage removal then fails the file is an orphan (found by
  // the integrity audit) rather than a row pointing at nothing.
  await prisma.document.delete({ where: { id: documentId } });
  await deleteDocumentFile(document.storageKey);
}

// Removes the stored files for documents that are about to cascade-delete with
// their owner (profile deletion).
export async function deleteStoredFilesForOwner(
  ownerType: OwnerType,
  ownerId: string
): Promise<void> {
  const documents = await prisma.document.findMany({
    where: { [OWNER_FIELD[ownerType]]: ownerId },
    select: { storageKey: true },
  });
  await Promise.all(documents.map((d) => deleteDocumentFile(d.storageKey).catch(() => undefined)));
}
