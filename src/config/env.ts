import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  // Defaults to production, so forgetting the variable fails safe
  NODE_ENV: z.enum(["development", "test", "production"]).default("production"),
  EMAIL_VERIFICATION_URL: z.string().url(),

  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be at least 32 characters"),
  // Reduced to a bare origin, because CORS matches the exact string (no path, no trailing slash)
  FRONTEND_URL: z.string().url().transform((value) => new URL(value).origin),
});

export const env = envSchema.parse(process.env);