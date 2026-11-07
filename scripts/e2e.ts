// End-to-end smoke test against a running server and a seeded database.
//
//   npx tsx scripts/dev-db.ts start --foreground   # terminal 1
//   npx tsx src/server.ts                          # terminal 2
//   npx tsx scripts/seed-dev.ts
//   npx tsx scripts/e2e.ts
//
// Every assertion is a real HTTP call; nothing is mocked.
import "dotenv/config";
import assert from "node:assert/strict";

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:4000";
const PASSWORD = "SiwesFlow2026!";
const suffix = Date.now().toString(36);

let passed = 0;
let failed = 0;

interface Result {
  status: number;
  body: any;
}

async function call(
  method: string,
  path: string,
  token?: string,
  body?: unknown,
): Promise<Result> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let parsed: any = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* leave as text */
  }
  return { status: res.status, body: parsed };
}

async function step(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed += 1;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL  ${name}`);
    console.error(`        ${err instanceof Error ? err.message : String(err)}`);
  }
}

const expect = (actual: number, expected: number, label: string) =>
  assert.equal(actual, expected, `${label}: expected ${expected}, got ${actual}`);

async function login(email: string): Promise<string> {
  const res = await call("POST", "/api/auth/login", undefined, { email, password: PASSWORD });
  expect(res.status, 200, `login ${email}`);
  assert.ok(res.body.accessToken, `login ${email}: no accessToken`);
  return res.body.accessToken as string;
}

async function main() {
  console.log(`\nSIWESFlow end-to-end checks against ${BASE}\n`);

  const tokens: Record<string, string> = {};

  await step("health reports the database is reachable", async () => {
    const res = await call("GET", "/health");
    expect(res.status, 200, "health");
    assert.equal(res.body.status, "ok");
    assert.equal(res.body.db, "connected");
  });

  await step("every seeded role can log in", async () => {
    tokens.admin = await login("admin@siwesflow.dev");
    tokens.coordinator = await login("coordinator@siwesflow.dev");
    tokens.company = await login("company@siwesflow.dev");
    tokens.supervisor = await login("supervisor@siwesflow.dev");
    tokens.student = await login("student@siwesflow.dev");
    tokens.student2 = await login("student2@siwesflow.dev");
  });

  await step("unauthenticated requests are rejected", async () => {
    expect((await call("GET", "/api/placements")).status, 401, "no token");
  });

  let placementId = "";
  const startDate = "2027-01-05T00:00:00.000Z";
  const endDate = "2027-05-30T00:00:00.000Z";

  await step("a student cannot create a placement", async () => {
    const res = await call("POST", "/api/placements", tokens.student, {
      companyId: "whatever",
      title: "Nope",
      department: "Nope",
      availableSlots: 1,
      startDate,
      endDate,
      workMode: "REMOTE",
    });
    expect(res.status, 403, "student create");
  });

  await step("a company admin creates a placement (starts PENDING)", async () => {
    const res = await call("POST", "/api/placements", tokens.company, {
      companyId: "ignored-server-side",
      title: "Software Engineering Intern",
      description: "Work on the payments platform.",
      department: "Platform",
      requiredLevel: "300",
      requiredSkills: ["TypeScript", "PostgreSQL"],
      availableSlots: 1,
      startDate,
      endDate,
      location: "Lagos",
      workMode: "HYBRID",
    });
    expect(res.status, 201, "create placement");
    assert.equal(res.body.approvalStatus, "PENDING");
    assert.equal(res.body.isActive, true);
    assert.equal(res.body.filledSlots, 0);
    placementId = res.body.id;
    assert.ok(placementId, "no placement id returned");
  });

  await step("students do not see an unapproved placement", async () => {
    const res = await call("GET", "/api/placements", tokens.student);
    expect(res.status, 200, "list as student");
    assert.equal(res.body.total, 0);
  });

  await step("a coordinator approves the placement", async () => {
    const res = await call("POST", `/api/placements/${placementId}/approval`, tokens.coordinator, {
      approvalStatus: "APPROVED",
      approvalNote: "Verified against the company record.",
    });
    expect(res.status, 200, "approve");
    assert.equal(res.body.approvalStatus, "APPROVED");
  });

  await step("students now see the approved placement", async () => {
    const res = await call("GET", "/api/placements?page=1&pageSize=10", tokens.student);
    expect(res.status, 200, "list as student");
    assert.equal(res.body.total, 1);
    assert.equal(res.body.data[0].id, placementId);
    assert.ok(res.body.data[0].company?.name, "company summary missing");
  });

  await step("placement details are readable by the student", async () => {
    const res = await call("GET", `/api/placements/${placementId}`, tokens.student);
    expect(res.status, 200, "details");
    assert.equal(res.body.availableSlots, 1);
  });

  let applicationId = "";

  await step("a student applies, and the student becomes APPLIED", async () => {
    const res = await call("POST", `/api/placements/${placementId}/apply`, tokens.student, {
      coverNote: "I have shipped TypeScript services before.",
    });
    expect(res.status, 201, "apply");
    assert.equal(res.body.status, "PENDING");
    applicationId = res.body.id;

    const me = await call("GET", `/api/students/me`, tokens.student);
    if (me.status === 200) assert.equal(me.body.placementStatus, "APPLIED");
  });

  await step("the same student cannot apply twice", async () => {
    const res = await call("POST", `/api/placements/${placementId}/apply`, tokens.student, {});
    expect(res.status, 409, "duplicate apply");
  });

  await step("a second student applies for the single slot", async () => {
    const res = await call("POST", `/api/placements/${placementId}/apply`, tokens.student2, {});
    expect(res.status, 201, "second apply");
  });

  await step("the company sees both applications", async () => {
    const res = await call("GET", `/api/placements/${placementId}/applications`, tokens.company);
    expect(res.status, 200, "applications");
    assert.equal(res.body.length, 2);
  });

  await step("accepting consumes the slot and places the student", async () => {
    const res = await call(
      "POST",
      `/api/placements/applications/${applicationId}/accept`,
      tokens.company,
    );
    expect(res.status, 200, "accept");
    assert.equal(res.body.status, "ACCEPTED");

    const placement = await call("GET", `/api/placements/${placementId}`, tokens.company);
    assert.equal(placement.body.filledSlots, 1);

    const me = await call("GET", `/api/students/me`, tokens.student);
    if (me.status === 200) {
      assert.equal(me.body.placementStatus, "PLACED");
      assert.equal(me.body.placementId, placementId);
    }
  });

  await step("the last slot cannot be oversold", async () => {
    const pending = await call("GET", `/api/placements/${placementId}/applications`, tokens.company);
    const other = pending.body.find((a: any) => a.status === "PENDING");
    assert.ok(other, "expected a pending application for the second student");
    const res = await call(
      "POST",
      `/api/placements/applications/${other.id}/accept`,
      tokens.company,
    );
    expect(res.status, 409, "overbook");
  });

  let activityId = "";

  await step("a student logs an activity inside the SIWES window", async () => {
    const res = await call("POST", "/api/activities", tokens.student, {
      date: "2026-07-01",
      title: "Built the placement approval queue",
      description: "Implemented the coordinator review screen and its API.",
      whatILearned: "How to model an approval state machine.",
      skillsUsed: ["TypeScript", "Prisma"],
      hoursWorked: 8,
      category: "Development",
    });
    expect(res.status, 201, "create activity");
    assert.equal(res.body.status, "PENDING");
    assert.ok(res.body.submittedAt, "submittedAt was not stamped");
    activityId = res.body.id;
  });

  await step("an entry outside the SIWES window is rejected", async () => {
    const res = await call("POST", "/api/activities", tokens.student, {
      date: "2027-02-01",
      title: "Outside the window",
      description: "Should not be accepted.",
      hoursWorked: 4,
    });
    expect(res.status, 400, "outside window");
  });

  await step("more than 24 hours in one entry is rejected", async () => {
    const res = await call("POST", "/api/activities", tokens.student, {
      date: "2026-07-02",
      title: "Impossible day",
      description: "Should not be accepted.",
      hoursWorked: 25,
    });
    expect(res.status, 400, "hours cap");
  });

  await step("the assigned supervisor reviews the entry", async () => {
    const res = await call("POST", `/api/activities/${activityId}/review`, tokens.supervisor, {
      status: "APPROVED",
      rating: 5,
      comment: "Clear and well documented.",
    });
    expect(res.status, 200, "review");
    assert.equal(res.body.status, "APPROVED");
    assert.ok(res.body.reviewedAt, "reviewedAt missing");
  });

  await step("an approved entry cannot be reviewed again", async () => {
    const res = await call("POST", `/api/activities/${activityId}/review`, tokens.supervisor, {
      status: "NEEDS_REVISION",
    });
    expect(res.status, 409, "double review");
  });

  await step("the student sees the supervisor's decision", async () => {
    const res = await call("GET", `/api/activities/${activityId}`, tokens.student);
    expect(res.status, 200, "read activity");
    assert.equal(res.body.status, "APPROVED");
    // The detail view nests the supervisor's verdict so a resubmitted entry can
    // hide the previous one without losing it.
    assert.equal(res.body.review?.rating, 5);
    assert.equal(res.body.review?.status, "APPROVED");
  });

  await step("a student cannot review activities", async () => {
    const res = await call("POST", `/api/activities/${activityId}/review`, tokens.student, {
      status: "APPROVED",
    });
    expect(res.status, 403, "student review");
  });

  let planId = "";
  let paymentId = "";

  await step("plans are listable and only admins can create them", async () => {
    const listed = await call("GET", "/api/billing/plans", tokens.company);
    expect(listed.status, 200, "list plans");
    assert.ok(listed.body.total >= 2, "expected seeded plans");

    const forbidden = await call("POST", "/api/billing/plans", tokens.company, {
      code: `NOPE_${suffix}`,
      name: "Nope",
      amountKobo: 100,
      durationDays: 1,
    });
    expect(forbidden.status, 403, "company creates plan");

    const created = await call("POST", "/api/billing/plans", tokens.admin, {
      code: `E2E_${suffix}`,
      name: "E2E plan",
      amountKobo: 100_000,
      durationDays: 30,
    });
    expect(created.status, 201, "admin creates plan");
    planId = created.body.id;
  });

  await step("a company submits a bank transfer for verification", async () => {
    const res = await call("POST", "/api/billing/payments", tokens.company, {
      planId,
      amountKobo: 100_000,
      method: "BANK_TRANSFER",
      reference: `E2E-REF-${suffix}`,
      paymentDate: new Date().toISOString(),
    });
    expect(res.status, 201, "submit payment");
    assert.equal(res.body.status, "PENDING");
    paymentId = res.body.id;
  });

  await step("paying the wrong amount is rejected", async () => {
    const res = await call("POST", "/api/billing/payments", tokens.company, {
      planId,
      amountKobo: 1,
      method: "BANK_TRANSFER",
      reference: `E2E-BAD-${suffix}`,
      paymentDate: new Date().toISOString(),
    });
    expect(res.status, 409, "wrong amount");
  });

  await step("an admin verifies the payment and a subscription appears", async () => {
    const res = await call("POST", `/api/billing/payments/${paymentId}/verify`, tokens.admin, {
      status: "VERIFIED",
      notes: "Confirmed on the bank statement.",
    });
    expect(res.status, 200, "verify payment");
    assert.equal(res.body.status, "VERIFIED");
    assert.ok(res.body.subscription?.id, "payment was not linked to a subscription");

    const mine = await call("GET", "/api/billing/subscriptions/me", tokens.company);
    expect(mine.status, 200, "my subscription");
    assert.equal(mine.body.status, "ACTIVE");
    assert.ok(mine.body.expiryDate, "expiryDate missing");
  });

  await step("a payment cannot be verified twice", async () => {
    const res = await call("POST", `/api/billing/payments/${paymentId}/verify`, tokens.admin, {
      status: "VERIFIED",
    });
    expect(res.status, 409, "double verify");
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
