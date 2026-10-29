import type { CookieOptions } from "express";
import { env } from "../../config/env.js";
import { REFRESH_TOKEN_TTL_MS } from "../auth/token service/token.service.js";

export const REFRESH_COOKIE_NAME = "refresh_token";

export const refreshCookieOptions: CookieOptions = {
  httpOnly: true, // JavaScript can't read it
  secure: env.NODE_ENV === "production", // HTTPS only in production
  sameSite: "lax", // not sent on cross-site POSTs (CSRF defence)
  path: "/api/auth", // only sent to auth endpoints
  maxAge: REFRESH_TOKEN_TTL_MS,
};