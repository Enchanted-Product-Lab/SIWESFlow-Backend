import type { ActivityStatus } from "../../generated/prisma/client.js";

const DAY = 24 * 60 * 60 * 1000;

// Monday-to-Sunday UTC week number. 1970-01-01 was a Thursday, hence the 3 days.
export const weekOf = (date: Date): number => Math.floor((date.getTime() + 3 * DAY) / (7 * DAY));

export interface Minimums {
  hours: number;
  weeks: number;
}

export interface Requirements {
  totalHours: number;
  minHours: number;
  weeksLogged: number;
  minWeeks: number;
  approvedEntries: number;
  // PENDING or NEEDS_REVISION: wants every log settled first.
  unreviewedEntries: number;
  met: boolean;
}

// Only approved entries count toward hours and weeks; a week counts once it
// holds at least one approved entry. Rejected entries neither count nor block.
export function assessRequirements(
  entries: { status: ActivityStatus; hoursWorked: number; date: Date }[],
  min: Minimums
): Requirements {
  const approved = entries.filter((e) => e.status === "APPROVED");
  const totalHours = approved.reduce((sum, e) => sum + e.hoursWorked, 0);
  const weeksLogged = new Set(approved.map((e) => weekOf(e.date))).size;
  const unreviewedEntries = entries.filter(
    (e) => e.status === "PENDING" || e.status === "NEEDS_REVISION"
  ).length;
  return {
    totalHours,
    minHours: min.hours,
    weeksLogged,
    minWeeks: min.weeks,
    approvedEntries: approved.length,
    unreviewedEntries,
    met: totalHours >= min.hours && weeksLogged >= min.weeks && unreviewedEntries === 0,
  };
}
