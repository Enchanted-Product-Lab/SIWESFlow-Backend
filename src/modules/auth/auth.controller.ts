import type { Request, Response } from "express";
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resendVerificationSchema,
  resetPasswordSchema,
  totpCodeSchema,
  verifyEmailSchema,
} from "./auth.schema.js";
import {
  disableTwoFactor,
  enableTwoFactor,
  loginUser,
  registerUser,
  requestPasswordReset,
  resetPassword,
  setupTwoFactor,
} from "./auth.service.js";
import { currentUser } from "../../middlewares/auth.js";
import { resendVerificationEmail, verifyEmailToken } from "./email verification service/verification.service.js";
import { ACCESS_TOKEN_TTL_SECONDS } from "./token service/token.service.js";
import { REFRESH_COOKIE_NAME, refreshCookieOptions } from "./auth.cookies.js";

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
  const token = (req.body?.token || req.query?.token) as string | undefined;
  const parsed = verifyEmailSchema.safeParse({ token });
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

export async function login(req: Request, res: Response) {
  const parsed = loginSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Validation failed",
      details: parsed.error.flatten().fieldErrors,
    });
  }

  const result = await loginUser(parsed.data);

  if (!result.ok) {
    if (result.reason === "EMAIL_NOT_VERIFIED") {
      return res.status(403).json({ error: "Email not verified" });
    }
    if (result.reason === "TWO_FACTOR_REQUIRED") {
      return res.status(202).json({
        requiresTwoFactor: true,
        message: "Two-factor authentication code required",
      });
    }
    if (result.reason === "INVALID_TWO_FACTOR_CODE") {
      return res.status(401).json({ error: "Invalid two-factor authentication code" });
    }
    return res.status(401).json({ error: "Invalid email or password" });
  }

  res.cookie(REFRESH_COOKIE_NAME, result.refreshToken, refreshCookieOptions);
  return res.status(200).json({
    accessToken: result.accessToken,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    user: result.user,
  });
}

export async function forgotPassword(req: Request, res: Response) {
  const parsed = forgotPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Validation failed",
      details: parsed.error.flatten().fieldErrors,
    });
  }

  void requestPasswordReset(parsed.data.email).catch((err) => {
    console.error("Failed to process password reset request", err);
  });

  return res.status(202).json({
    message: "If an account with this email exists, a password reset link has been sent.",
  });
}

export async function resetPasswordHandler(req: Request, res: Response) {
  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Validation failed",
      details: parsed.error.flatten().fieldErrors,
    });
  }

  const ok = await resetPassword(parsed.data.token, parsed.data.password);
  if (!ok) {
    return res.status(400).json({ error: "Invalid or expired token" });
  }

  return res.status(200).json({ message: "Password has been reset" });
}

export async function setup2FA(req: Request, res: Response) {
  const result = await setupTwoFactor(currentUser(req).id);
  return res.status(200).json(result);
}

export async function enable2FA(req: Request, res: Response) {
  const parsed = totpCodeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Validation failed",
      details: parsed.error.flatten().fieldErrors,
    });
  }
  const result = await enableTwoFactor(currentUser(req).id, parsed.data.code);
  return res.status(200).json(result);
}

export async function disable2FA(req: Request, res: Response) {
  const parsed = totpCodeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Validation failed",
      details: parsed.error.flatten().fieldErrors,
    });
  }
  const result = await disableTwoFactor(currentUser(req).id, parsed.data.code);
  return res.status(200).json(result);
}
