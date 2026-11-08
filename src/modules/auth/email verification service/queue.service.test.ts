import assert from "node:assert/strict";
import { test } from "node:test";
import {
  enqueueVerificationEmail,
  dequeueVerificationEmail,
  drainVerificationQueue,
  type VerificationJob,
} from "./queue.service.js";

test("queue service handles enqueue, dequeue, and drain", async () => {
  const job: VerificationJob = {
    userId: "user-test-queue-1",
    email: "queue@test.dev",
    link: "http://localhost:3000/auth/verify?token=xyz",
    timestamp: Date.now(),
  };

  await enqueueVerificationEmail(job);
  const dequeued = await dequeueVerificationEmail();
  assert.ok(dequeued, "job should be dequeued");
  assert.equal(dequeued?.userId, job.userId);
  assert.equal(dequeued?.email, job.email);

  // Enqueue again and verify drain
  await enqueueVerificationEmail(job);
  const drainedCount = await drainVerificationQueue();
  assert.equal(drainedCount, 1, "should have drained 1 job");
});
