
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { env } from "./config/env.js";
import { prisma } from "./lib/prisma.js";
import { documentRouter } from "./routes/document.routes.js";

import { studentRouter } from "./modules/profiles/student.routes.js";
import { schoolRouter } from "./modules/profiles/school.routes.js";
import { companyRouter } from "./modules/profiles/company.routes.js";
import { supervisorRouter } from "./modules/profiles/supervisor.routes.js";
import { activityRouter } from "./modules/activity/activity.routes.js";
import { placementRouter } from "./modules/placement/placement.routes.js";
import { billingRouter } from "./modules/billing/billing.routes.js";
import { verificationRouter } from "./modules/verification/verification.routes.js";
import { integrityRouter } from "./modules/admin/integrity.routes.js";
import { auditRouter } from "./modules/admin/audit.routes.js";

import authRouter from "./modules/auth/auth.router.js";

import { httpErrorHandler } from "./middlewares/http-error-handler.js";
import { errorHandler } from "./middlewares/errorhandlers.js";

const app = express();

// Security headers on every response. `crossOriginResourcePolicy` is relaxed so
// the frontend on a different origin can still load uploaded documents.
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));

// Only the configured frontend origin may call this API from a browser.
app.use(
  cors({
    origin: env.FRONTEND_URL,
    credentials: true,
  })
);

app.use(express.json({ limit: "10kb" }));

// Authentication routes
app.use("/api/auth", authRouter);

// Health check
app.get("/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ok", db: "connected" });
  } catch (_err) {
    res.status(503).json({ status: "error", db: "unreachable" });
  }
});

// Document routes
app.use("/documents", documentRouter);

// Application routes
app.use("/api/students", studentRouter);
app.use("/api/schools", schoolRouter);
app.use("/api/companies", companyRouter);
app.use("/api/supervisors", supervisorRouter);
app.use("/api/activities", activityRouter);
app.use("/api/verifications", verificationRouter);
app.use("/api/admin/integrity", integrityRouter);
app.use("/api/admin/audit", auditRouter);
app.use("/api/placements", placementRouter);
app.use("/api/billing", billingRouter);

// Specific application and validation errors
app.use(httpErrorHandler);

// General fallback error handler
app.use(errorHandler);

export default app;
