import assert from "node:assert/strict";
import { test } from "node:test";
import {
  acceptApplicationSchema,
  createPlacementSchema,
  updatePlacementSchema,
  listPlacementsQuery,
  applySchema,
  approvePlacementSchema,
} from "./placement.schema.js";

const validPlacement = {
  title: "Software Engineering Intern",
  description: "Hands-on experience with TypeScript and React.",
  department: "Engineering",
  requiredLevel: "300",
  requiredSkills: ["TypeScript", "Node.js", "PostgreSQL"],
  availableSlots: 5,
  startDate: "2026-06-01",
  endDate: "2026-11-30",
  location: "Lagos, Nigeria",
  workMode: "HYBRID",
};

test("accepts a valid placement payload", () => {
  const result = createPlacementSchema.safeParse(validPlacement);
  assert.equal(result.success, true);
});

test("rejects when availableSlots is less than 1 or negative", () => {
  const invalid = { ...validPlacement, availableSlots: 0 };
  const res = createPlacementSchema.safeParse(invalid);
  assert.equal(res.success, false);
});

test("rejects when endDate is before startDate", () => {
  const invalid = {
    ...validPlacement,
    startDate: "2026-11-30",
    endDate: "2026-06-01",
  };
  const res = createPlacementSchema.safeParse(invalid);
  assert.equal(res.success, false);
  if (!res.success) {
    const endErr = res.error.issues.find((i) => i.path.includes("endDate"));
    assert.ok(endErr, "Expected validation issue on endDate");
  }
});

test("rejects invalid workMode enum", () => {
  const invalid = { ...validPlacement, workMode: "ANYWHERE" };
  const res = createPlacementSchema.safeParse(invalid);
  assert.equal(res.success, false);
});

test("rejects unknown system properties in strict mode", () => {
  const invalid = { ...validPlacement, isApproved: true, slotsRemaining: 5 };
  const res = createPlacementSchema.safeParse(invalid);
  assert.equal(res.success, false);
});

test("update placement rejects empty update object", () => {
  const res = updatePlacementSchema.safeParse({});
  assert.equal(res.success, false);
});

test("update placement accepts partial valid fields", () => {
  const res = updatePlacementSchema.safeParse({ availableSlots: 10, workMode: "REMOTE" });
  assert.equal(res.success, true);
});

test("listPlacementsQuery parses valid filters and defaults", () => {
  const parsed = listPlacementsQuery.parse({ page: "1", pageSize: "20", workMode: "REMOTE" });
  assert.equal(parsed.page, 1);
  assert.equal(parsed.pageSize, 20);
  assert.equal(parsed.workMode, "REMOTE");
});

test("listPlacementsQuery rejects bad date ranges where to is before from", () => {
  const res = listPlacementsQuery.safeParse({ from: "2026-08-01", to: "2026-05-01" });
  assert.equal(res.success, false);
});

test("applySchema allows optional cover note and enforces length", () => {
  assert.equal(applySchema.safeParse({}).success, true);
  assert.equal(applySchema.safeParse({ coverNote: "Interested in backend" }).success, true);
  assert.equal(applySchema.safeParse({ coverNote: "x".repeat(2001) }).success, false);
});

test("approvePlacementSchema requires valid approval status", () => {
  assert.equal(approvePlacementSchema.safeParse({ approvalStatus: "APPROVED" }).success, true);
  assert.equal(approvePlacementSchema.safeParse({ approvalStatus: "REJECTED", approvalNote: "Slots full" }).success, true);
  assert.equal(approvePlacementSchema.safeParse({ approvalStatus: "PENDING" }).success, true);
  assert.equal(approvePlacementSchema.safeParse({ approvalStatus: "INVALID_STATUS" }).success, false);
});

test("acceptApplicationSchema validates optional supervisorId and note", () => {
  assert.equal(acceptApplicationSchema.safeParse({}).success, true);
  assert.equal(acceptApplicationSchema.safeParse({ supervisorId: "sup-123" }).success, true);
  assert.equal(acceptApplicationSchema.safeParse({ supervisorId: "sup-123", note: "Welcome to the team" }).success, true);
  assert.equal(acceptApplicationSchema.safeParse({ supervisorId: "" }).success, false);
  assert.equal(acceptApplicationSchema.safeParse({ unknownField: "bad" }).success, false);
});
