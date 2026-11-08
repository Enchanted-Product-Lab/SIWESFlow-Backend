// End-to-end checks for the logbook API against a real Postgres.
// Skipped unless RUN_DB_TESTS=1:
//   DATABASE_URL=postgresql://... RUN_DB_TESTS=1 npm test
// Uses a scratch database; inserts rows and does not clean up.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { Server } from "node:http";

const run = process.env.RUN_DB_TESTS === "1";
const suffix = Date.now().toString(36);

describe("logbook activity API", { skip: !run }, () => {
  let base = "";
  let server: Server;
  let prisma: typeof import("../../lib/prisma.js").prisma;
  const ids: Record<string, string> = {};

  // Prisma's typed inputs reject `string | undefined`, so fixtures are read
  // through this and a missing one fails loudly instead of becoming "".
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

  // Entries are dated inside the SIWES window created below, which is already
  // in the past relative to the sprint, so only the period rule can reject them.
  const entry = {
    date: "2026-06-15",
    title: "Set up the placements table",
    description: "Modelled companies, slots and the approval column.",
    hoursWorked: 6,
    skillsUsed: ["Postgres"],
    category: "Database",
  };

  const mkUser = async (key: string, role: "STUDENT" | "SCHOOL_COORDINATOR" | "SUPERVISOR" | "PLATFORM_ADMIN") => {
    const created = await prisma.user.create({
      data: { email: `${key}-${suffix}@test.dev`, passwordHash: "x", role },
    });
    ids[key] = created.id;
  };

  const mkStudent = async (key: string, userKey: string, schoolId: string, supervisorId?: string) => {
    const created = await prisma.student.create({
      data: {
        userId: id(userKey),
        studentCode: `SC-${key}-${suffix}`,
        firstName: key === "studentA" ? "Tunde" : "Chidi",
        lastName: key === "studentA" ? "Adeyemi" : "Obi",
        dateOfBirth: new Date("2001-04-12"),
        gender: "MALE",
        email: `${key}-${suffix}@test.dev`,
        phoneNumber: "+2348012345678",
        schoolId,
        faculty: "Engineering",
        department: "CS",
        programme: "BSc",
        level: "400",
        matriculationNumber: `M-${key}-${suffix}`,
        academicSession: "2025/2026",
        siwesSession: "2026",
        siwesStartDate: new Date("2026-05-04"),
        siwesEndDate: new Date("2026-08-24"),
        ...(supervisorId ? { supervisorId } : {}),
      },
    });
    ids[key] = created.id;
  };

  before(async () => {
    process.env.SUPABASE_URL ??= "http://localhost:1";
    process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test";
    ({ prisma } = await import("../../lib/prisma.js"));
    const { setTokenVerifier } = await import("../../lib/token.js");
    setTokenVerifier(async (token) => ({ userId: token }));
    const { default: app } = await import("../../app.js");
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

    await mkUser("stuA", "STUDENT");
    await mkUser("stuB", "STUDENT");
    await mkUser("coord", "SCHOOL_COORDINATOR");
    await mkUser("sup", "SUPERVISOR");
    await mkUser("supOther", "SUPERVISOR");
    await mkUser("admin", "PLATFORM_ADMIN");

    const schoolOne = await prisma.school.create({
      data: {
        schoolCode: `KTM-${suffix}`, name: `Kogi ${suffix}`, institutionType: "UNIVERSITY",
        address: "Lokoja", state: "Kogi", country: "Nigeria",
        email: `kogi-${suffix}@test.dev`, phone: "+2348000000000", coordinatorId: id("coord"),
      },
    });
    const schoolTwo = await prisma.school.create({
      data: {
        schoolCode: `ZAM-${suffix}`, name: `Zamfara ${suffix}`, institutionType: "POLYTECHNIC",
        address: "Mutum Birane", state: "Zamfara", country: "Nigeria",
        email: `zam-${suffix}@test.dev`, phone: "+2348000000001",
      },
    });
    const company = await prisma.company.create({
      data: {
        companyCode: `ACME-${suffix}`, name: `Acme ${suffix}`, industry: "Tech",
        address: "Lagos", state: "Lagos", country: "Nigeria",
        email: `acme-${suffix}@test.dev`, phone: "+2348000000002",
      },
    });
    const supervisor = await prisma.supervisor.create({
      data: {
        userId: id("sup"), companyId: company.id, fullName: "Ada Obi", position: "Engineer",
        department: "IT", email: `ada-${suffix}@test.dev`, phone: "+2348000000003",
      },
    });
    ids.supervisor = supervisor.id;
    // Same company, no students assigned: company membership must not grant access.
    await prisma.supervisor.create({
      data: {
        userId: id("supOther"), companyId: company.id, fullName: "Bola Ade", position: "Engineer",
        department: "IT", email: `bola-${suffix}@test.dev`, phone: "+2348000000004",
      },
    });

    await mkStudent("studentA", "stuA", schoolOne.id, supervisor.id);
    await mkStudent("studentB", "stuB", schoolTwo.id);
  });

  after(async () => {
    server?.close();
    await prisma?.$disconnect();
  });

  test("rejects unauthenticated requests", async () => {
    assert.equal((await call(null, "GET", "/api/activities")).status, 401);
    assert.equal((await call(null, "POST", "/api/activities", entry)).status, 401);
  });

  test("a student creates an entry that is pending with a submission time", async () => {
    const created = await call("stuA", "POST", "/api/activities", entry);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    ids.entry = created.body.id;
    assert.equal(created.body.status, "PENDING");
    assert.ok(created.body.submittedAt, "submittedAt should be stamped on creation");
    assert.equal(created.body.studentId, id("studentA"));
    assert.equal(created.body.hoursWorked, 6);
  });

  test("only a student account can create an entry", async () => {
    for (const who of ["coord", "sup", "admin"]) {
      assert.equal((await call(who, "POST", "/api/activities", entry)).status, 403, who);
    }
  });

  test("rejects future dates and dates outside the SIWES period", async () => {
    const at = (date: string) => call("stuA", "POST", "/api/activities", { ...entry, date });
    assert.equal((await at("2099-01-01")).status, 400);
    assert.equal((await at("2026-05-01")).status, 400);
    assert.equal((await at("2026-08-25")).status, 400);
    // Both ends of the window are inclusive days.
    assert.equal((await at("2026-05-04")).status, 201);
    assert.equal((await at("2026-08-24")).status, 201);
  });

  test("rejects system-managed fields and bad values", async () => {
    assert.equal((await call("stuA", "POST", "/api/activities", { ...entry, status: "APPROVED" })).status, 400);
    assert.equal((await call("stuA", "POST", "/api/activities", { ...entry, studentId: id("studentB") })).status, 400);
    assert.equal((await call("stuA", "POST", "/api/activities", { ...entry, hoursWorked: 0 })).status, 400);
  });

  test("the student, their host and their coordinator can read the entry", async () => {
    const mine = await call("stuA", "GET", `/api/activities/${id("entry")}`);
    assert.equal(mine.status, 200);
    assert.equal(mine.body.student.id, id("studentA"));
    // Identity fields stay with the student and the school; the summary carries
    // only what a logbook reader needs.
    assert.equal(mine.body.student.matriculationNumber, undefined);
    assert.equal(mine.body.review, null);
    assert.deepEqual(mine.body.evidence, []);

    assert.equal((await call("sup", "GET", `/api/activities/${id("entry")}`)).status, 200);
    assert.equal((await call("coord", "GET", `/api/activities/${id("entry")}`)).status, 200);
    assert.equal((await call("admin", "GET", `/api/activities/${id("entry")}`)).status, 200);
  });

  test("an unrelated student gets not found, not forbidden", async () => {
    assert.equal((await call("stuB", "GET", `/api/activities/${id("entry")}`)).status, 404);
    assert.equal((await call("stuA", "GET", "/api/activities/does-not-exist")).status, 404);
  });

  test("evidence links only the student's own ACTIVITY_EVIDENCE documents", async () => {
    const mkDoc = (studentKey: string, documentType: "ACTIVITY_EVIDENCE" | "PASSPORT_PHOTO", name: string) =>
      prisma.document.create({
        data: {
          studentId: id(studentKey),
          documentType,
          filename: name,
          fileFormat: documentType === "ACTIVITY_EVIDENCE" ? "PNG" : "JPG",
          fileSizeBytes: 2048,
          storageKey: `student/${id(studentKey)}/${documentType}/${name}`,
        },
      });

    const evidence = await mkDoc("studentA", "ACTIVITY_EVIDENCE", "diagram.png");
    const identity = await mkDoc("studentA", "PASSPORT_PHOTO", "face.jpg");
    const someoneElse = await mkDoc("studentB", "ACTIVITY_EVIDENCE", "other.png");

    const linked = await call("stuA", "POST", "/api/activities", { ...entry, documentId: evidence.id });
    assert.equal(linked.status, 201, JSON.stringify(linked.body));
    const detail = await call("stuA", "GET", `/api/activities/${linked.body.id}`);
    // Metadata only; the file itself comes from GET /documents/:id/url.
    assert.deepEqual(detail.body.evidence, [
      {
        documentId: evidence.id,
        fileName: "diagram.png",
        fileFormat: "PNG",
        fileSizeBytes: 2048,
        uploadedAt: detail.body.evidence[0].uploadedAt,
      },
    ]);

    assert.equal((await call("stuA", "POST", "/api/activities", { ...entry, documentId: identity.id })).status, 400);
    assert.equal((await call("stuA", "POST", "/api/activities", { ...entry, documentId: someoneElse.id })).status, 403);
    assert.equal((await call("stuA", "POST", "/api/activities", { ...entry, documentId: "missing" })).status, 404);

    // null detaches the evidence again.
    const detached = await call("stuA", "PATCH", `/api/activities/${linked.body.id}`, { documentId: null });
    assert.equal(detached.status, 200, JSON.stringify(detached.body));
    assert.deepEqual((await call("stuA", "GET", `/api/activities/${linked.body.id}`)).body.evidence, []);
  });

  test("only the owner may edit, and approved entries are locked", async () => {
    const url = `/api/activities/${id("entry")}`;
    assert.equal((await call("coord", "PATCH", url, { title: "x" })).status, 403);
    assert.equal((await call("sup", "PATCH", url, { title: "x" })).status, 403);

    const patched = await call("stuA", "PATCH", url, { title: "Renamed" });
    assert.equal(patched.status, 200);
    assert.equal(patched.body.title, "Renamed");
    assert.equal((await call("stuA", "PATCH", url, {})).status, 400);

    await prisma.activity.update({ where: { id: id("entry") }, data: { status: "APPROVED" } });
    assert.equal((await call("stuA", "PATCH", url, { title: "nope" })).status, 409);
  });

  test("editing an entry sent back for revision resubmits it", async () => {
    const url = `/api/activities/${id("entry")}`;
    const original = await prisma.activity.findUniqueOrThrow({
      where: { id: id("entry") },
      select: { submittedAt: true },
    });
    await prisma.activity.update({
      where: { id: id("entry") },
      data: {
        status: "NEEDS_REVISION",
        reviewedById: id("supervisor"),
        reviewedAt: new Date("2026-06-20T09:00:00.000Z"),
        comment: "Add more detail",
        rating: 2,
      },
    });
    assert.equal((await call("stuA", "GET", url)).body.review.status, "NEEDS_REVISION");

    const after = await call("stuA", "PATCH", url, { description: "Expanded the description." });
    assert.equal(after.status, 200);
    assert.equal(after.body.status, "PENDING");
    assert.ok(new Date(after.body.submittedAt).getTime() > (original.submittedAt?.getTime() ?? 0));

    // The verdict is no longer shown — the entry is awaiting review again — but
    // the row keeps it: supervisor deletion counts on reviewedById.
    const row = await prisma.activity.findUniqueOrThrow({
      where: { id: id("entry") },
      select: { reviewedById: true, comment: true, rating: true },
    });
    assert.deepEqual(row, { reviewedById: id("supervisor"), comment: "Add more detail", rating: 2 });
    assert.equal((await call("stuA", "GET", url)).body.review, null);
  });

  test("lists are scoped to the caller's relationship", async () => {
    await call("stuB", "POST", "/api/activities", { ...entry, date: "2026-06-16" });

    const own = await call("stuA", "GET", "/api/activities");
    assert.equal(own.status, 200);
    assert.ok(own.body.total >= 3);
    assert.ok(own.body.data.every((a: { studentId: string }) => a.studentId === id("studentA")));

    const supervised = await call("sup", "GET", "/api/activities");
    assert.ok(supervised.body.data.every((a: { studentId: string }) => a.studentId === id("studentA")));

    // The coordinator's school holds only studentA, so nothing from studentB leaks in.
    const cohort = await call("coord", "GET", "/api/activities");
    assert.ok(cohort.body.data.every((a: { student: { id: string } }) => a.student.id === id("studentA")));

    const all = await call("admin", "GET", "/api/activities");
    assert.ok(all.body.total >= 5);
  });

  test("lists filter by status and date range", async () => {
    const approved = await call("admin", "GET", "/api/activities?status=APPROVED");
    assert.ok(approved.body.data.every((a: { status: string }) => a.status === "APPROVED"));

    const june = await call("admin", "GET", "/api/activities?from=2026-06-01&to=2026-06-30");
    assert.ok(june.body.total >= 1);

    // Both ends of a range are whole days, so an evening entry is still inside it.
    const evening = await call("stuA", "POST", "/api/activities", {
      ...entry,
      date: "2026-07-08T18:30:00.000Z",
    });
    assert.equal(evening.status, 201);
    const day = await call("stuA", "GET", "/api/activities?from=2026-07-08&to=2026-07-08");
    assert.deepEqual(
      day.body.data.map((a: { id: string }) => a.id),
      [evening.body.id]
    );

    assert.equal((await call("admin", "GET", "/api/activities?from=2026-06-30&to=2026-06-01")).status, 400);
    assert.equal((await call("admin", "GET", "/api/activities?status=approved")).status, 400);
    assert.equal((await call("admin", "GET", "/api/activities?pageSize=500")).status, 400);
  });

  test("only a platform admin may delete", async () => {
    const url = `/api/activities/${id("entry")}`;
    assert.equal((await call("stuA", "DELETE", url)).status, 403);
    assert.equal((await call("coord", "DELETE", url)).status, 403);
    assert.equal((await call("admin", "DELETE", "/api/activities/missing")).status, 404);

    assert.equal((await call("admin", "DELETE", url)).status, 204);
    assert.equal((await call("admin", "GET", url)).status, 404);
  });

  // Inserted directly so these depend on the review rules, not the date rules.
  const mkEntry = (studentKey: string, title: string, documentId?: string) =>
    prisma.activity.create({
      data: {
        studentId: id(studentKey),
        date: new Date("2026-06-22"),
        title,
        description: "Review fixture",
        hoursWorked: 4,
        ...(documentId ? { documentId } : {}),
      },
    });

  test("only the assigned supervisor can review, with a valid verdict", async () => {
    const { id: entryId } = await mkEntry("studentA", "To review");
    const url = `/api/activities/${entryId}/review`;
    const verdict = { status: "APPROVED", rating: 5, comment: "Solid work" };

    assert.equal((await call(null, "POST", url, verdict)).status, 401);
    assert.equal((await call("stuA", "POST", url, verdict)).status, 403);
    assert.equal((await call("admin", "POST", url, verdict)).status, 403);
    assert.equal((await call("supOther", "POST", url, verdict)).status, 404);
    assert.equal((await call("sup", "POST", "/api/activities/missing/review", verdict)).status, 404);

    assert.equal((await call("sup", "POST", url, { ...verdict, status: "REJECTED" })).status, 400);
    assert.equal((await call("sup", "POST", url, { ...verdict, status: "approved" })).status, 400);
    assert.equal((await call("sup", "POST", url, { ...verdict, rating: 0 })).status, 400);
    assert.equal((await call("sup", "POST", url, { ...verdict, rating: 6 })).status, 400);

    const reviewed = await call("sup", "POST", url, verdict);
    assert.equal(reviewed.status, 200);
    assert.equal(reviewed.body.status, "APPROVED");
    assert.equal(reviewed.body.rating, 5);
    assert.equal(reviewed.body.comment, "Solid work");
    assert.equal(reviewed.body.reviewedById, id("supervisor"));
    assert.ok(reviewed.body.reviewedAt);

    const read = await call("stuA", "GET", `/api/activities/${entryId}`);
    assert.equal(read.body.review.status, "APPROVED");
    assert.equal(read.body.review.reviewedBy.fullName, "Ada Obi");

    assert.equal((await call("sup", "POST", url, verdict)).status, 409);
  });

  test("a new review replaces the previous comment and rating", async () => {
    const { id: entryId } = await mkEntry("studentA", "Reviewed twice");
    const url = `/api/activities/${entryId}/review`;

    const sentBack = await call("sup", "POST", url, {
      status: "NEEDS_REVISION",
      rating: 2,
      comment: "Add more detail",
    });
    assert.equal(sentBack.body.comment, "Add more detail");

    const approved = await call("sup", "PATCH", url, { status: "APPROVED" });
    assert.equal(approved.status, 200);
    assert.equal(approved.body.status, "APPROVED");
    assert.equal(approved.body.comment, null);
    assert.equal(approved.body.rating, null);
  });

  test("a supervisor lists only assigned students' entries, with evidence metadata", async () => {
    const doc = await prisma.document.create({
      data: {
        studentId: id("studentA"),
        documentType: "ACTIVITY_EVIDENCE",
        filename: "wiring.png",
        fileFormat: "PNG",
        fileSizeBytes: 4096,
        storageKey: `student/${id("studentA")}/ACTIVITY_EVIDENCE/wiring.png`,
      },
    });
    const withEvidence = await mkEntry("studentA", "With evidence", doc.id);
    const without = await mkEntry("studentA", "Without evidence");
    const unassigned = await mkEntry("studentB", "Someone else's student");

    const list = await call("sup", "GET", "/api/activities?status=PENDING&pageSize=100");
    assert.equal(list.status, 200);
    const byId = new Map(list.body.data.map((a: { id: string }) => [a.id, a]));
    assert.equal(byId.has(unassigned.id), false);

    const row = byId.get(withEvidence.id) as Record<string, unknown>;
    assert.deepEqual(row.evidence, [
      {
        documentId: doc.id,
        fileName: "wiring.png",
        fileFormat: "PNG",
        fileSizeBytes: 4096,
        uploadedAt: doc.uploadedAt.toISOString(),
      },
    ]);
    assert.equal("document" in row, false);
    assert.deepEqual((byId.get(without.id) as Record<string, unknown>).evidence, []);

    const other = await call("supOther", "GET", "/api/activities");
    assert.equal(other.status, 200);
    assert.equal(other.body.total, 0);
  });
});
