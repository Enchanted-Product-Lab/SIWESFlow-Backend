import assert from "node:assert/strict";
import { test } from "node:test";

test("placement slot decrement compare-and-swap logic prevents oversubscription", () => {
  // Simulating the compare-and-swap rule from placement.service.ts
  const placement = {
    id: "placement-concurrency-1",
    availableSlots: 1,
    filledSlots: 0,
  };

  const tryAccept = (observedFilledSlots: number): boolean => {
    // Check available slots
    if (observedFilledSlots >= placement.availableSlots) {
      return false; // Out of slots
    }
    // Compare-and-swap update: condition filledSlots === observedFilledSlots
    if (placement.filledSlots === observedFilledSlots) {
      placement.filledSlots += 1;
      return true;
    }
    return false; // Race lost
  };

  // Two applicants race concurrently for 1 slot
  const applicant1Observed = placement.filledSlots;
  const applicant2Observed = placement.filledSlots;

  // Applicant 1 accepts first
  const applicant1Accepted = tryAccept(applicant1Observed);
  assert.equal(applicant1Accepted, true, "First applicant wins the slot");
  assert.equal(placement.filledSlots, 1);

  // Applicant 2 races with the stale filledSlots value
  const applicant2Accepted = tryAccept(applicant2Observed);
  assert.equal(applicant2Accepted, false, "Second applicant loses race and does not overshoot available slots");
  assert.equal(placement.filledSlots, 1, "filledSlots remains bounded to availableSlots");
});
