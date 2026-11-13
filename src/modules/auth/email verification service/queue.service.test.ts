import assert from "node:assert/strict";
import { before, test } from "node:test";
import type { VerificationJob } from "./queue.service.js";

// Hermetic unit test: never touches the live Upstash instance or a real
// email provider. dotenv in config/env.ts does not override variables that
// are already set, so this wins over backend/.env here and in CI.
let svc: typeof import("./queue.service.js");

before(async () => {
  process.env.UPSTASH_REDIS_REST_URL = "";
  process.env.UPSTASH_REDIS_REST_TOKEN = "";
  process.env.NODE_ENV = "development";
  svc = await import("./queue.service.js");
});

test("queue service handles enqueue, dequeue, and drain", async () => {
  const { enqueueVerificationEmail, dequeueVerificationEmail, drainVerificationQueue } = svc;

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
