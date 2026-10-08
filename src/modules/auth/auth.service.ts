import bcrypt from "bcrypt";
import { prisma } from "../../lib/prisma.js";
import type { RegisterInput } from "./auth.schema.js";

const BCRYPT_COST = 12;

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && err.code === "P2002";
}

export async function registerUser({ email, password }: RegisterInput): Promise<void> {
  // Hash first, so the "email exists" and "new email" paths cost about the same time
  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

  try {
    await prisma.user.create({
      data: { email, passwordHash: passwordHash, role: "STUDENT" },
      select: { id: true }, // never load the hash back from the DB
    });
  } catch (err) {
    if (isUniqueViolation(err)) return; // already registered: stay silent
    throw err;
  }

  // TODO (next step): create an email-verification token and send the email
}