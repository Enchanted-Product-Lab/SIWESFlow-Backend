// src/server.ts
// Just the entrypoint: load env vars, then boot the app defined in app.ts.
// This MUST be the first import in the whole run, before app.ts, so that
// every env-reading module app.ts pulls in (supabase.ts, prisma.ts) sees
// a populated process.env the moment it loads.

import "dotenv/config";
import app from "./app.js";
import { scheduleEngagementRefresh } from "./modules/engagement/engagement.service.js";

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`SIWESFlow API listening on port ${PORT}`);
});

scheduleEngagementRefresh();