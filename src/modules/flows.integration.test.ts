// End-to-end checks against a real Postgres. Skipped unless RUN_DB_TESTS=1.
//   DATABASE_URL=postgresql://... RUN_DB_TESTS=1 npm test
// Use a scratch database: this inserts rows (uniquely named) and does not clean up.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { Server } from "node:http";

const run = process.env.RUN_DB_TESTS === "1";
const suffix = Date.now().toString(36);

describe("profiles, access and verification flows", { skip: !run }, () => {
  let base = "";
  let server: Server;
  let prisma: typeof import("../lib/prisma.js").prisma;
  const ids: Record<string, string> = {};

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

  const mkUser = async (key: string, role: "STUDENT" | "SCHOOL_COORDINATOR" | "COMPANY_ADMIN" | "PLATFORM_ADMIN" | "SUPERVISOR") => {
    const u = await prisma.user.create({
      data: { email: `${key}-${suffix}@test.dev`, passwordHash: "x", role },
    });
    ids[key] = u.id;
  };

  before(async () => {
    process.env.SUPABASE_URL ??= "http://localhost:1";
    process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test";
    ({ prisma } = await import("../lib/prisma.js"));
    const { setTokenVerifier } = await import("../lib/token.js");
    setTokenVerifier(async (token) => ({ userId: token }));
    const { default: app } = await import("../app.js");
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

    for (const [k, r] of [
      ["coord", "SCHOOL_COORDINATOR"], ["coord2", "SCHOOL_COORDINATOR"], ["admin", "PLATFORM_ADMIN"],
      ["stu", "STUDENT"], ["stu2", "STUDENT"], ["cadmin", "COMPANY_ADMIN"], ["sup", "SUPERVISOR"],
    ] as const) await mkUser(k, r);
  });

  after(async () => {
    server?.close();
    await prisma?.$disconnect();
  });

  test("rejects unauthenticated requests", async () => {
    assert.equal((await call(null, "GET", "/api/students")).status, 401);
    assert.equal((await call(null, "GET", "/documents?ownerType=student&ownerId=x")).status, 401);
  });

  test("school and company profiles", async () => {
    const school = await call("coord", "POST", "/api/schools", {
      name: `Nile ${suffix}`, institutionType: "UNIVERSITY", address: "Abuja", state: "FCT",
      country: "Nigeria", email: `nile-${suffix}@nile.edu.ng`, phone: "+2348000000000",
      coordinatorEmail: "c@nile.edu.ng",
    });
    assert.equal(school.status, 201, JSON.stringify(school.body));
    ids.school = school.body.id;
    assert.equal(school.body.coordinatorId, ids.coord);

    assert.equal((await call("stu", "POST", "/api/schools", {})).status, 403);
    // a student browsing sees the school without coordinator contact details
    const seen = await call("stu", "GET", `/api/schools/${ids.school}`);
    assert.equal(seen.body.coordinatorEmail, undefined);
    assert.equal((await call("coord2", "PATCH", `/api/schools/${ids.school}`, { phone: "+2348111111111" })).status, 403);
    assert.equal((await call("coord", "PATCH", `/api/schools/${ids.school}`, { phone: "+2348111111111" })).status, 200);

    const companyPayload = {
      name: `Acme ${suffix}`, industry: "Tech", address: "Lagos", state: "Lagos", country: "Nigeria",
      email: `hr-${suffix}@acme.com`, phone: "+2348000000001",
    };
    const company = await call("cadmin", "POST", "/api/companies", companyPayload);
    assert.equal(company.status, 201, JSON.stringify(company.body));
    ids.company = company.body.id;
    assert.equal((await call("cadmin", "POST", "/api/companies", companyPayload)).status, 409);
    // unverified company is hidden from outsiders
    assert.equal((await call("stu", "GET", `/api/companies/${ids.company}`)).status, 404);
    assert.equal((await call("cadmin", "GET", `/api/companies/${ids.company}`)).status, 200);
  });

  test("student profile CRUD and validation", async () => {
    const payload = {
      firstName: "Francess", lastName: "Okafor", dateOfBirth: "2001-04-12", gender: "FEMALE",
      phoneNumber: "+2348012345678", faculty: "Engineering", department: "EEE", programme: "BEng",
      level: "400", matriculationNumber: `ENG/${suffix}`, academicSession: "2025/2026", siwesSession: "2026",
      schoolId: ids.school,
    };
    assert.equal((await call("stu", "POST", "/api/students", { ...payload, level: "450" })).status, 400);
    assert.equal((await call("stu", "POST", "/api/students", { ...payload, verificationStatus: "VERIFIED" })).status, 400);
    assert.equal((await call("stu", "POST", "/api/students", { ...payload, schoolId: "nope" })).status, 404);
    assert.equal((await call("coord", "POST", "/api/students", payload)).status, 403);

    const created = await call("stu", "POST", "/api/students", payload);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    ids.student = created.body.id;
    assert.equal(created.body.coordinatorId, ids.coord);
    assert.equal(created.body.verificationStatus, "UNVERIFIED");
    assert.equal((await call("stu", "POST", "/api/students", payload)).status, 409);

    assert.equal((await call("stu", "GET", "/api/students/me")).body.id, ids.student);
    assert.equal((await call("coord", "GET", `/api/students/${ids.student}`)).status, 200);
    assert.equal((await call("coord2", "GET", `/api/students/${ids.student}`)).status, 404);
    assert.equal((await call("stu2", "GET", `/api/students/${ids.student}`)).status, 404);
    assert.equal((await call("stu", "GET", "/api/students")).status, 403);
    assert.equal((await call("coord", "GET", "/api/students")).body.total, 1);

    const patched = await call("stu", "PATCH", `/api/students/${ids.student}`, { level: "500", siwesStartDate: "2026-06-01" });
    assert.equal(patched.body.level, "500");
    // end before the stored start date
    assert.equal((await call("stu", "PATCH", `/api/students/${ids.student}`, { siwesEndDate: "2026-05-01" })).status, 409);
    assert.equal((await call("coord", "PATCH", `/api/students/${ids.student}`, { level: "100" })).status, 403);
  });

  test("supervisor invitation lifecycle", async () => {
    const invite = {
      fullName: "Ada Obi", position: "Engineer", department: "IT", phone: "+2348000000002",
      email: `sup-${suffix}@test.dev`,
    };
    assert.equal((await call("stu", "POST", "/api/supervisors", invite)).status, 403);
    const inv = await call("cadmin", "POST", "/api/supervisors", invite);
    assert.equal(inv.status, 201, JSON.stringify(inv.body));
    ids.supervisor = inv.body.id;
    assert.equal(inv.body.activationStatus, "INVITED");
    assert.equal((await call("cadmin", "POST", `/api/supervisors/${ids.supervisor}/confirm`)).status, 409);

    const done = await call("sup", "PUT", "/api/supervisors/me", {
      fullName: "Ada Obi", position: "Senior Engineer", department: "IT", phone: "+2348000000002",
    });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    assert.equal(done.body.activationStatus, "PROFILE_COMPLETED");
    const confirmed = await call("cadmin", "POST", `/api/supervisors/${ids.supervisor}/confirm`);
    assert.equal(confirmed.body.activationStatus, "ACTIVE");
    assert.equal((await call("cadmin", "GET", "/api/supervisors")).body.total, 1);
  });

  test("schema: placement 1:N, single-owner CHECK", async () => {
    const placement = await prisma.placement.create({
      data: {
        companyId: ids.company!, title: "Intern", department: "IT", availableSlots: 2,
        startDate: new Date("2026-06-01"), endDate: new Date("2026-12-01"),
      },
    });
    assert.equal(placement.approvalStatus, "PENDING");
    ids.placement = placement.id;
    // second student on the same placement must be allowed
    const other = await prisma.student.create({
      data: {
        userId: ids.stu2!, studentCode: `X-${suffix}`, firstName: "B", lastName: "C", dateOfBirth: new Date("2000-01-01"),
        gender: "MALE", email: `stu2-${suffix}@test.dev`, phoneNumber: "+2348000000003", schoolId: ids.school!,
        faculty: "E", department: "E", programme: "E", level: "400", matriculationNumber: "m", academicSession: "2025/2026", siwesSession: "2026",
      },
    });
    ids.student2 = other.id;
    await prisma.student.update({ where: { id: ids.student! }, data: { placementId: placement.id } });
    await prisma.student.update({ where: { id: other.id }, data: { placementId: placement.id } });
    assert.equal(await prisma.student.count({ where: { placementId: placement.id } }), 2);

    const doc = (owners: object) =>
      prisma.document.create({
        data: { documentType: "OTHER", filename: "a.pdf", fileFormat: "PDF", fileSizeBytes: 1, storageKey: `k/${Math.random()}`, ...owners },
      });
    await assert.rejects(doc({}), /document_single_owner/);
    await assert.rejects(doc({ studentId: ids.student, schoolId: ids.school }), /document_single_owner/);
    await doc({ studentId: ids.student });
  });

  test("document access rules", async () => {
    const { loadActor } = await import("./access/actor.js");
    const { canUploadDocument, canReadDocument, canDeleteDocument } = await import("./access/document-policy.js");

    // link the supervisor to the student
    await prisma.student.update({ where: { id: ids.student! }, data: { supervisorId: ids.supervisor! } });
    const mk = (type: "GOVERNMENT_ID" | "ACCEPTANCE_LETTER", uploadedById: string) =>
      prisma.document.create({
        data: {
          studentId: ids.student!, documentType: type, filename: "a.pdf", fileFormat: "PDF", fileSizeBytes: 1,
          storageKey: `k/${Math.random()}`, uploadedById,
        },
      });
    const govId = await mk("GOVERNMENT_ID", ids.stu!);
    const letter = await mk("ACCEPTANCE_LETTER", ids.stu!);

    const [stu, stu2, coord, coord2, sup, cadmin, admin] = await Promise.all(
      ["stu", "stu2", "coord", "coord2", "sup", "cadmin", "admin"].map((k) => loadActor(ids[k]!))
    );

    assert.equal(await canReadDocument(stu!, govId), true);
    assert.equal(await canReadDocument(coord!, govId), true);
    assert.equal(await canReadDocument(admin!, govId), true);
    assert.equal(await canReadDocument(stu2!, govId), false);
    assert.equal(await canReadDocument(coord2!, govId), false);
    // hosts (supervisor and company admin of the placement) see work documents, not identity ones
    assert.equal(await canReadDocument(sup!, govId), false);
    assert.equal(await canReadDocument(cadmin!, govId), false);
    assert.equal(await canReadDocument(sup!, letter), true);
    assert.equal(await canReadDocument(cadmin!, letter), true);

    const up = async (a: typeof stu, owner: "student" | "company" | "school", id: string, type: Parameters<typeof canUploadDocument>[3]) =>
      (await canUploadDocument(a!, owner, id, type)).ok;
    assert.equal(await up(stu, "student", ids.student!, "PASSPORT_PHOTO"), true);
    assert.equal(await up(stu, "student", ids.student!, "COMPLETION_CERTIFICATE"), false);
    assert.equal(await up(coord, "student", ids.student!, "COMPLETION_CERTIFICATE"), true);
    assert.equal(await up(coord2, "student", ids.student!, "COMPLETION_CERTIFICATE"), false);
    assert.equal(await up(sup, "student", ids.student!, "COMPLETION_LETTER"), true);
    assert.equal(await up(cadmin, "student", ids.student!, "COMPLETION_LETTER"), true);
    assert.equal(await up(stu2, "student", ids.student!, "PASSPORT_PHOTO"), false);
    assert.equal(await up(stu, "student", ids.student!, "CAC_REGISTRATION"), false);
    assert.equal(await up(cadmin, "company", ids.company!, "CAC_REGISTRATION"), true);
    assert.equal(await up(stu, "company", ids.company!, "CAC_REGISTRATION"), false);
    assert.equal(await up(coord, "school", ids.school!, "ACCREDITATION_DOCUMENT"), true);
    assert.equal(await up(coord2, "school", ids.school!, "ACCREDITATION_DOCUMENT"), false);

    assert.equal(await canDeleteDocument(sup!, letter), false);
    assert.equal(await canDeleteDocument(stu!, letter), true);
    await prisma.document.update({ where: { id: letter.id }, data: { verificationStatus: "VERIFIED" } });
    const verified = await prisma.document.findUniqueOrThrow({ where: { id: letter.id } });
    assert.equal(await canDeleteDocument(stu!, verified), false);
    assert.equal(await canDeleteDocument(admin!, verified), true);

    const completion = await call("coord", "GET", `/documents/completion/${ids.student}`);
    assert.equal(completion.status, 200);
    assert.equal(completion.body.complete, false);
    assert.equal((await call("stu2", "GET", `/documents/completion/${ids.student}`)).status, 404);
  });

  test("verification workflow and audit events", async () => {
    const doc = await prisma.document.create({
      data: { studentId: ids.student!, documentType: "STUDENT_ID_CARD", filename: "id.png", fileFormat: "PNG", fileSizeBytes: 1, storageKey: `k/${Math.random()}` },
    });
    const body = { entityType: "STUDENT", entityId: ids.student, documentIds: [doc.id] };

    assert.equal((await call("stu", "POST", "/api/verifications", { ...body, documentIds: [] })).status, 400);
    assert.equal((await call("stu2", "POST", "/api/verifications", body)).status, 403);
    const sub = await call("stu", "POST", "/api/verifications", body);
    assert.equal(sub.status, 201, JSON.stringify(sub.body));
    const vid = sub.body.id;
    assert.equal((await call("stu", "POST", "/api/verifications", body)).status, 409);

    assert.equal((await call("coord", "POST", `/api/verifications/${vid}/verify`)).status, 409); // must start review first
    assert.equal((await call("stu", "POST", `/api/verifications/${vid}/start-review`)).status, 403);
    assert.equal((await call("coord2", "POST", `/api/verifications/${vid}/start-review`)).status, 403);
    assert.equal((await call("coord", "GET", "/api/verifications/queue")).body.total, 1);
    assert.equal((await call("coord2", "GET", "/api/verifications/queue")).body.total, 0);

    assert.equal((await call("coord", "POST", `/api/verifications/${vid}/start-review`)).body.status, "UNDER_REVIEW");
    assert.equal((await call("coord", "POST", `/api/verifications/${vid}/reject`, { reason: "no" })).status, 400);
    const rej = await call("coord", "POST", `/api/verifications/${vid}/reject`, { reason: "ID photo is unreadable" });
    assert.equal(rej.body.status, "REJECTED");
    assert.equal((await prisma.student.findUniqueOrThrow({ where: { id: ids.student! } })).verificationStatus, "REJECTED");

    // resubmit, then approve
    const again = await call("stu", "POST", "/api/verifications", body);
    assert.equal(again.status, 201);
    await call("admin", "POST", `/api/verifications/${again.body.id}/start-review`);
    const ok = await call("admin", "POST", `/api/verifications/${again.body.id}/verify`);
    assert.equal(ok.body.status, "VERIFIED");
    const student = await prisma.student.findUniqueOrThrow({ where: { id: ids.student! } });
    assert.equal(student.verificationStatus, "VERIFIED");
    assert.equal(student.verifiedById, ids.admin);
    assert.equal((await prisma.document.findUniqueOrThrow({ where: { id: doc.id } })).verificationStatus, "VERIFIED");

    const detail = await call("stu", "GET", `/api/verifications/${again.body.id}`);
    assert.deepEqual(detail.body.events.map((e: { toStatus: string }) => e.toStatus), ["SUBMITTED", "UNDER_REVIEW", "VERIFIED"]);
    const history = await call("stu", "GET", `/api/verifications/entity/STUDENT/${ids.student}`);
    assert.equal(history.body.length, 2);
    assert.equal((await call("stu2", "GET", `/api/verifications/${vid}`)).status, 404);
    // a verified profile cannot be re-submitted
    assert.equal((await call("stu", "POST", "/api/verifications", body)).status, 409);
  });

  test("school and company verification are admin-only", async () => {
    const doc = await prisma.document.create({
      data: { companyId: ids.company!, documentType: "CAC_REGISTRATION", filename: "c.pdf", fileFormat: "PDF", fileSizeBytes: 1, storageKey: `k/${Math.random()}` },
    });
    const sub = await call("cadmin", "POST", "/api/verifications", { entityType: "COMPANY", entityId: ids.company, documentIds: [doc.id] });
    assert.equal(sub.status, 201, JSON.stringify(sub.body));
    assert.equal((await call("coord", "POST", `/api/verifications/${sub.body.id}/start-review`)).status, 403);
    assert.equal((await call("cadmin", "POST", `/api/verifications/${sub.body.id}/start-review`)).status, 403);
    assert.equal((await call("admin", "POST", `/api/verifications/${sub.body.id}/start-review`)).status, 200);
    // evidence must belong to the entity being verified
    const stuDoc = await prisma.document.findFirstOrThrow({ where: { studentId: ids.student! } });
    assert.equal((await call("coord", "POST", "/api/verifications", { entityType: "SCHOOL", entityId: ids.school, documentIds: [stuDoc.id] })).status, 400);
  });

  test("document integrity rows flag the seeded fixtures", async () => {
    const { auditDocumentRow } = await import("../services/document-integrity.rules.js");
    const docs = await prisma.document.findMany({ include: { verification: { select: { status: true } } } });
    const issues = docs.flatMap((d) => auditDocumentRow(d, new Map()));
    // none of the fixtures have storage objects, and the rest of the rows are otherwise consistent
    assert.ok(issues.some((i) => i.code === "STORAGE_OBJECT_MISSING"));
    assert.equal(issues.some((i) => i.code === "OWNER_COUNT"), false);
  });
});
