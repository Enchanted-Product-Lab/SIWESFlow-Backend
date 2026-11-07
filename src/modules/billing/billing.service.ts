import type { Prisma } from "../../generated/prisma/client.js";
import {
  PaymentStatus,
  SubscriptionStatus,
} from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { conflict, forbidden, notFound } from "../../lib/http-error.js";
import { isUniqueViolation, skipTake, type Page } from "../../lib/pagination.js";
import { stripUndefined } from "../../lib/object.js";
import { isAdmin, loadActor } from "../access/actor.js";
import type {
  CreatePlanInput,
  ListPlansQuery,
  SubmitPaymentInput,
  UpdatePlanInput,
  VerifyPaymentInput,
} from "./billing.schema.js";

const PLAN_SUMMARY = {
  id: true,
  code: true,
  name: true,
  amountKobo: true,
  currency: true,
  durationDays: true,
  maxActivePlacements: true,
  maxSlots: true,
  isActive: true,
} as const;

export async function createPlan(userId: string, input: CreatePlanInput) {
  const actor = await loadActor(userId);
  if (!isAdmin(actor)) throw forbidden("Only a platform admin can create plans");

  try {
    return await prisma.plan.create({
      data: stripUndefined({
        code: input.code,
        name: input.name,
        amountKobo: input.amountKobo,
        currency: input.currency,
        durationDays: input.durationDays,
        maxActivePlacements: input.maxActivePlacements,
        maxSlots: input.maxSlots,
        isActive: input.isActive,
      }),
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("A plan with this code already exists");
    throw err;
  }
}

export async function listPlans(q: ListPlansQuery): Promise<Page<Prisma.PlanGetPayload<object>>> {
  const where: Prisma.PlanWhereInput = {};
  if (q.isActive !== undefined) where.isActive = q.isActive;

  const [rows, total] = await Promise.all([
    prisma.plan.findMany({ where, orderBy: [{ createdAt: "desc" }], ...skipTake(q.page, q.pageSize) }),
    prisma.plan.count({ where }),
  ]);

  return { data: rows, page: q.page, pageSize: q.pageSize, total };
}

export async function getPlan(planId: string) {
  const plan = await prisma.plan.findUnique({ where: { id: planId } });
  if (!plan) throw notFound("Plan not found");
  return plan;
}

export async function updatePlan(userId: string, planId: string, input: UpdatePlanInput) {
  const actor = await loadActor(userId);
  if (!isAdmin(actor)) throw forbidden("Only a platform admin can update plans");

  const plan = await prisma.plan.findUnique({ where: { id: planId } });
  if (!plan) throw notFound("Plan not found");

  try {
    return await prisma.plan.update({
      where: { id: planId },
      data: stripUndefined(input),
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("A plan with this code already exists");
    throw err;
  }
}

export async function submitPayment(userId: string, input: SubmitPaymentInput) {
  const actor = await loadActor(userId);
  if (actor.role !== "COMPANY_ADMIN" || !actor.ownedCompanyId) {
    throw forbidden("Only a company admin can submit payments");
  }

  const plan = await prisma.plan.findUnique({ where: { id: input.planId } });
  if (!plan) throw notFound("Plan not found");
  if (!plan.isActive) throw conflict("This plan is not active");
  if (input.amountKobo !== plan.amountKobo) {
    throw conflict(`Amount must be exactly ${plan.amountKobo} kobo for this plan`);
  }

  if (input.proofDocumentId) {
    const doc = await prisma.document.findUnique({
      where: { id: input.proofDocumentId },
      select: { companyId: true },
    });
    if (!doc) throw notFound("Proof document not found");
    if (doc.companyId !== actor.ownedCompanyId) {
      throw forbidden("That proof document does not belong to your company");
    }
  }

  try {
    return await prisma.payment.create({
      data: stripUndefined({
        companyId: actor.ownedCompanyId,
        planId: input.planId,
        amountKobo: input.amountKobo,
        method: input.method,
        reference: input.reference,
        paymentDate: input.paymentDate,
        proofDocumentId: input.proofDocumentId,
        status: PaymentStatus.PENDING,
        submittedById: actor.id,
      }),
      include: {
        plan: { select: PLAN_SUMMARY },
        submittedBy: { select: { id: true, email: true } },
      },
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("A payment with this reference already exists");
    throw err;
  }
}

export async function listPayments(userId: string) {
  const actor = await loadActor(userId);

  const include = {
    company: { select: { id: true, companyCode: true, name: true } },
    plan: { select: PLAN_SUMMARY },
    submittedBy: { select: { id: true, email: true } },
    verifiedBy: { select: { id: true, email: true } },
  } as const;

  if (isAdmin(actor)) {
    return prisma.payment.findMany({ include, orderBy: { createdAt: "desc" } });
  }
  if (actor.role === "COMPANY_ADMIN" && actor.ownedCompanyId) {
    return prisma.payment.findMany({
      where: { companyId: actor.ownedCompanyId },
      include,
      orderBy: { createdAt: "desc" },
    });
  }
  throw forbidden("Your role cannot view payments");
}

/**
 * Verifying a payment activates (or extends) the company subscription in the
 * same transaction, so a verified payment can never exist without a
 * subscription behind it.
 */
export async function verifyPayment(
  userId: string,
  paymentId: string,
  input: VerifyPaymentInput,
) {
  const actor = await loadActor(userId);
  if (!isAdmin(actor)) throw forbidden("Only a platform admin can verify payments");
  if (input.status === PaymentStatus.PENDING) {
    throw conflict("A verification must be VERIFIED or REJECTED");
  }
  if (input.status === PaymentStatus.REJECTED && !input.rejectionReason) {
    throw conflict("A rejection reason is required");
  }

  return prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({ where: { id: paymentId } });
    if (!payment) throw notFound("Payment not found");
    if (payment.status !== PaymentStatus.PENDING) {
      throw conflict("This payment has already been processed");
    }

    const { count } = await tx.payment.updateMany({
      where: { id: paymentId, status: PaymentStatus.PENDING },
      data: stripUndefined({
        status: input.status,
        verifiedById: actor.id,
        verifiedAt: new Date(),
        rejectionReason: input.status === PaymentStatus.REJECTED ? input.rejectionReason : null,
        notes: input.notes,
      }),
    });
    if (count === 0) throw conflict("This payment was just processed by someone else");

    if (input.status === PaymentStatus.VERIFIED) {
      const plan = await tx.plan.findUnique({ where: { id: payment.planId } });
      if (!plan) throw notFound("Plan not found");

      const current = await tx.subscription.findFirst({
        where: { companyId: payment.companyId, status: SubscriptionStatus.ACTIVE },
        orderBy: { expiryDate: "desc" },
      });

      const now = new Date();
      let subscriptionId: string;

      if (current) {
        // Renewing early extends the existing subscription instead of
        // discarding the days the company already paid for.
        const base =
          current.expiryDate && current.expiryDate > now ? current.expiryDate : now;
        const extended = await tx.subscription.update({
          where: { id: current.id },
          data: {
            planId: plan.id,
            status: SubscriptionStatus.ACTIVE,
            expiryDate: new Date(base.getTime() + plan.durationDays * 86_400_000),
          },
        });
        subscriptionId = extended.id;
      } else {
        const created = await tx.subscription.create({
          data: {
            companyId: payment.companyId,
            planId: plan.id,
            status: SubscriptionStatus.ACTIVE,
            startDate: now,
            expiryDate: new Date(now.getTime() + plan.durationDays * 86_400_000),
          },
        });
        subscriptionId = created.id;
      }

      await tx.payment.update({
        where: { id: paymentId },
        data: { subscriptionId },
      });
    }

    return tx.payment.findUniqueOrThrow({
      where: { id: paymentId },
      include: {
        company: { select: { id: true, companyCode: true, name: true } },
        plan: { select: PLAN_SUMMARY },
        submittedBy: { select: { id: true, email: true } },
        verifiedBy: { select: { id: true, email: true } },
        subscription: { select: { id: true, status: true, startDate: true, expiryDate: true } },
      },
    });
  });
}

export async function listSubscriptions(userId: string) {
  const actor = await loadActor(userId);

  const include = {
    company: { select: { id: true, companyCode: true, name: true } },
    plan: { select: PLAN_SUMMARY },
  } as const;

  if (isAdmin(actor)) {
    return prisma.subscription.findMany({ include, orderBy: { createdAt: "desc" } });
  }
  if (actor.role === "COMPANY_ADMIN" && actor.ownedCompanyId) {
    return prisma.subscription.findMany({
      where: { companyId: actor.ownedCompanyId },
      include,
      orderBy: { createdAt: "desc" },
    });
  }
  throw forbidden("Your role cannot view subscriptions");
}

export async function getMySubscription(userId: string) {
  const actor = await loadActor(userId);
  if (actor.role !== "COMPANY_ADMIN" || !actor.ownedCompanyId) {
    throw forbidden("Only a company admin can view their subscription");
  }

  return prisma.subscription.findFirst({
    where: { companyId: actor.ownedCompanyId, status: SubscriptionStatus.ACTIVE },
    include: { plan: { select: PLAN_SUMMARY } },
    orderBy: { expiryDate: "desc" },
  });
}
