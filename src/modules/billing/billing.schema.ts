import { z } from "zod";
import { PaymentMethod, PaymentStatus } from "../../generated/prisma/client.js";
import { text, optionalText, paging, isoDate, nonEmpty } from "../profiles/common.schema.js";

export const createPlanSchema = z
  .object({
    code: z.string().min(2).max(32),
    name: text(200),
    amountKobo: z.coerce.number().int().min(0),
    currency: z.string().length(3).default("NGN"),
    durationDays: z.coerce.number().int().min(1),
    maxActivePlacements: z.coerce.number().int().min(1).optional(),
    maxSlots: z.coerce.number().int().min(1).optional(),
    isActive: z.boolean().default(true),
  })
  .strict();

export const updatePlanSchema = nonEmpty(
  z.object({
    code: z.string().min(2).max(32).optional(),
    name: text(200).optional(),
    amountKobo: z.coerce.number().int().min(0).optional(),
    currency: z.string().min(3).max(3).optional(),
    durationDays: z.coerce.number().int().min(1).optional(),
    maxActivePlacements: z.coerce.number().int().min(1).optional(),
    maxSlots: z.coerce.number().int().min(1).optional(),
    isActive: z.boolean().optional(),
  }).strict(),
);

export const listPlansQuery = paging.extend({
  isActive: z.coerce.boolean().optional(),
});

export type CreatePlanInput = z.infer<typeof createPlanSchema>;
export type UpdatePlanInput = z.infer<typeof updatePlanSchema>;
export type ListPlansQuery = z.infer<typeof listPlansQuery>;

export const submitPaymentSchema = z
  .object({
    planId: z.string().min(1).max(64),
    amountKobo: z.coerce.number().int().min(0),
    method: z.nativeEnum(PaymentMethod),
    reference: z.string().min(1).max(128),
    paymentDate: isoDate,
    proofDocumentId: z.string().min(1).max(64).optional(),
  })
  .strict();

export const verifyPaymentSchema = z
  .object({
    status: z.nativeEnum(PaymentStatus),
    rejectionReason: optionalText(1000).optional(),
    notes: optionalText(2000).optional(),
  })
  .strict();

export type SubmitPaymentInput = z.infer<typeof submitPaymentSchema>;
export type VerifyPaymentInput = z.infer<typeof verifyPaymentSchema>;
