import { Router } from "express";
import { currentUser, requireAuth, requireRole } from "../../middlewares/auth.js";
import { idParam } from "../profiles/common.schema.js";
import { schoolDashboardMetrics, studentTimeline, supervisorMetrics } from "./monitoring.service.js";

// Mounted at /api ahead of the school and supervisor routers, whose "/:id"
// would otherwise swallow "me". Auth is per route, never router.use(): this
// router sees every /api request on its way past.
export const monitoringRouter = Router();

monitoringRouter.get(
  "/schools/me/dashboard-metrics",
  requireAuth,
  requireRole("SCHOOL_COORDINATOR"),
  async (req, res) => {
    res.json(await schoolDashboardMetrics(currentUser(req).id));
  }
);

monitoringRouter.get(
  "/schools/students/:id/timeline",
  requireAuth,
  requireRole("SCHOOL_COORDINATOR", "STUDENT", "PLATFORM_ADMIN"),
  async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await studentTimeline(currentUser(req).id, id));
  }
);

monitoringRouter.get("/supervisors/me/metrics", requireAuth, requireRole("SUPERVISOR"), async (req, res) => {
  res.json(await supervisorMetrics(currentUser(req).id));
});
