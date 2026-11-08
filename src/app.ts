import express from "express";
import cors from "cors";
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

import authRouter from "./modules/auth/auth.router.js";

import { httpErrorHandler } from "./middlewares/http-error-handler.js";
import { errorHandler } from "./middlewares/errorhandlers.js";

const app = express();

app.use(cors({
  origin: true, // Allow frontend dev & preview origins
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
}));

app.use(express.json({ limit: "10kb" }));

// Authentication routes
app.use("/api/auth", authRouter);
app.use("/auth", authRouter);

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
app.use("/api/documents", documentRouter);

// Application routes
app.use("/api/students", studentRouter);
app.use("/api/student", studentRouter);
app.use("/students", studentRouter);
app.use("/student", studentRouter);
app.use("/api/schools", schoolRouter);
app.use("/schools", schoolRouter);
app.use("/api/companies", companyRouter);
app.use("/companies", companyRouter);
app.use("/api/supervisors", supervisorRouter);
app.use("/supervisors", supervisorRouter);
app.use("/api/activities", activityRouter);
app.use("/activities", activityRouter);
app.use("/api/verifications", verificationRouter);
app.use("/verifications", verificationRouter);
app.use("/api/admin/integrity", integrityRouter);
app.use("/api/placements", placementRouter);
app.use("/placements", placementRouter);
app.use("/api/billing", billingRouter);
app.use("/billing", billingRouter);

// Specific application and validation errors
app.use(httpErrorHandler);

// General fallback error handler
app.use(errorHandler);

export default app;
