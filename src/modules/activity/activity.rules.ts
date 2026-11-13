import type { ActivityStatus } from "../../generated/prisma/client.js";

// Locks an entry once it is approved or rejected, so it is editable only
// while awaiting review or sent back for correction.
export const canEdit = (status: ActivityStatus) =>
  status === "PENDING" || status === "NEEDS_REVISION";

// Both ends are optional: a student may log before the school records the dates.
export interface SiwesWindow {
  start: Date | null;
  end: Date | null;
}

export type DateProblem = { ok: true } | { ok: false; message: string };

// Days are cut in UTC: entry dates and period bounds arrive as UTC instants, so
// using the server's clock would make validity depend on where the box runs.
export const startOfDay = (d: Date): Date =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

export const endOfDay = (d: Date): Date =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));

// All of today counts as past.
// shortcut: the bound is the latest day anywhere on earth (UTC+14), so a WAT student
// logging just after local midnight is not told their own today is the future.
export function checkNotFuture(date: Date, now: Date): DateProblem {
  const latestToday = new Date(now.getTime() + 14 * 60 * 60 * 1000);
  if (date.getTime() > endOfDay(latestToday).getTime()) {
    return { ok: false, message: "An entry cannot be dated in the future" };
  }
  return { ok: true };
}

// Bounds are inclusive days. Skipped entirely when no period is on record.
export function checkWithinPeriod(date: Date, window: SiwesWindow): DateProblem {
  if (!window.start && !window.end) return { ok: true };

  if (window.start && date < startOfDay(window.start)) {
    return { ok: false, message: "Entry date is before the SIWES period starts" };
  }
  if (window.end && date > endOfDay(window.end)) {
    return { ok: false, message: "Entry date is after the SIWES period ends" };
  }
  return { ok: true };
}

// shortcut: how far back an entry may be dated is undefined in the sprint plan
// and is an open question for the lead. One place for the rule to land in.
export function checkBackdating(_date: Date, _now: Date): DateProblem {
  return { ok: true };
}
