import { z } from "zod";

const MAX_PASSWORD_BYTES = 72; // bcrypt silently ignores anything past 72 bytes

export const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email("Invalid email address").max(254),
  password: z
    .string()
    .min(12, "Password must be at least 12 characters")
    .refine(
      (value) => Buffer.byteLength(value, "utf8") <= MAX_PASSWORD_BYTES,
      "Password is too long"
    ),
});

export type RegisterInput = z.infer<typeof registerSchema>;