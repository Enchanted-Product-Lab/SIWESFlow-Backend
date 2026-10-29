import { z } from "zod";

const MAX_PASSWORD_BYTES = 72; // bcrypt silently ignores anything past 72 bytes
const emailField = z.string().trim().toLowerCase().email("Invalid email address").max(254);


export const registerSchema = z.object({
  email: emailField,
  password: z
    .string()
    .min(12, "Password must be at least 12 characters")
    .refine(
      (value) => Buffer.byteLength(value, "utf8") <= MAX_PASSWORD_BYTES,
      "Password is too long"
    ),
});

export const loginSchema = z.object({
  email: emailField,
  // No policy rules at login: they'd reveal the policy and lock out older accounts.
  // The max length stops oversized inputs.
  password: z.string().min(1).max(128),
});

export const verifyEmailSchema = z.object({
  token: z.string().min(32).max(256),
});

export const resendVerificationSchema = z.object({
  email: emailField,
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
export type ResendVerificationInput = z.infer<typeof resendVerificationSchema>;
export type LoginInput = z.infer<typeof loginSchema>;