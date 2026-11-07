import { unauthorized } from "./http-error.js";

// Adapter between the RBAC middleware and the JWT implementation owned by the
// auth module. `requireAuth` is the only consumer, and it only needs the user
// id; keeping that boundary here means middleware never learns about jose or
// token claims.
export type TokenVerifier = (token: string) => Promise<{ userId: string }>;

const jwtVerifier: TokenVerifier = async (token) => {
  // Imported lazily so this module does not pull the auth module (and its env
  // validation) in at load time, and so tests can swap the verifier without
  // loading jose at all.
  const { verifyAccessToken } = await import(
    "../modules/auth/token service/token.service.js"
  );

  let payload: Awaited<ReturnType<typeof verifyAccessToken>>;
  try {
    payload = await verifyAccessToken(token);
  } catch {
    throw unauthorized("Invalid or expired token");
  }

  // The auth module puts the user id in `sub`; reject anything else rather
  // than letting a malformed token through as an empty id.
  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    throw unauthorized("Invalid token payload");
  }

  return { userId: payload.sub };
};

let verifier: TokenVerifier = jwtVerifier;

// Lets tests plug in a verifier without minting real JWTs.
export function setTokenVerifier(fn: TokenVerifier): void {
  verifier = fn;
}

export function verifyAccessToken(token: string): Promise<{ userId: string }> {
  return verifier(token);
}
