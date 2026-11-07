import type { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { badRequest, conflict, forbidden, notFound } from "../../lib/http-error.js";
import { skipTake, type Page } from "../../lib/pagination.js";
import { stripUndefined } from "../../lib/object.js";
import { isAdmin, loadActor, type Actor } from "../access/actor.js";
import { studentRelation } from "../access/relations.js";
import type {
  CreateActivityInput,
  ListActivitiesQuery,
  ReviewActivityInput,
  UpdateActivityInput,
} from "./activity.schema.js";
import {
  canEdit,
  checkBackdating,
  checkNotFuture,
  checkWithinPeriod,
  endOfDay,
  startOfDay,
  type SiwesWindow,
} from "./activity.rules.js";

const STUDENT_SUMMARY = {
  id: true,
  studentCode: true,
  firstName: true,
  lastName: true,
  faculty: true,
  department: true,
  level: true,
} as const;

// Metadata only; the file itself comes from GET /documents/:id/url, so an entry
// read never depends on storage being reachable.
const EVIDENCE_SELECT = {
  id: true,
  filename: true,
  fileFormat: true,
  fileSizeBytes: true,
  uploadedAt: true,
} as const;

const ENTRY_INCLUDE = {
  student: { select: STUDENT_SUMMARY },
  document: { select: EVIDENCE_SELECT },
  reviewedBy: { select: { id: true, fullName: true } },
} as const;

type EntryWithRelations = Prisma.ActivityGetPayload<{ include: typeof ENTRY_INCLUDE }>;

function evidenceOf(entry: EntryWithRelations) {
  if (!entry.document) return [];
  return [
    {
      documentId: entry.document.id,
      fileName: entry.document.filename,
      fileFormat: entry.document.fileFormat,
      fileSizeBytes: entry.document.fileSizeBytes,
      uploadedAt: entry.document.uploadedAt,
    },
  ];
}

// The student record wins; the placement is the fallback (TRD §5.1).
async function siwesWindowOf(studentId: string): Promise<SiwesWindow> {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: {
      siwesStartDate: true,
      siwesEndDate: true,
      placement: { select: { startDate: true, endDate: true } },
    },
  });
  return {
    start: student?.siwesStartDate ?? student?.placement?.startDate ?? null,
    end: student?.siwesEndDate ?? student?.placement?.endDate ?? null,
  };
}

async function assertDateAllowed(date: Date, window: SiwesWindow): Promise<void> {
  for (const problem of [
    checkNotFuture(date, new Date()),
    checkBackdating(date, new Date()),
    checkWithinPeriod(date, window),
  ]) {
    if (!problem.ok) throw badRequest(problem.message);
  }
}

// Evidence is always an existing upload, never a second upload path (Appendix B).
async function assertEvidence(documentId: string | null | undefined, studentId: string) {
  if (!documentId) return;
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    select: { studentId: true, documentType: true },
  });
  if (!document) throw notFound("Evidence document not found");
  if (document.studentId !== studentId) {
    throw forbidden("That evidence document does not belong to you");
  }
  if (document.documentType !== "ACTIVITY_EVIDENCE") {
    throw badRequest("Evidence must be uploaded as an ACTIVITY_EVIDENCE document");
  }
}

export async function createActivity(userId: string, input: CreateActivityInput) {
  const actor = await loadActor(userId);
  if (!actor.studentId) throw forbidden("Create your student profile before logging activities");

  await assertDateAllowed(input.date, await siwesWindowOf(actor.studentId));
  await assertEvidence(input.documentId, actor.studentId);

  return prisma.activity.create({
    data: {
      ...stripUndefined({
        title: input.title,
        description: input.description,
        whatILearned: input.whatILearned,
        challenges: input.challenges,
        category: input.category,
        documentId: input.documentId,
      }),
      date: input.date,
      hoursWorked: input.hoursWorked,
      skillsUsed: input.skillsUsed ?? [],
      // Prisma's create input rejects mixing scalar `documentId` with a
      // `student: { connect }`, so both are scalars here.
      studentId: actor.studentId,
      // No draft state exists, so creating an entry is submitting it.
      status: "PENDING",
      submittedAt: new Date(),
    },
  });
}

async function requireEntryAccess(userId: string, activityId: string) {
  const actor = await loadActor(userId);
  const activity = await prisma.activity.findUnique({
    where: { id: activityId },
    include: ENTRY_INCLUDE,
  });
  if (!activity) throw notFound("Activity not found");

  const relation = await studentRelation(actor, activity.studentId);
  // Same answer for "does not exist" and "not yours to see".
  if (!relation) throw notFound("Activity not found");
  return { activity, relation };
}

export async function getActivity(userId: string, activityId: string) {
  const { activity } = await requireEntryAccess(userId, activityId);

  return {
    id: activity.id,
    date: activity.date,
    title: activity.title,
    description: activity.description,
    whatILearned: activity.whatILearned,
    skillsUsed: activity.skillsUsed,
    hoursWorked: activity.hoursWorked,
    challenges: activity.challenges,
    category: activity.category,
    status: activity.status,
    createdAt: activity.createdAt,
    updatedAt: activity.updatedAt,
    submittedAt: activity.submittedAt,
    student: activity.student,
    // Sprint 2's review endpoints write these. A resubmitted entry awaits review
    // again, so the old verdict is hidden but kept: supervisor deletion counts on it.
    review: activity.reviewedById && activity.status !== "PENDING"
      ? {
          status: activity.status,
          comment: activity.comment,
          rating: activity.rating,
          reviewedAt: activity.reviewedAt,
          reviewedBy: activity.reviewedBy,
        }
      : null,
    evidence: evidenceOf(activity),
  };
}

function listScope(actor: Actor): Prisma.ActivityWhereInput | null {
  if (isAdmin(actor)) return {};
  if (actor.studentId) return { studentId: actor.studentId };
  if (actor.role === "SCHOOL_COORDINATOR") {
    return {
      student: {
        OR: [
          { schoolId: { in: actor.coordinatedSchoolIds } },
          { coordinatorId: actor.id },
        ],
      },
    };
  }
  if (actor.supervisorId) return { student: { supervisorId: actor.supervisorId } };
  if (actor.role === "COMPANY_ADMIN" && actor.ownedCompanyId) {
    return { student: { placement: { companyId: actor.ownedCompanyId } } };
  }
  return null;
}

type EntrySummary = Prisma.ActivityGetPayload<{
  include: { student: { select: typeof STUDENT_SUMMARY } };
}>;

export async function listActivities(
  userId: string,
  q: ListActivitiesQuery
): Promise<Page<EntrySummary>> {
  const actor = await loadActor(userId);
  const scope = listScope(actor);
  if (!scope) throw forbidden("Your role cannot list logbook entries");

  const where: Prisma.ActivityWhereInput = {
    AND: [
      scope,
      stripUndefined({
        studentId: q.studentId,
        status: q.status,
        category: q.category,
      }),
      // Both ends are whole days, so `?to=2026-06-30` still covers the 30th.
      q.from || q.to
        ? {
            date: {
              ...(q.from ? { gte: startOfDay(q.from) } : {}),
              ...(q.to ? { lte: endOfDay(q.to) } : {}),
            },
          }
        : {},
    ],
  };

  const [rows, total] = await Promise.all([
    prisma.activity.findMany({
      where,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      include: { student: { select: STUDENT_SUMMARY } },
      ...skipTake(q.page, q.pageSize),
    }),
    prisma.activity.count({ where }),
  ]);

  return { data: rows, page: q.page, pageSize: q.pageSize, total };
}

export async function updateActivity(
  userId: string,
  activityId: string,
  input: UpdateActivityInput
) {
  const { activity, relation } = await requireEntryAccess(userId, activityId);
  if (relation !== "self") {
    throw forbidden("Only the student can edit their own logbook entry");
  }
  if (!canEdit(activity.status)) {
    throw conflict(`A ${activity.status.toLowerCase()} entry can no longer be edited`);
  }

  if (input.date && input.date.getTime() !== activity.date.getTime()) {
    await assertDateAllowed(input.date, await siwesWindowOf(activity.studentId));
  }
  if (input.documentId) await assertEvidence(input.documentId, activity.studentId);

  // Editing an entry that was sent back counts as resubmitting it.
  const resubmitted = activity.status === "NEEDS_REVISION";

  // The status guard stops this overwriting a review written since the read.
  const { count } = await prisma.activity.updateMany({
    where: { id: activityId, status: activity.status },
    data: {
      ...stripUndefined({
        title: input.title,
        description: input.description,
        whatILearned: input.whatILearned,
        challenges: input.challenges,
        category: input.category,
        documentId: input.documentId,
        skillsUsed: input.skillsUsed,
      }),
      ...(input.date ? { date: input.date } : {}),
      ...(input.hoursWorked !== undefined ? { hoursWorked: input.hoursWorked } : {}),
      ...(resubmitted ? { status: "PENDING" as const, submittedAt: new Date() } : {}),
    },
  });

  if (count === 0) {
    throw conflict("That entry changed since you opened it, reload it and edit again");
  }

  const updated = await prisma.activity.findUnique({ where: { id: activityId } });
  if (!updated) throw notFound("Activity not found");
  return updated;
}

export async function deleteActivity(userId: string, activityId: string) {
  const actor = await loadActor(userId);
  if (!isAdmin(actor)) throw forbidden("Only a platform admin can delete a logbook entry");
  // One statement: a concurrent delete is a 404, not a Prisma error.
  const { count } = await prisma.activity.deleteMany({ where: { id: activityId } });
  if (count === 0) throw notFound("Activity not found");
}

export async function reviewActivity(
  userId: string,
  activityId: string,
  input: ReviewActivityInput,
) {
  const actor = await loadActor(userId);
  if (!actor.supervisorId) throw forbidden("Only a supervisor can review activities");

  const { activity, relation } = await requireEntryAccess(userId, activityId);
  if (relation !== "host") {
    throw forbidden("You can only review activities of your assigned students");
  }
  if (activity.status !== "PENDING" && activity.status !== "NEEDS_REVISION") {
    throw conflict(`A ${activity.status.toLowerCase()} activity cannot be reviewed again`);
  }

  // reviewedById points at the Supervisor row, not the User row.
  const { count } = await prisma.activity.updateMany({
    where: { id: activityId, status: activity.status },
    data: stripUndefined({
      status: input.status,
      reviewedById: actor.supervisorId,
      reviewedAt: new Date(),
      comment: input.comment,
      rating: input.rating,
    }),
  });
  if (count === 0) throw conflict("This entry was already reviewed");

  return prisma.activity.findUniqueOrThrow({
    where: { id: activityId },
    include: {
      student: { select: STUDENT_SUMMARY },
      reviewedBy: { select: { id: true, fullName: true } },
    },
  });
}
