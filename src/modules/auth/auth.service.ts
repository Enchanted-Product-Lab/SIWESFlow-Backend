import { randomBytes } from "node:crypto";
import bcrypt from "bcrypt";
import { prisma } from "../../lib/prisma.js";
import type { LoginInput, RegisterInput } from "./auth.schema.js";
import { sendVerificationEmail } from "../auth/email verification service/verification.service.js";
import { issueRefreshToken, signAccessToken } from "../auth/token service/token.service.js";
const BCRYPT_COST = 12;

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
  | { ok: false; reason: "INVALID_CREDENTIALS" | "EMAIL_NOT_VERIFIED" }
  | {
      ok: true;
      user: { id: string; email: string; role: string };
      accessToken: string;
      refreshToken: string;
    };

export async function loginUser({ email, password }: LoginInput): Promise<LoginResult> {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, role: true, passwordHash: true, isEmailVerified: true },
  });

  const passwordOk = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !passwordOk) return { ok: false, reason: "INVALID_CREDENTIALS" };

  // Only reached with the correct password, so this reveals nothing to a stranger
  if (!user.isEmailVerified) return { ok: false, reason: "EMAIL_NOT_VERIFIED" };

  const [accessToken, refreshToken] = await Promise.all([
    signAccessToken(user.id, user.role),
    issueRefreshToken(user.id),
  ]);

  return {
    ok: true,
    user: { id: user.id, email: user.email, role: user.role },
    accessToken,
    refreshToken,
  };
}