import { Router } from "express";
import { register, resendVerification, verifyEmail } from "./auth.controller.js";
import {
  registerLimiter,
  resendEmailLimiter,
  resendIpLimiter,
  verifyEmailLimiter,
} from "../../middlewares/rate-limiters.js";

const router = Router();

router.post("/register", registerLimiter, register);
router.post("/verify-email", verifyEmailLimiter, verifyEmail);
router.post("/resend-verification", resendIpLimiter, resendEmailLimiter, resendVerification);

export default router;