import { randomUUID } from "node:crypto";
import type { FileFormat } from "../../generated/prisma/client.js";
import { supabase, DOCUMENTS_BUCKET } from "../../lib/supabase.js";
import { checkUploadedFile } from "../../lib/file-signature.js";
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg",
  "image/jpg",
  "image/png",
]);

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

export class InvalidFileError extends Error {}

export interface UploadResult {
  storageKey: string;
  fileSizeBytes: number;
  fileFormat: FileFormat;
}

export async function uploadDocumentFile(params: {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  ownerType: "student" | "school" | "company" | "supervisor";
  ownerId: string;
  documentType: string;
}): Promise<UploadResult> {
  const { buffer, filename, mimeType, ownerType, ownerId, documentType } =
    params;

  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new InvalidFileError(`Unsupported file type: ${mimeType}`);
  }
  if (buffer.byteLength > MAX_FILE_SIZE_BYTES) {
    throw new InvalidFileError(
      `File exceeds ${MAX_FILE_SIZE_BYTES / 1024 / 1024}MB limit`
    );
  }

  const check = checkUploadedFile(buffer, filename, mimeType);
  if (!check.ok || !check.fileFormat) {
    throw new InvalidFileError(check.error ?? "Invalid file");
  }

  const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storageKey = `${ownerType}/${ownerId}/${documentType}/${randomUUID()}-${safeFilename}`;

  const { error } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .upload(storageKey, buffer, {
      contentType: mimeType,
      upsert: false,
    });

  if (error) {
    throw new Error(`Supabase Storage upload failed: ${error.message}`);
  }

  return { storageKey, fileSizeBytes: buffer.byteLength, fileFormat: check.fileFormat };
}

export async function getSignedDocumentUrl(
  storageKey: string,
  expiresInSeconds = 300
): Promise<string> {
  const { data, error } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(storageKey, expiresInSeconds);

  if (error || !data) {
    throw new Error(
      `Failed to create signed URL: ${error?.message ?? "unknown error"}`
    );
  }

  return data.signedUrl;
}

export async function deleteDocumentFile(storageKey: string): Promise<void> {
  const { error } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .remove([storageKey]);

  if (error) {
    throw new Error(`Supabase Storage delete failed: ${error.message}`);
  }
}
export interface StoredObject {
  key: string;
  size: number | null;
}

// Walks the bucket under `prefix` and returns every object. Folders have a
// null id in Supabase's listing, so they are recursed into rather than returned.
export async function listStoredObjects(prefix = ""): Promise<StoredObject[]> {
  const out: StoredObject[] = [];
  const pageSize = 1000;

  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.storage
      .from(DOCUMENTS_BUCKET)
      .list(prefix, { limit: pageSize, offset });
    if (error) throw new Error(`Supabase Storage list failed: ${error.message}`);
    if (!data || data.length === 0) break;

    for (const entry of data) {
      const key = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id === null) out.push(...(await listStoredObjects(key)));
      else out.push({ key, size: typeof entry.metadata?.size === "number" ? entry.metadata.size : null });
    }
    if (data.length < pageSize) break;
  }
  return out;
}
