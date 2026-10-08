// auth.routes.ts
import { Router } from "express";
import { register } from "./auth.controller.js";
import { registerLimiter } from "../../middlewares/rate-limiters.js";

const router = Router();
router.post("/register", registerLimiter, register);
export default router;