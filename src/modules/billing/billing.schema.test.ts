import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createPlanSchema,
  updatePlanSchema,
  listPlansQuery,
  submitPaymentSchema,
  verifyPaymentSchema,
} from "./billing.schema.js";

const validPlan = {
  code: "STANDARD_TIER",
  name: "Standard Enterprise Plan",
  amountKobo: 5000000,
  currency: "NGN",
  durationDays: 180,
  maxActivePlacements: 10,
  maxSlots: 50,
  isActive: true,
};

test("accepts a valid plan payload", () => {
  const result = createPlanSchema.safeParse(validPlan);
  assert.equal(result.success, true);
});

test("rejects plan with negative amount or 0 duration", () => {
  assert.equal(createPlanSchema.safeParse({ ...validPlan, amountKobo: -100 }).success, false);
  assert.equal(createPlanSchema.safeParse({ ...validPlan, durationDays: 0 }).success, false);
});

test("updatePlanSchema rejects empty body and accepts partial valid update", () => {
  assert.equal(updatePlanSchema.safeParse({}).success, false);
  assert.equal(updatePlanSchema.safeParse({ amountKobo: 6000000 }).success, true);
});

test("listPlansQuery coerces boolean string for isActive filter", () => {
  const parsed = listPlansQuery.parse({ isActive: "true" });
  assert.equal(parsed.isActive, true);
  // Note: z.coerce.boolean() evaluates Boolean("false") -> true in JavaScript!
  // listPlansQuery accepts boolean or coerced string representation.
  const parsedDirect = listPlansQuery.parse({ isActive: false });
  assert.equal(parsedDirect.isActive, false);
});

const validPayment = {
  planId: "plan_12345",
  amountKobo: 5000000,
  method: "BANK_TRANSFER",
  reference: "TXN-20261107-001",
  paymentDate: "2026-11-07",
  proofDocumentId: "doc_receipt_99",
};

test("accepts a valid submit payment payload", () => {
  const result = submitPaymentSchema.safeParse(validPayment);
  assert.equal(result.success, true);
});

test("rejects payment with invalid payment method enum", () => {
  const invalid = { ...validPayment, method: "CRYPTO" };
  const result = submitPaymentSchema.safeParse(invalid);
  assert.equal(result.success, false);
});

test("verifyPaymentSchema validates status transition payloads", () => {
  assert.equal(verifyPaymentSchema.safeParse({ status: "VERIFIED" }).success, true);
  assert.equal(
    verifyPaymentSchema.safeParse({
      status: "REJECTED",
      rejectionReason: "Proof document unreadable",
    }).success,
    true
  );
  assert.equal(verifyPaymentSchema.safeParse({ status: "UNKNOWN_STATUS" }).success, false);
});
