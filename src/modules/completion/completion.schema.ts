import { z } from "zod";
import { optionalText } from "../profiles/common.schema.js";

// Supervisor sign-off and school verification take the same verdict.
export const completionDecisionSchema = z
  .object({
    decision: z.enum(["APPROVE", "DECLINE"]),
    remarks: optionalText(2000).optional(),
  })
  .strict()
  // The student has to know what to fix before asking again.
  .refine((d) => d.decision === "APPROVE" || d.remarks, {
    message: "Remarks are required when declining",
    path: ["remarks"],
  });

export const certificateParam = z.object({ reference: z.string().trim().min(1).max(64) });
export const studentIdParam = z.object({ studentId: z.string().min(1).max(64) });

export type CompletionDecision = z.infer<typeof completionDecisionSchema>;
