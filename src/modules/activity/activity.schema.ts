import { z } from "zod";
import { ActivityStatus } from "../../generated/prisma/client.js";
import {
  isoDate,
  nonEmpty,
  optionalText,
  paging,
  stringList,
  text,
} from "../profiles/common.schema.js";

// studentId, status and the review fields are system-managed and rejected by
// .strict(): only a supervisor moves an entry out of PENDING.
const base = {
  date: isoDate,
  title: text(160),
  description: text(4000),
  whatILearned: optionalText(4000).optional(),
  skillsUsed: stringList(20).optional(),
  // One calendar day cannot hold more hours than a day has. TRD §5.3 gates
  // completion on total hours, so this ceiling is what keeps that honest.
  hoursWorked: z.coerce.number().min(0.25).max(24),
  challenges: optionalText(2000).optional(),
  category: text(80).optional(),
  // The student's own ACTIVITY_EVIDENCE upload; null on PATCH detaches it again.
  documentId: z.string().min(1).max(64).nullable().optional(),
};

export const createActivitySchema = z.object(base).strict();

export const updateActivitySchema = nonEmpty(z.object(base).partial().strict());

export const listActivitiesQuery = paging
  .extend({
    studentId: z.string().max(64).optional(),
    status: z.enum(ActivityStatus).optional(),
    category: z.string().trim().max(80).optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    message: "to must be on or after from",
    path: ["to"],
  });

export type CreateActivityInput = z.infer<typeof createActivitySchema>;
export type UpdateActivityInput = z.infer<typeof updateActivitySchema>;
export type ListActivitiesQuery = z.infer<typeof listActivitiesQuery>;

export const reviewActivitySchema = z
  .object({
    status: z.enum(["APPROVED", "NEEDS_REVISION"]),
    rating: z.coerce.number().int().min(1).max(5).optional(),
    comment: optionalText(1000).optional(),
  })
  // A student can only act on a verdict that says what to change.
  .refine((review) => review.status === "APPROVED" || review.comment, {
    message: "A comment is required unless the entry is approved",
    path: ["comment"],
  });

export type ReviewActivityInput = z.infer<typeof reviewActivitySchema>;
