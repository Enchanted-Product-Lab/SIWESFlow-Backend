import test from "node:test";
import assert from "node:assert/strict";
import { buildOtpAuthUrl, generateTotpCode, generateTotpSecret, verifyTotpCode } from "./totp.js";
import { forgotPasswordSchema, resetPasswordSchema, totpCodeSchema } from "../modules/auth/auth.schema.js";

test("TOTP generates valid 6-digit codes and verifies within window", () => {
  const secret = generateTotpSecret();
  const now = Date.now();
  const code = generateTotpCode(secret, now);
  assert.match(code, /^\d{6}$/);
  assert.equal(verifyTotpCode(secret, code, now), true);
  // Previous 30s window should still verify
  assert.equal(verifyTotpCode(secret, code, now + 30_000), true);
  // Far future should fail
  assert.equal(verifyTotpCode(secret, code, now + 120_000), false);
  // Bad format should fail
  assert.equal(verifyTotpCode(secret, "abcdef", now), false);
});

test("buildOtpAuthUrl includes issuer and secret", () => {
  const url = buildOtpAuthUrl("admin@siwesflow.com", "JBSWY3DPEHPK3PXP");
  assert.ok(url.startsWith("otpauth://totp/SIWESFlow%3Aadmin%40siwesflow.com"));
  assert.ok(url.includes("secret=JBSWY3DPEHPK3PXP"));
});

test("forgotPasswordSchema, resetPasswordSchema and totpCodeSchema validate properly", () => {
  assert.equal(forgotPasswordSchema.safeParse({ email: "USER@Example.com" }).success, true);
  assert.equal(forgotPasswordSchema.safeParse({ email: "not-an-email" }).success, false);
  assert.equal(
    resetPasswordSchema.safeParse({ token: "a".repeat(32), password: "StrongPassword123!" }).success,
    true
  );
  assert.equal(resetPasswordSchema.safeParse({ token: "short", password: "StrongPassword123!" }).success, false);
  assert.equal(resetPasswordSchema.safeParse({ token: "a".repeat(32), password: "short" }).success, false);
  assert.equal(totpCodeSchema.safeParse({ code: "123456" }).success, true);
  assert.equal(totpCodeSchema.safeParse({ code: "12345" }).success, false);
});
