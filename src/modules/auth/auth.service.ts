import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcrypt";
import { env } from "../../config/env.js";
import { prisma } from "../../lib/prisma.js";
import { badRequest, forbidden, notFound } from "../../lib/http-error.js";
import { buildOtpAuthUrl, generateTotpSecret, verifyTotpCode } from "../../lib/totp.js";
import type { LoginInput, RegisterInput } from "./auth.schema.js";
import { sendEmail } from "../auth/email verification service/email.service.js";
import { sendVerificationEmail } from "../auth/email verification service/verification.service.js";
import { issueRefreshToken, signAccessToken } from "../auth/token service/token.service.js";
const BCRYPT_COST = 12;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && err.code === "P2002";
}

async function createStudent(email: string, passwordHash: string): Promise<string | null> {
  try {
    const user = await prisma.user.create({
      data: { email, passwordHash, role: "STUDENT" },
      select: { id: true },
    });
    return user.id;
  } catch (err) {
    if (isUniqueViolation(err)) return null; // already registered
    throw err;
  }
}

export async function registerUser({ email, password }: RegisterInput): Promise<void> {
  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
  const userId = await createStudent(email, passwordHash);
  if (!userId) return;

  // Deliberately not awaited, so new and existing emails respond in the same time.
  // The .catch is required: an unhandled rejection would crash the process.
  void sendVerificationEmail(userId, email).catch((err) => {
    console.error("Failed to send verification email", err);
  });
}

// Compared against when the email doesn't exist, so unknown emails cost the same
// time as wrong passwords. Top-level await adds about 250ms at startup.
const DUMMY_HASH = await bcrypt.hash(randomBytes(16).toString("hex"), BCRYPT_COST);

type LoginResult =
  | {
      ok: false;
      reason:
        | "INVALID_CREDENTIALS"
        | "EMAIL_NOT_VERIFIED"
        | "TWO_FACTOR_REQUIRED"
        | "INVALID_TWO_FACTOR_CODE";
    }
  | {
      ok: true;
      user: { id: string; email: string; role: string; twoFactorEnabled: boolean };
      accessToken: string;
      refreshToken: string;
    };

export async function loginUser({ email, password, totpCode }: LoginInput): Promise<LoginResult> {
  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      role: true,
      passwordHash: true,
      isEmailVerified: true,
      twoFactorEnabled: true,
      twoFactorSecret: true,
    },
  });

  const passwordOk = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !passwordOk) return { ok: false, reason: "INVALID_CREDENTIALS" };

  // Only reached with the correct password, so this reveals nothing to a stranger
  if (!user.isEmailVerified) return { ok: false, reason: "EMAIL_NOT_VERIFIED" };

  if (user.twoFactorEnabled && user.twoFactorSecret) {
    if (!totpCode) return { ok: false, reason: "TWO_FACTOR_REQUIRED" };
    if (!verifyTotpCode(user.twoFactorSecret, totpCode)) {
      return { ok: false, reason: "INVALID_TWO_FACTOR_CODE" };
    }
  }

  const [accessToken, refreshToken] = await Promise.all([
    signAccessToken(user.id, user.role),
    issueRefreshToken(user.id),
  ]);

  return {
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      twoFactorEnabled: user.twoFactorEnabled,
    },
    accessToken,
    refreshToken,
  };
}

export async function requestPasswordReset(email: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true },
  });
  if (!user) return;

  const token = randomBytes(32).toString("base64url");
  await prisma.$transaction([
    prisma.passwordResetToken.deleteMany({ where: { userId: user.id } }),
    prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
      },
    }),
  ]);

  const link = `${env.FRONTEND_URL}/auth/reset-password?token=${token}`;
  await sendEmail({
    to: user.email,
    subject: "Reset your SIWESFlow password",
    text: `You requested a password reset for SIWESFlow.\n\nReset your password using this link (valid for 1 hour):\n${link}\n\nIf you didn't request this, you can ignore this email.`,
  });
}

export async function resetPassword(token: string, newPassword: string): Promise<boolean> {
  const tokenHash = hashToken(token);
  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);

  return prisma.$transaction(async (tx) => {
    const record = await tx.passwordResetToken.findUnique({ where: { tokenHash } });
    if (!record || record.expiresAt <= new Date()) {
      if (record) await tx.passwordResetToken.delete({ where: { id: record.id } });
      return false;
    }

    await tx.passwordResetToken.delete({ where: { id: record.id } });
    await tx.user.update({
      where: { id: record.userId },
      data: { passwordHash },
    });
    // Revoke all existing sessions so stolen refresh tokens cannot persist
    await tx.refreshToken.deleteMany({ where: { userId: record.userId } });
    return true;
  });
}

export async function setupTwoFactor(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, twoFactorEnabled: true },
  });
  if (!user) throw notFound("User not found");

  const secret = generateTotpSecret();
  await prisma.user.update({
    where: { id: userId },
    data: { twoFactorSecret: secret, twoFactorEnabled: false },
  });

  return {
    secret,
    otpauthUrl: buildOtpAuthUrl(user.email, secret),
  };
}

export async function enableTwoFactor(userId: string, code: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, twoFactorSecret: true },
  });
  if (!user || !user.twoFactorSecret) {
    throw badRequest("Two-factor setup has not been started");
  }
  if (!verifyTotpCode(user.twoFactorSecret, code)) {
    throw badRequest("Invalid two-factor authentication code");
  }

  await prisma.user.update({
    where: { id: userId },
    data: { twoFactorEnabled: true },
  });
  return { twoFactorEnabled: true };
}

export async function disableTwoFactor(userId: string, code: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, twoFactorEnabled: true, twoFactorSecret: true },
  });
  if (!user) throw notFound("User not found");
  if (user.role === "PLATFORM_ADMIN") {
    throw forbidden("Two-factor authentication is mandatory for platform administrators");
  }
  if (!user.twoFactorEnabled || !user.twoFactorSecret) {
    throw badRequest("Two-factor authentication is not enabled");
  }
  if (!verifyTotpCode(user.twoFactorSecret, code)) {
    throw badRequest("Invalid two-factor authentication code");
  }

  await prisma.user.update({
    where: { id: userId },
    data: { twoFactorEnabled: false, twoFactorSecret: null },
  });
  return { twoFactorEnabled: false };
}