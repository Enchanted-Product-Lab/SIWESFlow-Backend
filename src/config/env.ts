import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  // Defaults to production, so forgetting the variable fails safe
  NODE_ENV: z.enum(["development", "test", "production"]).default("production"),
  EMAIL_VERIFICATION_URL: z.string().url(),
});

export const env = envSchema.parse(process.env);