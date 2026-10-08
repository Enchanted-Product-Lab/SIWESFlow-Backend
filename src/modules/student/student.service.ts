import type { Student, Prisma } from "../../generated/prisma/client.js";
import { Gender, PlacementStatus } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";

export async function createStudent(
  data: Prisma.StudentCreateInput
): Promise<Student> {
  return prisma.student.create({ data });
}

async function example() {
  const student = await createStudent({
    studentCode: "NDU/2026/001234",
    firstName: "Francess",
    lastName: "Okafor",
    dateOfBirth: new Date("2001-04-12"),
    gender: Gender.FEMALE,
    email: "francess.okafor@example.edu.ng",
    phoneNumber: "+2348012345678",
    faculty: "Engineering",
    department: "Electrical/Electronic Engineering",
    programme: "BEng Electrical Engineering",
    level: "400",
    matriculationNumber: "ENG/2019/0456",
    academicSession: "2025/2026",
    siwesSession: "2026",
    school: { connect: { id: "school_cuid_here" } },
    user: { connect: { id: "user_cuid_here" } },
  });

  console.log(student.placementStatus);
}

export async function getStudentById(id: string): Promise<Student | null> {
  return prisma.student.findUnique({
    where: { id },
    include: { school: true, documents: true, activities: true },
  });
}

export async function getAtRiskStudentsForSchool(
  schoolId: string
): Promise<Student[]> {
  return prisma.student.findMany({
    where: {
      schoolId,
      engagementStatus: "AT_RISK",
    },
  });
}

export async function updatePlacementStatus(
  id: string,
  status: PlacementStatus
): Promise<Student> {
  return prisma.student.update({
    where: { id },
    data: { placementStatus: status },
  });
}
