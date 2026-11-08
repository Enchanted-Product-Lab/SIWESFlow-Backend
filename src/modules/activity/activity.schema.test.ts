import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createActivitySchema,
  listActivitiesQuery,
  reviewActivitySchema,
  updateActivitySchema,
} from "./activity.schema.js";

const entry = {
  date: "2026-06-15",
  title: "Set up the placements table",
  description: "Modelled companies, slots and the approval column.",
  hoursWorked: 6,
  whatILearned: "Foreign keys need an index when queried from both sides.",
  skillsUsed: ["Postgres", "Prisma"],
  challenges: "Naming the join table.",
  category: "Database",
  documentId: "doc_1",
};

test("accepts a valid entry", () => {
  assert.equal(createActivitySchema.safeParse(entry).success, true);
});

test("accepts the minimum fields", () => {
  const minimal = { date: "2026-06-15", title: "x", description: "y", hoursWorked: 1 };
  assert.equal(createActivitySchema.safeParse(minimal).success, true);
});

test("rejects system-managed and identity fields", () => {
  for (const extra of [
    { status: "APPROVED" },
    { studentId: "stu_1" },
    { reviewedById: "sup_1" },
    { rating: 5 },
    { submittedAt: "2026-06-15" },
    { createdAt: "2026-06-15" },
  ]) {
    assert.equal(createActivitySchema.safeParse({ ...entry, ...extra }).success, false);
  }
});

test("requires every core field", () => {
  for (const missing of ["date", "title", "description", "hoursWorked"] as const) {
    const rest: Record<string, unknown> = { ...entry };
    delete rest[missing];
    assert.equal(createActivitySchema.safeParse(rest).success, false, missing);
  }
});

test("bounds hoursWorked to one day", () => {
  const hours = (n: number) =>
    createActivitySchema.safeParse({ ...entry, hoursWorked: n }).success;
  assert.equal(hours(0), false);
  assert.equal(hours(-3), false);
  assert.ok(hours(0.25));
  assert.ok(hours(24));
  assert.equal(hours(24.5), false);
  assert.equal(hours(168), false);
  assert.equal(hours(Number.NaN), false);
});

test("rejects an unparseable date and a blank title", () => {
  assert.equal(createActivitySchema.safeParse({ ...entry, date: "last tuesday" }).success, false);
  assert.equal(createActivitySchema.safeParse({ ...entry, title: "   " }).success, false);
});

test("caps the skills list", () => {
  assert.ok(
    createActivitySchema.safeParse({ ...entry, skillsUsed: Array(20).fill("skill") }).success
  );
  assert.equal(
    createActivitySchema.safeParse({ ...entry, skillsUsed: Array(21).fill("skill") }).success,
    false
  );
});

test("an update must change something and may be partial", () => {
  assert.equal(updateActivitySchema.safeParse({}).success, false);
  assert.ok(updateActivitySchema.safeParse({ title: "Renamed" }).success);
  assert.equal(updateActivitySchema.safeParse({ status: "APPROVED" }).success, false);
});

test("a review needs a comment unless it approves the entry", () => {
  assert.ok(reviewActivitySchema.safeParse({ status: "APPROVED" }).success);
  assert.ok(reviewActivitySchema.safeParse({ status: "NEEDS_REVISION", comment: "Add detail" }).success);
  assert.equal(reviewActivitySchema.safeParse({ status: "NEEDS_REVISION" }).success, false);
  assert.equal(reviewActivitySchema.safeParse({ status: "NEEDS_REVISION", comment: "   " }).success, false);
});

test("list query defaults paging", () => {
  const parsed = listActivitiesQuery.parse({});
  assert.equal(parsed.page, 1);
  assert.equal(parsed.pageSize, 20);
});

test("list query rejects bad paging, status and date range", () => {
  assert.equal(listActivitiesQuery.safeParse({ page: 0 }).success, false);
  assert.equal(listActivitiesQuery.safeParse({ pageSize: 101 }).success, false);
  assert.ok(listActivitiesQuery.safeParse({ status: "APPROVED" }).success);
  assert.equal(listActivitiesQuery.safeParse({ status: "approved" }).success, false);
  assert.equal(
    listActivitiesQuery.safeParse({ from: "2026-06-30", to: "2026-06-01" }).success,
    false
  );
  assert.ok(listActivitiesQuery.safeParse({ from: "2026-06-01", to: "2026-06-30" }).success);
});
