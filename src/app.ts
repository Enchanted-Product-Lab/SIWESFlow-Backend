// src/app.ts
// Owns all middleware and routes. Doesn't read process.env at the top
// level, so it's safe to import before dotenv has loaded — but anything
// it imports (document.routes.ts → document.service.ts → supabase.ts)
// DOES read env vars at load time, so dotenv still has to run first in
// whichever file imports this one (server.ts).

import express from "express";
import { prisma } from "./lib/prisma.js";
import { documentRouter } from "./routes/document.routes.js";
import  authRouter  from "./modules/auth/auth.router.js";
import { errorHandler } from "./middlewares/errorhandlers.js";

const app = express();

app.use(express.json({ limit: "10kb" }));
app.use("/api/auth", authRouter);

app.get("/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ok", db: "connected" });
  } catch (err) {
    res.status(503).json({ status: "error", db: "unreachable" });
  }
});

app.use("/documents", documentRouter);

app.use(errorHandler)

export default app;

