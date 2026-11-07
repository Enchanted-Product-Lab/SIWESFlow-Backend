import { Router } from "express";
import { currentUser, requireAuth, requireRole } from "../../middlewares/auth.js";
import {
  applicationLimiter,
  placementWriteLimiter,
} from "../../middlewares/rate-limiters.js";
import { idParam } from "../profiles/common.schema.js";
import {
  applySchema,
  approvePlacementSchema,
  createPlacementSchema,
  listPlacementsQuery,
  updatePlacementSchema,
} from "./placement.schema.js";
import {
  acceptApplication,
  applyToPlacement,
  approvePlacement,
  createPlacement,
  getPlacement,
  listApplications,
  listPlacements,
  rejectApplication,
  setPlacementActive,
  updatePlacement,
} from "./placement.service.js";

export const placementRouter = Router();
placementRouter.use(requireAuth);

placementRouter.post(
  "/",
  requireRole("COMPANY_ADMIN", "PLATFORM_ADMIN"),
  placementWriteLimiter,
  async (req, res) => {
    const body = createPlacementSchema.parse(req.body);
    res.status(201).json(await createPlacement(currentUser(req).id, body));
  },
);

placementRouter.get("/", async (req, res) => {
  res.json(await listPlacements(currentUser(req).id, listPlacementsQuery.parse(req.query)));
});

placementRouter.get("/:id", async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json(await getPlacement(currentUser(req).id, id));
});

placementRouter.patch("/:id", requireRole("COMPANY_ADMIN", "PLATFORM_ADMIN"), async (req, res) => {
  const { id } = idParam.parse(req.params);
  const body = updatePlacementSchema.parse(req.body);
  res.json(await updatePlacement(currentUser(req).id, id, body));
});

placementRouter.post(
  "/:id/activate",
  requireRole("COMPANY_ADMIN", "PLATFORM_ADMIN"),
  async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await setPlacementActive(currentUser(req).id, id, true));
  },
);

placementRouter.post(
  "/:id/deactivate",
  requireRole("COMPANY_ADMIN", "PLATFORM_ADMIN"),
  async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await setPlacementActive(currentUser(req).id, id, false));
  },
);

placementRouter.post(
  "/:id/approval",
  requireRole("SCHOOL_COORDINATOR", "PLATFORM_ADMIN"),
  async (req, res) => {
    const { id } = idParam.parse(req.params);
    const body = approvePlacementSchema.parse(req.body);
    res.json(await approvePlacement(currentUser(req).id, id, body));
  },
);

placementRouter.post("/:id/apply", requireRole("STUDENT"), applicationLimiter, async (req, res) => {
  const { id } = idParam.parse(req.params);
  const body = applySchema.parse(req.body ?? {});
  res.status(201).json(await applyToPlacement(currentUser(req).id, id, body));
});

placementRouter.get(
  "/:id/applications",
  requireRole("COMPANY_ADMIN", "PLATFORM_ADMIN"),
  async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await listApplications(currentUser(req).id, id));
  },
);

placementRouter.post(
  "/applications/:id/accept",
  requireRole("COMPANY_ADMIN", "PLATFORM_ADMIN"),
  async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await acceptApplication(currentUser(req).id, id));
  },
);

placementRouter.post(
  "/applications/:id/reject",
  requireRole("COMPANY_ADMIN", "PLATFORM_ADMIN"),
  async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await rejectApplication(currentUser(req).id, id));
  },
);
