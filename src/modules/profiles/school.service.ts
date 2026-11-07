import { randomBytes } from "node:crypto";
import type { Prisma, School } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { conflict, forbidden, notFound } from "../../lib/http-error.js";
import { isUniqueViolation, skipTake, type Page } from "../../lib/pagination.js";
import { stripUndefined } from "../../lib/object.js";
import { isAdmin, loadActor } from "../access/actor.js";
import { schoolRelation, type SchoolRelation } from "../access/relations.js";
import { deleteStoredFilesForOwner } from "../../modules/document/document.service.js";
import type { CreateSchoolInput, UpdateSchoolInput } from "./school.schema.js";

const PRIVATE_FIELDS = ["coordinatorEmail", "coordinatorPhone", "coordinatorId", "verifiedById"] as const;

// Anyone signed in may browse schools (students pick one when they register);
// contact and audit fields are only for the school's own coordinator and admins.
function view(school: School, relation: SchoolRelation): Partial<School> {
  if (relation === "admin" || relation === "coordinator") return school;
  const copy: Partial<School> = { ...school };
  for (const key of PRIVATE_FIELDS) delete copy[key];
  return copy;
}

const generateSchoolCode = () => `SCH-${randomBytes(4).toString("hex").toUpperCase()}`;

export async function createSchoolProfile(userId: string, input: CreateSchoolInput) {
  const actor = await loadActor(userId);
  if (actor.role !== "SCHOOL_COORDINATOR" && !isAdmin(actor)) {
    throw forbidden("Only school coordinators can register a school");
  }
  try {
    return await prisma.school.create({
      data: {
        ...stripUndefined(input),
        schoolCode: generateSchoolCode(),
        ...(actor.role === "SCHOOL_COORDINATOR" ? { coordinator: { connect: { id: actor.id } } } : {}),
      },
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("A school with this email already exists");
    throw err;
  }
}

export async function getMySchools(userId: string) {
  return prisma.school.findMany({ where: { coordinatorId: userId }, orderBy: { createdAt: "desc" } });
}

export async function getSchoolProfile(userId: string, schoolId: string) {
  const actor = await loadActor(userId);
  const school = await prisma.school.findUnique({ where: { id: schoolId } });
  if (!school) throw notFound("School not found");
  return view(school, await schoolRelation(actor, schoolId));
}

export async function listSchools(
  userId: string,
  q: {
    page: number;
    pageSize: number;
    state?: string | undefined;
    verificationStatus?: School["verificationStatus"] | undefined;
    search?: string | undefined;
  }
): Promise<Page<Partial<School>>> {
  const actor = await loadActor(userId);
  const where: Prisma.SchoolWhereInput = {
    ...stripUndefined({ state: q.state, verificationStatus: q.verificationStatus }),
    ...(q.search ? { name: { contains: q.search, mode: "insensitive" } } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.school.findMany({ where, orderBy: { name: "asc" }, ...skipTake(q.page, q.pageSize) }),
    prisma.school.count({ where }),
  ]);
  const data = await Promise.all(rows.map(async (s) => view(s, await schoolRelation(actor, s.id))));
  return { data, page: q.page, pageSize: q.pageSize, total };
}

export async function updateSchoolProfile(userId: string, schoolId: string, input: UpdateSchoolInput) {
  const actor = await loadActor(userId);
  const relation = await schoolRelation(actor, schoolId);
  if (relation !== "admin" && relation !== "coordinator") {
    const exists = await prisma.school.findUnique({ where: { id: schoolId }, select: { id: true } });
    throw exists ? forbidden("You do not coordinate this school") : notFound("School not found");
  }
  try {
    return await prisma.school.update({ where: { id: schoolId }, data: stripUndefined(input) });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("A school with this email already exists");
    throw err;
  }
}

export async function deleteSchoolProfile(userId: string, schoolId: string) {
  const actor = await loadActor(userId);
  if (!isAdmin(actor)) throw forbidden("Only a platform admin can delete a school");
  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: { id: true, _count: { select: { students: true } } },
  });
  if (!school) throw notFound("School not found");
  if (school._count.students > 0) throw conflict("School still has enrolled students");

  await deleteStoredFilesForOwner("school", schoolId);
  await prisma.school.delete({ where: { id: schoolId } });
}
