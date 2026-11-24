import { Router } from "express";
import {
  disable2FA,
  enable2FA,
  forgotPassword,
  login,
  register,
  resendVerification,
  resetPasswordHandler,
  setup2FA,
  verifyEmail,
} from "./auth.controller.js";
import { requireAuth } from "../../middlewares/auth.js";
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
router.get("/verify-email", verifyEmailLimiter, verifyEmail);
router.post("/resend-verification", resendIpLimiter, resendEmailLimiter, resendVerification);
router.post("/login", loginIpLimiter, loginEmailLimiter, login);
router.post("/forgot-password", resendIpLimiter, resendEmailLimiter, forgotPassword);
router.post("/reset-password", verifyEmailLimiter, resetPasswordHandler);

router.post("/2fa/setup", requireAuth, setup2FA);
router.post("/2fa/enable", requireAuth, enable2FA);
router.post("/2fa/disable", requireAuth, disable2FA);

router.get("/me", requireAuth, (req, res) => {
  res.json({
    id: req.user!.id,
    email: req.user!.email,
    role: req.user!.role,
  });
});

export default router;
