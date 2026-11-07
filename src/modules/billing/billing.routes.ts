import { Router } from "express";
import {
  currentUser,
  requireAuth,
  requireRole,
} from "../../middlewares/auth.js";
import { idParam } from "../profiles/common.schema.js";
import { paymentSubmitLimiter } from "../../middlewares/rate-limiters.js";
import {
  createPlanSchema,
  listPlansQuery,
  updatePlanSchema,
} from "./billing.schema.js";
import {
  createPlan,
  getPlan,
  listPlans,
  updatePlan,
} from "./billing.service.js";
import {
  submitPayment,
  verifyPayment,
  listPayments,
  listSubscriptions,
  getMySubscription,
} from "./billing.service.js";
import {
  submitPaymentSchema,
  verifyPaymentSchema,
} from "./billing.schema.js";

export const billingRouter = Router();
billingRouter.use(requireAuth);

// Plans
billingRouter.get(
  "/plans",
  async (req, res) => {
    res.json(await listPlans(listPlansQuery.parse(req.query)));
  },
);

billingRouter.get(
  "/plans/:id",
  async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await getPlan(id));
  },
);

billingRouter.post(
  "/plans",
  requireRole("PLATFORM_ADMIN"),
  async (req, res) => {
    const body = createPlanSchema.parse(req.body);
    res.status(201).json(await createPlan(currentUser(req).id, body));
  },
);

billingRouter.patch(
  "/plans/:id",
  requireRole("PLATFORM_ADMIN"),
  async (req, res) => {
    const { id } = idParam.parse(req.params);
    const body = updatePlanSchema.parse(req.body);
    res.json(await updatePlan(currentUser(req).id, id, body));
  },
);

// Payments
billingRouter.post(
  "/payments",
  requireRole("COMPANY_ADMIN"),
  paymentSubmitLimiter,
  async (req, res) => {
    const body = submitPaymentSchema.parse(req.body);
    res.status(201).json(await submitPayment(currentUser(req).id, body));
  },
);

billingRouter.post(
  "/payments/:id/verify",
  requireRole("PLATFORM_ADMIN"),
  async (req, res) => {
    const { id } = idParam.parse(req.params);
    const body = verifyPaymentSchema.parse(req.body);
    res.json(await verifyPayment(currentUser(req).id, id, body));
  },
);

billingRouter.get(
  "/payments",
  async (req, res) => {
    res.json(await listPayments(currentUser(req).id));
  },
);

// Subscriptions
billingRouter.get(
  "/subscriptions",
  async (req, res) => {
    res.json(await listSubscriptions(currentUser(req).id));
  },
);

billingRouter.get(
  "/subscriptions/me",
  async (req, res) => {
    res.json(await getMySubscription(currentUser(req).id));
  },
);
