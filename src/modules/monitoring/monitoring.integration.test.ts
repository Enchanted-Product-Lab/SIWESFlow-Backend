// School monitoring, the engagement engine that feeds it, and the completion
// workflow it ends in, against a real Postgres. Skipped unless RUN_DB_TESTS=1:
//   DATABASE_URL=postgresql://... RUN_DB_TESTS=1 npm test
// Uses a scratch database; inserts rows and does not clean up.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { Server } from "node:http";

const run = process.env.RUN_DB_TESTS === "1";
const suffix = `m${Date.now().toString(36)}`;
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

describe("monitoring, engagement and completion", { skip: !run }, () => {
  let base = "";
  let server: Server;
  let prisma: typeof import("../../lib/prisma.js").prisma;
  let refreshEngagement: typeof import("../engagement/engagement.service.js").refreshEngagement;
  const ids: Record<string, string> = {};
  const id = (key: string): string => {
    const value = ids[key];
    if (!value) throw new Error(`Missing test fixture: ${key}`);
    return value;
  };

  const call = async (as: string | null, method: string, path: string, body?: unknown) => {
    const res = await fetch(base + path, {
      method,
      headers: {
        "content-type": "application/json",
        ...(as ? { authorization: `Bearer ${ids[as]}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };

  type Role = "STUDENT" | "SCHOOL_COORDINATOR" | "SUPERVISOR";
  const mkUser = async (key: string, role: Role) => {
    const created = await prisma.user.create({
      data: { email: `${key}-${suffix}@test.dev`, passwordHash: "x", role },
    });
    ids[key] = created.id;
  };

  const mkStudent = async (
    key: string,
    opts: { placed: boolean; last?: Date; start?: Date; school?: string }
  ) => {
    await mkUser(`u_${key}`, "STUDENT");
    const created = await prisma.student.create({
      data: {
        userId: id(`u_${key}`),
        studentCode: `SC-${key}-${suffix}`,
        firstName: key,
        lastName: "Test",
        dateOfBirth: new Date("2001-04-12"),
        gender: "FEMALE",
        email: `${key}-${suffix}@student.dev`,
        phoneNumber: "+2348012345678",
        schoolId: id(opts.school ?? "school"),
        faculty: "Engineering",
        department: key === "sRisk" ? "Mechanical" : "CS",
        programme: "BSc",
        level: "400",
        matriculationNumber: `M-${key}-${suffix}`,
        academicSession: "2025/2026",
        siwesSession: "2026",
        siwesStartDate: opts.start ?? daysAgo(120),
        siwesEndDate: new Date(Date.now() + 30 * DAY),
        ...(opts.placed
          ? { placementStatus: "PLACED" as const, placementId: id("placement"), supervisorId: id("supervisor") }
          : {}),
        ...(opts.last ? { lastActivitySubmittedAt: opts.last } : {}),
      },
    });
    ids[key] = created.id;
  };

  const mkEntry = (studentKey: string, status: "APPROVED" | "PENDING", date: string, hoursWorked = 8) =>
    prisma.activity.create({
      data: { studentId: id(studentKey), date: new Date(date), title: "Fixture", description: "x", hoursWorked, status },
    });

  before(async () => {
    process.env.SUPABASE_URL ??= "http://localhost:1";
    process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test";
    // Small enough to meet with a handful of fixture entries.
    process.env.COMPLETION_MIN_HOURS = "16";
    process.env.COMPLETION_MIN_WEEKS = "2";
    ({ prisma } = await import("../../lib/prisma.js"));
    ({ refreshEngagement } = await import("../engagement/engagement.service.js"));
    const { setTokenVerifier } = await import("../../lib/token.js");
    setTokenVerifier(async (token) => ({ userId: token }));
    const { default: app } = await import("../../app.js");
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

    await mkUser("coord", "SCHOOL_COORDINATOR");
    await mkUser("coord2", "SCHOOL_COORDINATOR");
    await mkUser("sup", "SUPERVISOR");
    await mkUser("supOther", "SUPERVISOR");

    const school = (code: string, coordinator: string) =>
      prisma.school.create({
        data: {
          schoolCode: `${code}-${suffix}`, name: `${code} ${suffix}`, institutionType: "UNIVERSITY",
          address: "Ibadan", state: "Oyo", country: "Nigeria",
          email: `${code}-${suffix}@test.dev`, phone: "+2348000000000", coordinatorId: id(coordinator),
        },
      });
    ids.school = (await school("UI", "coord")).id;
    ids.school2 = (await school("OAU", "coord2")).id;

    const company = await prisma.company.create({
      data: {
        companyCode: `FLW-${suffix}`, name: `Flutterwave ${suffix}`, industry: "Fintech",
        address: "Lagos", state: "Lagos", country: "Nigeria",
        email: `flw-${suffix}@test.dev`, phone: "+2348000000002",
      },
    });
    ids.company = company.id;
    ids.placement = (
      await prisma.placement.create({
        data: {
          companyId: company.id, title: "Backend intern", department: "Engineering",
          availableSlots: 10, startDate: daysAgo(120), endDate: new Date(Date.now() + 30 * DAY),
        },
      })
    ).id;
    const supervisor = (key: string, name: string) =>
      prisma.supervisor.create({
        data: {
          userId: id(key), companyId: company.id, fullName: name, position: "Engineer",
          department: "IT", email: `${key}-${suffix}@test.dev`, phone: "+2348000000003",
        },
      });
    ids.supervisor = (await supervisor("sup", "Ngozi Eze")).id;
    await supervisor("supOther", "Kunle Ojo");

    await mkStudent("sActive", { placed: true, last: daysAgo(2) });
    await mkStudent("sRisk", { placed: true, last: daysAgo(10) });
    await mkStudent("sGone", { placed: true, last: daysAgo(20) });
    // Never submitted, but SIWES began three days ago: not inactive yet.
    await mkStudent("sNew", { placed: true, start: daysAgo(3) });
    // Submitted yesterday, but has no placement, so cannot be engaged.
    await mkStudent("sUnplaced", { placed: false, last: daysAgo(1) });
    await mkStudent("sDone", { placed: true, last: daysAgo(1) });
    await mkStudent("sElsewhere", { placed: false, school: "school2" });
  });

  after(async () => {
    server?.close();
    await prisma?.$disconnect();
  });

  const engagementOf = async (key: string) =>
    (await prisma.student.findUniqueOrThrow({ where: { id: id(key) }, select: { engagementStatus: true } }))
      .engagementStatus;

  test("the engagement engine applies the 7 and 14 day thresholds to placed students", async () => {
    await refreshEngagement();
    assert.equal(await engagementOf("sActive"), "ACTIVE");
    assert.equal(await engagementOf("sRisk"), "AT_RISK");
    assert.equal(await engagementOf("sGone"), "INACTIVE");
    assert.equal(await engagementOf("sNew"), "ACTIVE");
    assert.equal(await engagementOf("sUnplaced"), "INACTIVE");
    // Idempotent: nothing of ours changes on a second pass.
    await refreshEngagement();
    assert.equal(await engagementOf("sRisk"), "AT_RISK");
  });

  test("the school dashboard counts the coordinator's cohort only", async () => {
    const res = await call("coord", "GET", "/api/schools/me/dashboard-metrics");
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const { asOf, ...metrics } = res.body;
    assert.ok(asOf);
    assert.deepEqual(metrics, {
      totalStudents: 6,
      placedStudents: 5,
      unplacedStudents: 1,
      completedStudents: 0,
      activeStudents: 3,
      atRiskStudents: 1,
      inactiveStudents: 2,
      placementCoverage: 83.3,
    });

    const other = await call("coord2", "GET", "/api/schools/me/dashboard-metrics");
    assert.equal(other.body.totalStudents, 1);
    assert.equal((await call("sup", "GET", "/api/schools/me/dashboard-metrics")).status, 403);
    assert.equal((await call(null, "GET", "/api/schools/me/dashboard-metrics")).status, 401);
  });

  test("the cohort table filters by engagement, department and company", async () => {
    const q = (query: string) => call("coord", "GET", `/api/students?pageSize=100&${query}`);
    const names = (res: { body: { data: { firstName: string }[] } }) =>
      res.body.data.map((s) => s.firstName).sort();

    assert.deepEqual(names(await q("engagementStatus=AT_RISK")), ["sRisk"]);
    assert.deepEqual(names(await q("department=Mechanical")), ["sRisk"]);
    assert.deepEqual(names(await q(`companyId=${id("company")}`)), ["sActive", "sDone", "sGone", "sNew", "sRisk"]);
    assert.equal((await q("engagementStatus=at_risk")).status, 400);
  });

  test("submitting an entry makes a placed student active at once", async () => {
    const created = await call("u_sGone", "POST", "/api/activities", {
      date: daysAgo(1).toISOString(),
      title: "Back at it",
      description: "Picked the ledger work back up.",
      hoursWorked: 6,
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(await engagementOf("sGone"), "ACTIVE");
    // Puts sGone back for the counts below.
    await prisma.activity.update({ where: { id: created.body.id }, data: { status: "APPROVED" } });
  });

  test("the supervisor dashboard covers assigned students only", async () => {
    await mkEntry("sRisk", "PENDING", "2026-10-01");
    const res = await call("sup", "GET", "/api/supervisors/me/metrics");
    assert.equal(res.status, 200);
    const { asOf, ...metrics } = res.body;
    assert.ok(asOf);
    assert.deepEqual(metrics, { totalStudents: 5, hoursVerified: 6, pendingReviews: 1, atRiskStudents: 1 });

    const other = await call("supOther", "GET", "/api/supervisors/me/metrics");
    assert.deepEqual({ ...other.body, asOf: 0 }, { asOf: 0, totalStudents: 0, hoursVerified: 0, pendingReviews: 0, atRiskStudents: 0 });
    assert.equal((await call("coord", "GET", "/api/supervisors/me/metrics")).status, 403);
  });

  test("a student cannot request completion until the requirements are met", async () => {
    const progress = await call("u_sDone", "GET", `/api/completions/students/${id("sDone")}`);
    assert.equal(progress.status, 200);
    assert.equal(progress.body.completion, null);
    assert.equal(progress.body.requirements.met, false);

    const early = await call("u_sDone", "POST", "/api/completions");
    assert.equal(early.status, 400);
    assert.deepEqual(
      { hours: early.body.details.totalHours, weeks: early.body.details.weeksLogged },
      { hours: 0, weeks: 0 }
    );

    // 16 approved hours across two weeks, but one entry still awaiting review.
    await mkEntry("sDone", "APPROVED", "2026-10-05");
    await mkEntry("sDone", "APPROVED", "2026-10-12");
    const pending = await mkEntry("sDone", "PENDING", "2026-10-13", 2);
    const blocked = await call("u_sDone", "POST", "/api/completions");
    assert.equal(blocked.status, 400);
    assert.equal(blocked.body.details.unreviewedEntries, 1);
    await prisma.activity.update({ where: { id: pending.id }, data: { status: "APPROVED" } });

    assert.equal((await call("u_sUnplaced", "POST", "/api/completions")).status, 409);
  });

  test("completion runs student, supervisor, school, and a decline starts it over", async () => {
    const requested = await call("u_sDone", "POST", "/api/completions");
    assert.equal(requested.status, 201, JSON.stringify(requested.body));
    assert.equal(requested.body.status, "PENDING_SUPERVISOR");
    assert.deepEqual(
      [requested.body.totalHours, requested.body.weeksLogged, requested.body.approvedEntries],
      [18, 2, 3]
    );
    const url = `/api/completions/${requested.body.id}`;
    assert.equal((await call("u_sDone", "POST", "/api/completions")).status, 409);

    // Wrong people, wrong order.
    assert.equal((await call("supOther", "POST", `${url}/supervisor-signoff`, { decision: "APPROVE" })).status, 404);
    assert.equal((await call("coord", "POST", `${url}/school-verify`, { decision: "APPROVE" })).status, 409);
    assert.equal((await call("sup", "POST", `${url}/supervisor-signoff`, { decision: "DECLINE" })).status, 400);

    const declined = await call("sup", "POST", `${url}/supervisor-signoff`, {
      decision: "DECLINE",
      remarks: "Two weeks of entries are missing detail",
    });
    assert.equal(declined.body.status, "DECLINED");
    assert.equal(declined.body.declineReason, "Two weeks of entries are missing detail");

    const again = await call("u_sDone", "POST", "/api/completions");
    assert.equal(again.status, 201);
    assert.equal(again.body.id, requested.body.id);
    assert.equal(again.body.status, "PENDING_SUPERVISOR");
    assert.equal(again.body.declineReason, null);

    const signed = await call("sup", "POST", `${url}/supervisor-signoff`, { decision: "APPROVE", remarks: "Reliable" });
    assert.equal(signed.body.status, "PENDING_SCHOOL");
    assert.ok(signed.body.supervisorSignedOffAt);

    assert.equal((await call("coord2", "POST", `${url}/school-verify`, { decision: "APPROVE" })).status, 404);
    const verified = await call("coord", "POST", `${url}/school-verify`, { decision: "APPROVE" });
    assert.equal(verified.status, 200, JSON.stringify(verified.body));
    assert.equal(verified.body.status, "VERIFIED");
    assert.match(verified.body.certificateReference, /^SIWES-[0-9A-F]{20}$/);
    ids.certificate = verified.body.certificateReference;

    const student = await prisma.student.findUniqueOrThrow({ where: { id: id("sDone") } });
    assert.equal(student.placementStatus, "COMPLETED");
    assert.equal((await call("coord", "POST", `${url}/school-verify`, { decision: "APPROVE" })).status, 409);
  });

  test("anyone can check a certificate, and it reveals only what it certifies", async () => {
    const res = await call(null, "GET", `/api/completions/certificate/${id("certificate")}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.studentName, "sDone Test");
    assert.equal(res.body.company, `Flutterwave ${suffix}`);
    assert.equal(res.body.totalHours, 18);
    for (const hidden of ["email", "matriculationNumber", "studentId", "phoneNumber"]) {
      assert.equal(hidden in res.body, false, hidden);
    }
    assert.equal((await call(null, "GET", "/api/completions/certificate/SIWES-NOPE")).status, 404);
  });

  test("the timeline tells the student's story in order, to the school and the student", async () => {
    const res = await call("coord", "GET", `/api/schools/students/${id("sGone")}/timeline`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.map((e: { type: string }) => e.type), ["PROFILE_CREATED", "ENTRY_SUBMITTED"]);

    const done = await call("u_sDone", "GET", `/api/schools/students/${id("sDone")}/timeline`);
    const types = done.body.map((e: { type: string }) => e.type);
    assert.equal(types[0], "PROFILE_CREATED");
    assert.equal(types.at(-1), "COMPLETION_VERIFIED");
    const times = done.body.map((e: { at: string }) => new Date(e.at).getTime());
    assert.deepEqual(times, [...times].sort((a, b) => a - b));

    // Applications to other companies are in it, so the host side is kept out.
    assert.equal((await call("sup", "GET", `/api/schools/students/${id("sDone")}/timeline`)).status, 403);
    assert.equal((await call("coord2", "GET", `/api/schools/students/${id("sDone")}/timeline`)).status, 404);
    assert.equal((await call("u_sRisk", "GET", `/api/schools/students/${id("sDone")}/timeline`)).status, 404);
  });
});
