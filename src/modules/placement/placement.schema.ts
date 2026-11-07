import { z } from "zod";
import { PlacementApprovalStatus, WorkMode } from "../../generated/prisma/client.js";
import {
  isoDate,
  nonEmpty,
  optionalText,
  paging,
  stringList,
  text,
} from "../profiles/common.schema.js";

const base = {
  // Optional on purpose: a company admin's own company always wins, and only a
  // platform admin needs to name the company they are posting for.
  companyId: z.string().min(1).max(64).optional(),
  title: text(200),
  description: optionalText(4000).optional(),
  department: text(100),
  requiredLevel: optionalText(100).optional(),
  requiredSkills: stringList(20).optional(),
  availableSlots: z.coerce.number().int().min(1).max(1000),
  startDate: isoDate,
  endDate: isoDate,
  location: optionalText(200).optional(),
  workMode: z.nativeEnum(WorkMode),
};

const endsAfterStart = (v: { startDate?: Date | undefined; endDate?: Date | undefined }) =>
  !v.startDate || !v.endDate || v.startDate <= v.endDate;

export const createPlacementSchema = z
  .object(base)
  .strict()
  .refine(endsAfterStart, { message: "endDate must be on or after startDate", path: ["endDate"] });

export const updatePlacementSchema = nonEmpty(z.object(base).partial().strict()).refine(
  endsAfterStart,
  { message: "endDate must be on or after startDate", path: ["endDate"] },
);

// A placement has no lifecycle enum of its own: `isActive` is the owner's
// publish switch and `approvalStatus` is the school's verdict.
export const listPlacementsQuery = paging
  .extend({
    companyId: z.string().max(64).optional(),
    department: z.string().trim().max(100).optional(),
    workMode: z.nativeEnum(WorkMode).optional(),
    isActive: z.coerce.boolean().optional(),
    approvalStatus: z.nativeEnum(PlacementApprovalStatus).optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    message: "to must be on or after from",
    path: ["to"],
  });

export const applySchema = z
  .object({ coverNote: optionalText(2000).optional() })
  .strict();

export const approvePlacementSchema = z
  .object({
    approvalStatus: z.nativeEnum(PlacementApprovalStatus),
    approvalNote: optionalText(1000).optional(),
  })
  .strict();

export const respondApplicationSchema = z
  .object({ note: optionalText(1000).optional() })
  .strict();

export type CreatePlacementInput = z.infer<typeof createPlacementSchema>;
export type UpdatePlacementInput = z.infer<typeof updatePlacementSchema>;
export type ListPlacementsQuery = z.infer<typeof listPlacementsQuery>;
export type ApplyInput = z.infer<typeof applySchema>;
export type ApprovePlacementInput = z.infer<typeof approvePlacementSchema>;
