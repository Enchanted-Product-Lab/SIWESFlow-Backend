import { Router } from "express";
import { currentUser, requireAuth, requireRole } from "../../middlewares/auth.js";
import { certificateLookupLimiter } from "../../middlewares/rate-limiters.js";
import { idParam } from "../profiles/common.schema.js";
import { certificateParam, completionDecisionSchema, studentIdParam } from "./completion.schema.js";
import {
  getCompletion,
  requestCompletion,
  schoolVerify,
  supervisorSignOff,
  verifyCertificate,
} from "./completion.service.js";

export const completionRouter = Router();

// Public by design: an employer or school checks a certificate
// without an account. Registered before requireAuth, and rate limited so the
// reference space cannot be walked.
completionRouter.get("/certificate/:reference", certificateLookupLimiter, async (req, res) => {
  res.json(await verifyCertificate(certificateParam.parse(req.params).reference));
});

completionRouter.use(requireAuth);

completionRouter.post("/", requireRole("STUDENT"), async (req, res) => {
  res.status(201).json(await requestCompletion(currentUser(req).id));
});

completionRouter.get("/students/:studentId", async (req, res) => {
  const { studentId } = studentIdParam.parse(req.params);
  res.json(await getCompletion(currentUser(req).id, studentId));
});

completionRouter.post("/:id/supervisor-signoff", requireRole("SUPERVISOR"), async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json(await supervisorSignOff(currentUser(req).id, id, completionDecisionSchema.parse(req.body)));
});

completionRouter.post("/:id/school-verify", requireRole("SCHOOL_COORDINATOR"), async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json(await schoolVerify(currentUser(req).id, id, completionDecisionSchema.parse(req.body)));
});
