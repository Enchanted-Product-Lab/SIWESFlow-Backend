import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  // Defaults to production, so forgetting the variable fails safe
  NODE_ENV: z.enum(["development", "test", "production"]).default("production"),
  EMAIL_VERIFICATION_URL: z
    .string()
    .url()
    .default("http://localhost:3000/auth/verify"),

  JWT_ACCESS_SECRET: z
    .string()
    .min(32, "JWT_ACCESS_SECRET must be at least 32 characters")
    .default("development-secret-key-at-least-32-chars-long!!"),
  // Reduced to a bare origin, because CORS matches the exact string (no path, no trailing slash)
  FRONTEND_URL: z
    .string()
    .url()
    .default("http://localhost:3000")
    .transform((value) => new URL(value).origin),

  ACTIVITY_BULK_THRESHOLD: z.coerce.number().int().min(2).default(8),
  ACTIVITY_BULK_WINDOW_HOURS: z.coerce.number().positive().default(24),

  // SIWES completion minimums.
  COMPLETION_MIN_HOURS: z.coerce.number().positive().default(480),
  COMPLETION_MIN_WEEKS: z.coerce.number().int().positive().default(12),
});

export const env = envSchema.parse(process.env);
