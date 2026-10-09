import bcrypt from "bcrypt";
import { prisma } from "../../lib/prisma.js";
import type { RegisterInput } from "./auth.schema.js";
import { sendVerificationEmail } from "../auth/email verification service/verification.service.js";

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