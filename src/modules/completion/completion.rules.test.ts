import assert from "node:assert/strict";
import { test } from "node:test";
import { assessRequirements, weekOf } from "./completion.rules.js";

const at = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

test("weeks run Monday to Sunday", () => {
  // 2026-11-09 is a Monday.
  assert.equal(weekOf(at("2026-11-09")), weekOf(at("2026-11-15")));
  assert.equal(weekOf(at("2026-11-15")) + 1, weekOf(at("2026-11-16")));
  assert.equal(weekOf(at("2026-11-08")) + 1, weekOf(at("2026-11-09")));
});

test("only approved entries count, each week once", () => {
  const r = assessRequirements(
    [
      { status: "APPROVED", hoursWorked: 8, date: at("2026-11-09") },
      { status: "APPROVED", hoursWorked: 8, date: at("2026-11-10") },
      { status: "APPROVED", hoursWorked: 4, date: at("2026-11-16") },
      { status: "REJECTED", hoursWorked: 8, date: at("2026-11-23") },
    ],
    { hours: 20, weeks: 2 }
  );
  assert.deepEqual(r, {
    totalHours: 20,
    minHours: 20,
    weeksLogged: 2,
    minWeeks: 2,
    approvedEntries: 3,
    unreviewedEntries: 0,
    met: true,
  });
});

test("short hours, short weeks or an unsettled entry each fail it", () => {
  const ok = { status: "APPROVED" as const, hoursWorked: 10, date: at("2026-11-09") };
  const min = { hours: 10, weeks: 1 };
  assert.equal(assessRequirements([ok], min).met, true);
  assert.equal(assessRequirements([ok], { hours: 11, weeks: 1 }).met, false);
  assert.equal(assessRequirements([ok], { hours: 10, weeks: 2 }).met, false);
  for (const status of ["PENDING", "NEEDS_REVISION"] as const) {
    const r = assessRequirements([ok, { ...ok, status }], min);
    assert.equal(r.met, false, status);
    assert.equal(r.unreviewedEntries, 1);
  }
  assert.equal(assessRequirements([], min).met, false);
});
