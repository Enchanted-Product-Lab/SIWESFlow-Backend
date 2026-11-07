import { Router } from "express";
import { currentUser, requireAuth, requireRole } from "../../middlewares/auth.js";
import { idParam } from "../profiles/common.schema.js";
import {
  createActivitySchema,
  listActivitiesQuery,
  updateActivitySchema,
  reviewActivitySchema,
} from "./activity.schema.js";
import {
  createActivity,
  deleteActivity,
  getActivity,
  listActivities,
  updateActivity,
  reviewActivity,
} from "./activity.service.js";

export const activityRouter = Router();
activityRouter.use(requireAuth);

activityRouter.post("/", requireRole("STUDENT"), async (req, res) => {
  const body = createActivitySchema.parse(req.body);
  res.status(201).json(await createActivity(currentUser(req).id, body));
});

// Scoped by the caller's relationship to each student, in the service.
activityRouter.get("/", async (req, res) => {
  res.json(await listActivities(currentUser(req).id, listActivitiesQuery.parse(req.query)));
});

activityRouter.get("/:id", async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json(await getActivity(currentUser(req).id, id));
});

activityRouter.patch("/:id", requireRole("STUDENT"), async (req, res) => {
  const { id } = idParam.parse(req.params);
  const body = updateActivitySchema.parse(req.body);
  res.json(await updateActivity(currentUser(req).id, id, body));
});

activityRouter.delete("/:id", requireRole("PLATFORM_ADMIN"), async (req, res) => {
  const { id } = idParam.parse(req.params);
  await deleteActivity(currentUser(req).id, id);
  res.status(204).send();
});

// Supervisor review of an activity
activityRouter.post(
  "/:id/review",
  requireRole("SUPERVISOR"),
  async (req, res) => {
    const { id } = idParam.parse(req.params);
    const body = reviewActivitySchema.parse(req.body);
    res.json(await reviewActivity(currentUser(req).id, id, body));
  },
);
