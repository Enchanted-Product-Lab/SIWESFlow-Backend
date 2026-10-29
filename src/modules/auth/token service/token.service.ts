import { createHash, randomBytes, randomUUID } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { prisma } from "../../../lib/prisma.js";
import { env } from "../../../config/env.js";

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const ISSUER = "siwesflow-api";
const AUDIENCE = "siwesflow-app";
const accessSecret = new TextEncoder().encode(env.JWT_ACCESS_SECRET);

export async function signAccessToken(userId: string, role: string): Promise<string> {
  return new SignJWT({ role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ACCESS_TOKEN_TTL_SECONDS)
    .setJti(randomUUID())
    .sign(accessSecret);
}

// Used by the RBAC middleware next week. Pinning the algorithm blocks "alg confusion" attacks.
export async function verifyAccessToken(token: string) {
  const { payload } = await jwtVerify(token, accessSecret, {
    issuer: ISSUER,
    audience: AUDIENCE,
    algorithms: ["HS256"],
  });
  return payload;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function issueRefreshToken(userId: string, familyId: string = randomUUID()): Promise<string> {
  const token = randomBytes(32).toString("base64url");

  await prisma.refreshToken.create({
    data: {
      userId,
      familyId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    },
  });

  return token;
}