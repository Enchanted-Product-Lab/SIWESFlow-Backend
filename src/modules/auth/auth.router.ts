import { Router } from "express";
import { login, register, resendVerification, verifyEmail } from "./auth.controller.js";
import {
  loginEmailLimiter,
  loginIpLimiter,
  registerLimiter,
  resendEmailLimiter,
  resendIpLimiter,
  verifyEmailLimiter,
} from "../../middlewares/rate-limiters.js";

const router = Router();

// Auth responses carry tokens and must never be cached by browsers or proxies
router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

router.post("/register", registerLimiter, register);
router.post("/verify-email", verifyEmailLimiter, verifyEmail);
router.post("/resend-verification", resendIpLimiter, resendEmailLimiter, resendVerification);
router.post("/login", loginIpLimiter, loginEmailLimiter, login);

export default router;

