import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../../../lib/prisma.js";
import { env } from "../../../config/env.js";
import { sendEmail } from "../email verification service/email.service.js";

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function createVerificationToken(userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");

  // One active token per user: a new one invalidates any earlier link
  await prisma.$transaction([
    prisma.emailVerificationToken.deleteMany({ where: { userId } }),
    prisma.emailVerificationToken.create({
      data: {
        userId,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
      },
    }),
  ]);

  return token;
}

export async function sendVerificationEmail(userId: string, email: string): Promise<void> {
  const token = await createVerificationToken(userId);
  const link = `${env.EMAIL_VERIFICATION_URL}?token=${token}`;

  await sendEmail({
    to: email,
    subject: "Verify your SIWESFlow email address",
    text:
      `Welcome to SIWESFlow.\n\n` +
      `Verify your email address with this link (valid for 24 hours):\n${link}\n\n` +
      `If you didn't create an account, you can ignore this email.`,
  });
}

export async function resendVerificationEmail(email: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, isEmailVerified: true },
  });
  if (!user || user.isEmailVerified) return; // nothing to send, and no signal to the caller

  await sendVerificationEmail(user.id, email);
}

export async function verifyEmailToken(token: string): Promise<boolean> {
  const tokenHash = hashToken(token);

  return prisma.$transaction(async (tx) => {
    const record = await tx.emailVerificationToken.findUnique({ where: { tokenHash } });
    if (!record) return false;

    // Delete first, then act on the result. If two requests race with the same
    // token, only one deletes a row (count = 1), so the token is truly single-use.
    const { count } = await tx.emailVerificationToken.deleteMany({ where: { id: record.id } });
    if (count !== 1 || record.expiresAt < new Date()) return false;

    await tx.user.update({
      where: { id: record.userId },
      data: { isEmailVerified: true },
    });
    return true;
  });
}