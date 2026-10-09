import rateLimit from "express-rate-limit";

function createLimiter(limit: number) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Too many requests, please try again later" },
  });
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
  keyGenerator: (req) => `resend:${String(req.body?.email ?? "").trim().toLowerCase()}`,
  message: { error: "Too many requests, please try again later" },
});
