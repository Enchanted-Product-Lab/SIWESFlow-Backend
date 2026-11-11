import { randomBytes } from "node:crypto";
import { env } from "../../config/env.js";
import { prisma } from "../../lib/prisma.js";
import { badRequest, conflict, forbidden, notFound } from "../../lib/http-error.js";
import { isUniqueViolation } from "../../lib/pagination.js";
import { loadActor } from "../access/actor.js";
import { studentRelation } from "../access/relations.js";
import type { CompletionDecision } from "./completion.schema.js";
import { assessRequirements } from "./completion.rules.js";

async function requirementsFor(studentId: string) {
  const entries = await prisma.activity.findMany({
    where: { studentId },
    select: { status: true, hoursWorked: true, date: true },
  });
  return assessRequirements(entries, {
    hours: env.COMPLETION_MIN_HOURS,
    weeks: env.COMPLETION_MIN_WEEKS,
  });
}

// Progress toward completion plus any request in flight, for anyone who may
// read the student.
export async function getCompletion(userId: string, studentId: string) {
  const actor = await loadActor(userId);
  if (!(await studentRelation(actor, studentId))) throw notFound("Student not found");
  const [completion, requirements] = await Promise.all([
    prisma.siwesCompletion.findUnique({ where: { studentId } }),
    requirementsFor(studentId),
  ]);
  return { completion, requirements };
}

export async function requestCompletion(userId: string) {
  const { studentId } = await loadActor(userId);
  if (!studentId) throw forbidden("Create your student profile first");

  const student = await prisma.student.findUniqueOrThrow({
    where: { id: studentId },
    select: { placementStatus: true, supervisorId: true },
  });
  if (student.placementStatus !== "PLACED") {
    throw conflict("Only a student on an active placement can request completion");
  }
  if (!student.supervisorId) {
    throw conflict("You need an assigned supervisor to sign off your completion");
  }

  const requirements = await requirementsFor(studentId);
  if (!requirements.met) throw badRequest("SIWES completion requirements are not met", requirements);

  const snapshot = {
    status: "PENDING_SUPERVISOR" as const,
    totalHours: requirements.totalHours,
    approvedEntries: requirements.approvedEntries,
    weeksLogged: requirements.weeksLogged,
    requestedAt: new Date(),
  };
  const existing = await prisma.siwesCompletion.findUnique({ where: { studentId } });
  if (!existing) {
    try {
      return await prisma.siwesCompletion.create({ data: { studentId, ...snapshot } });
    } catch (err) {
      // The unique studentId lost a race with a parallel request.
      if (isUniqueViolation(err)) throw conflict("A completion request is already in progress");
      throw err;
    }
  }

  // A declined request starts over on the same row; anything else is in flight.
  const { count } = await prisma.siwesCompletion.updateMany({
    where: { id: existing.id, status: "DECLINED" },
    data: {
      ...snapshot,
      supervisorId: null,
      supervisorSignedOffAt: null,
      supervisorRemarks: null,
      verifiedById: null,
      verifiedAt: null,
      declineReason: null,
    },
  });
  if (count === 0) throw conflict("A completion request is already in progress");
  return prisma.siwesCompletion.findUniqueOrThrow({ where: { id: existing.id } });
}

async function loadCompletion(completionId: string) {
  const completion = await prisma.siwesCompletion.findUnique({
    where: { id: completionId },
    select: { id: true, status: true, studentId: true, student: { select: { supervisorId: true } } },
  });
  if (!completion) throw notFound("Completion request not found");
  return completion;
}

export async function supervisorSignOff(userId: string, completionId: string, input: CompletionDecision) {
  const actor = await loadActor(userId);
  const completion = await loadCompletion(completionId);
  // Only the student's own supervisor, not anyone else at the company.
  if (!actor.supervisorId || completion.student.supervisorId !== actor.supervisorId) {
    throw notFound("Completion request not found");
  }

  const approve = input.decision === "APPROVE";
  const { count } = await prisma.siwesCompletion.updateMany({
    where: { id: completionId, status: "PENDING_SUPERVISOR" },
    data: approve
      ? {
          status: "PENDING_SCHOOL",
          supervisorId: actor.supervisorId,
          supervisorSignedOffAt: new Date(),
          supervisorRemarks: input.remarks || null,
        }
      : { status: "DECLINED", supervisorId: actor.supervisorId, declineReason: input.remarks ?? null },
  });
  if (count === 0) throw conflict("This request is not waiting on a supervisor sign-off");
  return prisma.siwesCompletion.findUniqueOrThrow({ where: { id: completionId } });
}

export async function schoolVerify(userId: string, completionId: string, input: CompletionDecision) {
  const actor = await loadActor(userId);
  const completion = await loadCompletion(completionId);
  if ((await studentRelation(actor, completion.studentId)) !== "school") {
    throw notFound("Completion request not found");
  }

  if (input.decision === "DECLINE") {
    const { count } = await prisma.siwesCompletion.updateMany({
      where: { id: completionId, status: "PENDING_SCHOOL" },
      data: { status: "DECLINED", declineReason: input.remarks ?? null },
    });
    if (count === 0) throw conflict("This request is not waiting on the school");
    return prisma.siwesCompletion.findUniqueOrThrow({ where: { id: completionId } });
  }

  return prisma.$transaction(async (tx) => {
    const { count } = await tx.siwesCompletion.updateMany({
      where: { id: completionId, status: "PENDING_SCHOOL" },
      data: {
        status: "VERIFIED",
        verifiedById: actor.id,
        verifiedAt: new Date(),
        // Random, not derived: the public check is a lookup, so what matters
        // is that nobody can guess another student's reference.
        certificateReference: `SIWES-${randomBytes(10).toString("hex").toUpperCase()}`,
      },
    });
    if (count === 0) throw conflict("This request is not waiting on the school");
    await tx.student.update({
      where: { id: completion.studentId },
      data: { placementStatus: "COMPLETED" },
    });
    return tx.siwesCompletion.findUniqueOrThrow({ where: { id: completionId } });
  });
}

// Public: what a certificate's holder and issuer are, nothing that identifies
// the student beyond their name.
export async function verifyCertificate(reference: string) {
  const completion = await prisma.siwesCompletion.findUnique({
    where: { certificateReference: reference },
    select: {
      status: true,
      certificateReference: true,
      verifiedAt: true,
      totalHours: true,
      weeksLogged: true,
      student: {
        select: {
          firstName: true,
          lastName: true,
          department: true,
          siwesStartDate: true,
          siwesEndDate: true,
          school: { select: { name: true } },
          placement: { select: { company: { select: { name: true } } } },
        },
      },
    },
  });
  if (!completion || completion.status !== "VERIFIED") throw notFound("No verified certificate with that reference");
  const { student } = completion;
  return {
    certificateReference: completion.certificateReference,
    verifiedAt: completion.verifiedAt,
    studentName: `${student.firstName} ${student.lastName}`,
    department: student.department,
    school: student.school.name,
    company: student.placement?.company.name ?? null,
    siwesStartDate: student.siwesStartDate,
    siwesEndDate: student.siwesEndDate,
    totalHours: completion.totalHours,
    weeksLogged: completion.weeksLogged,
  };
}
