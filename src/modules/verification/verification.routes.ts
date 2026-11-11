import { Router } from "express";
import { currentUser, requireAuth } from "../../middlewares/auth.js";
import { idParam } from "../profiles/common.schema.js";
import {
  entityParams,
  queueQuery,
  rejectVerificationSchema,
  reviewNoteSchema,
  submitVerificationSchema,
} from "./verification.schema.js";
import {
  approveVerification,
  getVerification,
  listForEntity,
  listQueue,
  rejectVerification,
  startReview,
  submitForVerification,
} from "./verification.service.js";

export const verificationRouter = Router();
verificationRouter.use(requireAuth);

verificationRouter.post("/", async (req, res) => {
  const body = submitVerificationSchema.parse(req.body);
  res.status(201).json(await submitForVerification(currentUser(req).id, body));
});

verificationRouter.get("/", async (req, res) => {
  res.json(await listQueue(currentUser(req).id, queueQuery.parse(req.query)));
});

verificationRouter.get("/queue", async (req, res) => {
  res.json(await listQueue(currentUser(req).id, queueQuery.parse(req.query)));
});

verificationRouter.get("/entity/:entityType/:entityId", async (req, res) => {
  const { entityType, entityId } = entityParams.parse(req.params);
  res.json(await listForEntity(currentUser(req).id, entityType, entityId));
});

verificationRouter.get("/:id", async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json(await getVerification(currentUser(req).id, id));
});

verificationRouter.post("/:id/start-review", async (req, res) => {
  const { id } = idParam.parse(req.params);
  const { notes } = reviewNoteSchema.parse(req.body ?? {});
  res.json(await startReview(currentUser(req).id, id, notes));
});

verificationRouter.post("/:id/verify", async (req, res) => {
  const { id } = idParam.parse(req.params);
  const { notes } = reviewNoteSchema.parse(req.body ?? {});
  res.json(await approveVerification(currentUser(req).id, id, notes));
});

verificationRouter.post("/:id/reject", async (req, res) => {
  const { id } = idParam.parse(req.params);
  const { reason } = rejectVerificationSchema.parse(req.body);
  res.json(await rejectVerification(currentUser(req).id, id, reason));
});
