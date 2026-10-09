import type { Request, Response } from "express";
import { registerSchema, resendVerificationSchema, verifyEmailSchema } from "./auth.schema.js";
import { registerUser } from "./auth.service.js";
import { resendVerificationEmail, verifyEmailToken } from "../auth/email verification service/verification.service.js";

export async function register(req: Request, res: Response) {
  const parsed = registerSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Validation failed",
      details: parsed.error.flatten().fieldErrors,
    });
  }

  await registerUser(parsed.data);

  return res.status(202).json({
    message: "If this email can be registered, a verification email has been sent.",
  });
}

export async function verifyEmail(req: Request, res: Response) {
  const parsed = verifyEmailSchema.safeParse(req.body);
  const verified = parsed.success && (await verifyEmailToken(parsed.data.token));

  if (!verified) {
    // One message for malformed, unknown, expired and already-used tokens
    return res.status(400).json({ error: "Invalid or expired token" });
  }

  return res.status(200).json({ message: "Email verified" });
}

export async function resendVerification(req: Request, res: Response) {
  const parsed = resendVerificationSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Validation failed",
      details: parsed.error.flatten().fieldErrors,
    });
  }

  // Not awaited, so the response time doesn't reveal whether the account exists
  void resendVerificationEmail(parsed.data.email).catch((err) => {
    console.error("Failed to resend verification email", err);
  });

  return res.status(202).json({
    message: "If this email belongs to an unverified account, a new verification email has been sent.",
  });
}