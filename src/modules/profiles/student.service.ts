import { randomBytes } from "node:crypto";
import type { Prisma, Student } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { conflict, forbidden, notFound } from "../../lib/http-error.js";
import { isUniqueViolation, skipTake, type Page } from "../../lib/pagination.js";
import { stripUndefined } from "../../lib/object.js";
import { isAdmin, loadActor, type Actor } from "../access/actor.js";
import { studentRelation, type StudentRelation } from "../access/relations.js";
import { deleteStoredFilesForOwner } from "../../modules/document/document.service.js";
import type { CreateStudentInput, UpdateStudentInput } from "./student.schema.js";

// Hosts (supervisor / company) see what they need to work with the student,
// not identity details.
const HOST_HIDDEN = ["dateOfBirth", "address", "matriculationNumber", "phoneNumber"] as const;

function view(student: Student, relation: StudentRelation): Partial<Student> {
  if (relation !== "host") return student;
  const copy: Partial<Student> = { ...student };
  for (const key of HOST_HIDDEN) delete copy[key];
  return copy;
}

const generateStudentCode = () =>
  `SF-${new Date().getFullYear()}-${randomBytes(4).toString("hex").toUpperCase()}`;

export async function createStudentProfile(userId: string, input: CreateStudentInput) {
  const actor = await loadActor(userId);
  if (actor.role !== "STUDENT") throw forbidden("Only student accounts can create a student profile");
  if (actor.studentId) throw conflict("You already have a student profile");

  const school = await prisma.school.findUnique({
    where: { id: input.schoolId },
    select: { id: true, coordinatorId: true },
  });
  if (!school) throw notFound("School not found");

  const { schoolId, ...fields } = input;
  try {
    return await prisma.student.create({
      data: {
        ...stripUndefined(fields),
        studentCode: generateStudentCode(),
        email: actor.email,
        user: { connect: { id: actor.id } },
        school: { connect: { id: schoolId } },
        ...(school.coordinatorId ? { coordinator: { connect: { id: school.coordinatorId } } } : {}),
      },
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("A student profile with these details already exists");
    throw err;
  }
}

export async function getMyStudentProfile(userId: string) {
  const student = await prisma.student.findUnique({ where: { userId } });
  if (!student) throw notFound("You have not created a student profile yet");
  return student;
}

export async function getStudentProfile(userId: string, studentId: string) {
  const actor = await loadActor(userId);
  const relation = await studentRelation(actor, studentId);
  if (!relation) {
    // Same answer whether the profile exists or not.
    throw notFound("Student not found");
  }
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    include: {
      school: { select: { id: true, name: true, schoolCode: true } },
      placement: { select: { id: true, title: true, companyId: true } },
    },
  });
  if (!student) throw notFound("Student not found");
  return view(student, relation);
}

function listScope(actor: Actor): Prisma.StudentWhereInput | null {
  if (isAdmin(actor)) return {};
  if (actor.role === "SCHOOL_COORDINATOR") {
    return { OR: [{ schoolId: { in: actor.coordinatedSchoolIds } }, { coordinatorId: actor.id }] };
  }
  if (actor.supervisorId) return { supervisorId: actor.supervisorId };
  if (actor.role === "COMPANY_ADMIN" && actor.ownedCompanyId) {
    return { placement: { companyId: actor.ownedCompanyId } };
  }
  return null;
}

export async function listStudents(
  userId: string,
  q: {
    page: number;
    pageSize: number;
    schoolId?: string | undefined;
    verificationStatus?: Student["verificationStatus"] | undefined;
    placementStatus?: Student["placementStatus"] | undefined;
    search?: string | undefined;
  }
): Promise<Page<Partial<Student>>> {
  const actor = await loadActor(userId);
  const scope = listScope(actor);
  if (!scope) throw forbidden("Your role cannot list students");

  const where: Prisma.StudentWhereInput = {
    AND: [
      scope,
      stripUndefined({
        schoolId: q.schoolId,
        verificationStatus: q.verificationStatus,
        placementStatus: q.placementStatus,
      }),
      q.search
        ? {
            OR: [
              { firstName: { contains: q.search, mode: "insensitive" } },
              { lastName: { contains: q.search, mode: "insensitive" } },
              { studentCode: { contains: q.search, mode: "insensitive" } },
            ],
          }
        : {},
    ],
  };

  const [rows, total] = await Promise.all([
    prisma.student.findMany({ where, orderBy: { createdAt: "desc" }, ...skipTake(q.page, q.pageSize) }),
    prisma.student.count({ where }),
  ]);
  const hostView = !isAdmin(actor) && actor.role !== "SCHOOL_COORDINATOR";
  return {
    data: rows.map((s) => view(s, hostView ? "host" : "school")),
    page: q.page,
    pageSize: q.pageSize,
    total,
  };
}

export async function updateStudentProfile(userId: string, studentId: string, input: UpdateStudentInput) {
  const actor = await loadActor(userId);
  const relation = await studentRelation(actor, studentId);
  if (relation !== "self" && relation !== "admin") {
    throw relation ? forbidden("Only the student can edit their profile") : notFound("Student not found");
  }

  const current = await prisma.student.findUnique({
    where: { id: studentId },
    select: { siwesStartDate: true, siwesEndDate: true },
  });
  if (!current) throw notFound("Student not found");

  // Dates may be patched one at a time; the merged range must still be valid.
  const start = input.siwesStartDate ?? current.siwesStartDate;
  const end = input.siwesEndDate ?? current.siwesEndDate;
  if (start && end && end <= start) {
    throw conflict("siwesEndDate must be after siwesStartDate");
  }

  return prisma.student.update({ where: { id: studentId }, data: stripUndefined(input) });
}

export async function deleteStudentProfile(userId: string, studentId: string) {
  const actor = await loadActor(userId);
  if (!isAdmin(actor)) throw forbidden("Only a platform admin can delete a student profile");
  const exists = await prisma.student.findUnique({ where: { id: studentId }, select: { id: true } });
  if (!exists) throw notFound("Student not found");

  await deleteStoredFilesForOwner("student", studentId);
  await prisma.student.delete({ where: { id: studentId } });
}
