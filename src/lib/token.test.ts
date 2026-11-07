import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { verifyAccessToken, setTokenVerifier } from "./token.js";

test("verifier extracts userId from sub claim", async () => {
  setTokenVerifier(async (token: string) => {
    if (token === "valid_jwt") return { userId: "usr_12345" };
    throw new Error("Invalid token");
  });

  const res = await verifyAccessToken("valid_jwt");
  assert.equal(res.userId, "usr_12345");
});

test("verifier rejects invalid token with error", async () => {
  setTokenVerifier(async () => {
    throw new Error("Invalid token");
  });

  await assert.rejects(
    async () => {
      await verifyAccessToken("bad_token");
    },
    /Invalid token/
  );
});

afterEach(() => {
  // Reset token verifier
  setTokenVerifier(async (token: string) => {
    if (!token) throw new Error("Empty token");
    return { userId: "default_user" };
  });
});
