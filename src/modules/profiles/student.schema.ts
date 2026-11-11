import { z } from "zod";
import { EngagementStatus, Gender, PlacementStatus, VerificationStatus } from "../../generated/prisma/client.js";
import { email, httpUrl, isoDate, nonEmpty, paging, phone, text } from "./common.schema.js";

const academicSession = z
  .string()
  .trim()
  .regex(/^\d{4}\/\d{4}$/, "Use the format 2025/2026")
  .refine((v) => {
    const [a, b] = v.split("/").map(Number);
    return b === a! + 1;
  }, "Session years must be consecutive");

const siwesSession = z
  .string()
  .trim()
  .regex(/^\d{4}(\/\d{4})?$/, "Use 2026 or 2025/2026");

const level = z.string().trim().regex(/^[1-9]00$/, "Level must be like 100, 200, 400");

const dateOfBirth = isoDate.refine((d) => {
  const now = new Date();
  const age = now.getFullYear() - d.getFullYear();
  return d < now && age >= 14 && age <= 80;
}, "Date of birth is not plausible");

const base = {
  firstName: text(80),
  middleName: text(80).optional(),
  lastName: text(80),
  dateOfBirth,
  gender: z.enum(Gender),
  phoneNumber: phone,
  address: text(300).optional(),
  passportPhotoUrl: httpUrl.optional(),
  faculty: text(120),
  department: text(120),
  programme: text(160),
  level,
  matriculationNumber: text(60),
  academicSession,
  siwesSession,
  siwesStartDate: isoDate.optional(),
  siwesEndDate: isoDate.optional(),
};

const siwesDatesOrdered = (v: { siwesStartDate?: Date | undefined; siwesEndDate?: Date | undefined }) =>
  !v.siwesStartDate || !v.siwesEndDate || v.siwesEndDate > v.siwesStartDate;
const datesMessage = { message: "siwesEndDate must be after siwesStartDate", path: ["siwesEndDate"] };

// Email comes from the account; status, placement, supervisor and engagement
// fields are system-managed and are rejected by .strict().
export const createStudentSchema = z
  .object({ ...base, schoolId: z.string().min(1).max(64) })
  .strict()
  .refine(siwesDatesOrdered, datesMessage);

export const updateStudentSchema = nonEmpty(z.object(base).partial().strict()).refine(
  siwesDatesOrdered,
  datesMessage
);

export const listStudentsQuery = paging.extend({
  schoolId: z.string().max(64).optional(),
  verificationStatus: z.enum(VerificationStatus).optional(),
  placementStatus: z.enum(PlacementStatus).optional(),
  // Cohort filters for the school monitoring table.
  engagementStatus: z.enum(EngagementStatus).optional(),
  faculty: z.string().trim().max(120).optional(),
  department: z.string().trim().max(120).optional(),
  companyId: z.string().max(64).optional(),
  search: z.string().trim().max(100).optional(),
});

export type CreateStudentInput = z.infer<typeof createStudentSchema>;
export type UpdateStudentInput = z.infer<typeof updateStudentSchema>;
export { email };
