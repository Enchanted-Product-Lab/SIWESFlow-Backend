import { prisma } from "../../lib/prisma.js";

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

// Within 7 days of the last submission is ACTIVE, within 14 is
// AT_RISK, anything older is INACTIVE. Measured from submission, not approval,
// so a slow supervisor never makes a diligent student look at risk. Until the
// first entry the clock starts at the SIWES start date, so a newly placed
// student is not born inactive. Only PLACED students are engaged or not.
//
// One statement for the whole table, and only rows whose status changes are
// written. Returns how many changed.
export async function refreshEngagement(now = new Date()): Promise<number> {
  const activeSince = new Date(now.getTime() - 7 * DAY);
  const atRiskSince = new Date(now.getTime() - 14 * DAY);
  return prisma.$executeRaw`
    WITH computed AS (
      SELECT s.id,
        CASE
          WHEN s."placementStatus" <> 'PLACED' THEN 'INACTIVE'
          WHEN COALESCE(s."lastActivitySubmittedAt", s."siwesStartDate", p."startDate") >= ${activeSince} THEN 'ACTIVE'
          WHEN COALESCE(s."lastActivitySubmittedAt", s."siwesStartDate", p."startDate") >= ${atRiskSince} THEN 'AT_RISK'
          ELSE 'INACTIVE'
        END::"EngagementStatus" AS status
      FROM "Student" s
      LEFT JOIN "Placement" p ON p.id = s."placementId"
    )
    UPDATE "Student" s
    SET "engagementStatus" = c.status
    FROM computed c
    WHERE s.id = c.id AND s."engagementStatus" <> c.status`;
}

// Several instances running it at once is harmless.
export function scheduleEngagementRefresh(everyMs = HOUR): void {
  const run = () =>
    refreshEngagement().catch((err) => console.error("[engagement] refresh failed", err));
  void run();
  setInterval(run, everyMs).unref();
}
