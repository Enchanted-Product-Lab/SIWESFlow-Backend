import rateLimit from "express-rate-limit";

const FIFTEEN_MINUTES = 15 * 60 * 1000;

function createLimiter(limit: number) {
  return rateLimit({
    windowMs: FIFTEEN_MINUTES,
    limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Too many requests, please try again later" },
  });
}

function emailFromBody(req: { body?: { email?: unknown } }, prefix: string): string {
  return `${prefix}:${String(req.body?.email ?? "").trim().toLowerCase()}`;
}

export const registerLimiter = createLimiter(30);
export const verifyEmailLimiter = createLimiter(30);
export const resendIpLimiter = createLimiter(30);

// Per-email cap, so nobody can flood one person's inbox however many IPs they use
export const resendEmailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 3,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => emailFromBody(req, "resend"),
  message: { error: "Too many requests, please try again later" },
});

// Login limiters count failed attempts only (successful logins are skipped)
export const loginIpLimiter = rateLimit({
  windowMs: FIFTEEN_MINUTES,
  limit: 30,
  skipSuccessfulRequests: true,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later" },
});

export const loginEmailLimiter = rateLimit({
  windowMs: FIFTEEN_MINUTES,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => emailFromBody(req, "login"),
  message: { error: "Too many requests, please try again later" },
});
