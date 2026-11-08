import { Router } from "express";
import type { Request, Response } from "express";
import multer from "multer";
import { z } from "zod";

import {
  createDocument,
  getDocumentSignedUrl,
  deleteDocument,
  listDocumentsForOwner,
  getCompletionDocuments,
} from "../modules/document/document.service.js";

import { InvalidFileError } from "../modules/storage/storage.service.js";
import { badRequest } from "../lib/http-error.js";
import { currentUser, requireAuth } from "../middlewares/auth.js";
import { OWNER_TYPES } from "../modules/access/document-policy.js";
import { DocumentType } from "../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const uploadBody = z.object({
  ownerType: z.enum(OWNER_TYPES as [string, ...string[]]),
  ownerId: z.string().min(1).max(64),
  documentType: z.enum(
    Object.values(DocumentType) as [DocumentType, ...DocumentType[]]
  ),
});

const listQuery = uploadBody.partial({ documentType: true });

export const documentRouter = Router();

// Every document route needs a signed-in user.
documentRouter.use(requireAuth);

// Upload a document.
documentRouter.post("/", upload.single("file"), async (req: Request, res: Response) => {
  if (!req.file) throw badRequest("No file provided");

  let ownerType = req.body.ownerType;
  let ownerId = req.body.ownerId;
  let docType = req.body.documentType;

  // Normalize frontend document types if aliases sent
  if (docType === "PASSPORT") docType = "PASSPORT_PHOTO";
  if (docType === "STUDENT_ID") docType = "STUDENT_ID_CARD";

  // Auto-resolve owner if caller is a student
  if (!ownerType || !ownerId) {
    const student = await prisma.student.findUnique({
      where: { userId: currentUser(req).id },
      select: { id: true },
    });
    if (student) {
      ownerType = ownerType ?? "student";
      ownerId = ownerId ?? student.id;
    }
  }

  const body = uploadBody.parse({
    ownerType,
    ownerId,
    documentType: docType,
  });

  try {
    const document = await createDocument({
      buffer: req.file.buffer,
      filename: req.file.originalname,
      mimeType: req.file.mimetype,
      ownerType: body.ownerType as (typeof OWNER_TYPES)[number],
      ownerId: body.ownerId,
      documentType: body.documentType,
      uploadedById: currentUser(req).id,
    });

    res.status(201).json(document);
  } catch (err) {
    if (err instanceof InvalidFileError) {
      throw badRequest(err.message);
    }

    throw err;
  }
});

// Lists the documents of one owner that the caller is allowed to see.
documentRouter.get("/", async (req: Request, res: Response) => {
  const q = listQuery.parse(req.query);

  const documents = await listDocumentsForOwner(
    currentUser(req).id,
    q.ownerType as (typeof OWNER_TYPES)[number],
    q.ownerId!,
    q.documentType
  );

  res.json(documents);
});

// Returns completion documents for a student.
documentRouter.get("/completion/:studentId", async (req: Request, res: Response) => {
  const studentId = z.string().min(1).parse(req.params.studentId);

  res.json(
    await getCompletionDocuments(currentUser(req).id, studentId)
  );
});

// Generates a signed URL for a document.
documentRouter.get("/:id", async (req: Request, res: Response) => {
  const id = z.string().min(1).parse(req.params.id);

  res.json({
    url: await getDocumentSignedUrl(currentUser(req).id, id),
  });
});

// Deletes a document.
documentRouter.delete("/:id", async (req: Request, res: Response) => {
  const id = z.string().min(1).parse(req.params.id);

  await deleteDocument(currentUser(req).id, id);

  res.status(204).send();
});
