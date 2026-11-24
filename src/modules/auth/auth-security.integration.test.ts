// Password reset and mandatory admin TOTP 2FA integration tests against a
// real Postgres database and Express HTTP server.
// Skipped unless RUN_DB_TESTS=1:
//   DATABASE_URL=postgresql://... RUN_DB_TESTS=1 npm test
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { after, before, describe, test } from "node:test";
import type { Server } from "node:http";
import bcrypt from "bcrypt";
import { generateTotpCode } from "../../lib/totp.js";

const run = process.env.RUN_DB_TESTS === "1";
const suffix = `a${Date.now().toString(36)}`;

describe("auth password reset and mandatory admin 2FA", { skip: !run }, () => {
  let base = "";
  let server: Server;
  let prisma: typeof import("../../lib/prisma.js").prisma;

  const call = async (method: string, path: string, body?: unknown, token?: string) => {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };

  before(async () => {
    process.env.NODE_ENV = "development";
    process.env.JWT_ACCESS_SECRET ??= "integration-test-secret-at-least-32-chars!!";
    process.env.SUPABASE_URL ??= "http://127.0.0.1:54321";
    process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";
    process.env.UPSTASH_REDIS_REST_URL = "";
    process.env.UPSTASH_REDIS_REST_TOKEN = "";

    const appMod = await import("../../app.js");
    const prismaMod = await import("../../lib/prisma.js");
    prisma = prismaMod.prisma;

    await new Promise<void>((resolve) => {
      server = appMod.default.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("Expected numeric server port");
    base = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await prisma.$disconnect();
  });

  test("password reset issues token, updates password, revokes sessions, and blocks replay", async () => {
    const email = `reset-${suffix}@test.dev`;
    const oldPass = "OldStrongPassword123!";
    const newPass = "NewStrongPassword456!";
    const passwordHash = await bcrypt.hash(oldPass, 10);

    const user = await prisma.user.create({
      data: { email, passwordHash, role: "STUDENT", isEmailVerified: true },
    });

    // Log in with old password to create a refresh token session
    const login1 = await call("POST", "/api/auth/login", { email, password: oldPass });
    assert.equal(login1.status, 200);
    assert.ok(login1.body.accessToken);
    assert.equal(await prisma.refreshToken.count({ where: { userId: user.id } }), 1);

    // Unknown email still returns 202 (no user enumeration)
    const unknownReq = await call("POST", "/api/auth/forgot-password", {
      email: `unknown-${suffix}@test.dev`,
    });
    assert.equal(unknownReq.status, 202);

    // Known email returns 202 and persists PasswordResetToken
    const knownReq = await call("POST", "/api/auth/forgot-password", { email });
    assert.equal(knownReq.status, 202);

    // Insert a known token directly to test deterministic reset + expiry + replay
    const rawToken = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    // Invalid token rejected
    const badReset = await call("POST", "/api/auth/reset-password", {
      token: "invalid-token-of-sufficient-length-32chars",
      password: newPass,
    });
    assert.equal(badReset.status, 400);

    // Valid token resets password and revokes refresh tokens
    const goodReset = await call("POST", "/api/auth/reset-password", {
      token: rawToken,
      password: newPass,
    });
    assert.equal(goodReset.status, 200);
    assert.equal(await prisma.refreshToken.count({ where: { userId: user.id } }), 0);

    // Replay of same token fails
    const replay = await call("POST", "/api/auth/reset-password", {
      token: rawToken,
      password: "AnotherPassword789!",
    });
    assert.equal(replay.status, 400);

    // Old password fails; new password succeeds
    const oldLogin = await call("POST", "/api/auth/login", { email, password: oldPass });
    assert.equal(oldLogin.status, 401);

    const newLogin = await call("POST", "/api/auth/login", { email, password: newPass });
    assert.equal(newLogin.status, 200);
    assert.ok(newLogin.body.accessToken);
  });

  test("admin 2FA setup, enable, login challenge, and mandatory disable block", async () => {
    const email = `admin2fa-${suffix}@test.dev`;
    const pass = "AdminStrongPassword123!";
    const passwordHash = await bcrypt.hash(pass, 10);

    await prisma.user.create({
      data: { email, passwordHash, role: "PLATFORM_ADMIN", isEmailVerified: true },
    });

    // Initial login before 2FA setup
    const login1 = await call("POST", "/api/auth/login", { email, password: pass });
    assert.equal(login1.status, 200);
    const token = login1.body.accessToken as string;

    // Setup 2FA
    const setup = await call("POST", "/api/auth/2fa/setup", {}, token);
    assert.equal(setup.status, 200);
    assert.ok(setup.body.secret);
    assert.ok(setup.body.otpauthUrl.startsWith("otpauth://totp/"));

    // Enable fails with bad code
    const badEnable = await call("POST", "/api/auth/2fa/enable", { code: "000000" }, token);
    assert.equal(badEnable.status, 400);

    // Enable succeeds with valid TOTP code
    const code = generateTotpCode(setup.body.secret);
    const goodEnable = await call("POST", "/api/auth/2fa/enable", { code }, token);
    assert.equal(goodEnable.status, 200);
    assert.equal(goodEnable.body.twoFactorEnabled, true);

    // Login without totpCode returns 202 challenge with NO accessToken
    const challenge = await call("POST", "/api/auth/login", { email, password: pass });
    assert.equal(challenge.status, 202);
    assert.equal(challenge.body.requiresTwoFactor, true);
    assert.equal(challenge.body.accessToken, undefined);

    // Login with wrong totpCode returns 401
    const wrongCode = await call("POST", "/api/auth/login", {
      email,
      password: pass,
      totpCode: "000000",
    });
    assert.equal(wrongCode.status, 401);

    // Login with valid totpCode succeeds
    const validLogin = await call("POST", "/api/auth/login", {
      email,
      password: pass,
      totpCode: generateTotpCode(setup.body.secret),
    });
    assert.equal(validLogin.status, 200);
    assert.ok(validLogin.body.accessToken);
    assert.equal(validLogin.body.user.twoFactorEnabled, true);

    // PLATFORM_ADMIN cannot disable mandatory 2FA
    const disable = await call(
      "POST",
      "/api/auth/2fa/disable",
      { code: generateTotpCode(setup.body.secret) },
      validLogin.body.accessToken
    );
    assert.equal(disable.status, 403);
  });
});
