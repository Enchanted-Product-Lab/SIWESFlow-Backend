import type { ActivityStatus, Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { forbidden, notFound } from "../../lib/http-error.js";
import { loadActor } from "../access/actor.js";
import { studentRelation } from "../access/relations.js";

// Contract: API-DRAFT "Route 2". Placed + unplaced + completed = total, and
// active + at risk + inactive = total (only PLACED students can be active).
export async function schoolDashboardMetrics(userId: string) {
  const actor = await loadActor(userId);
  // Same cohort the coordinator sees in GET /api/students.
  const where: Prisma.StudentWhereInput = {
    OR: [{ schoolId: { in: actor.coordinatedSchoolIds } }, { coordinatorId: actor.id }],
  };

  const [byPlacement, byEngagement] = await Promise.all([
    prisma.student.groupBy({ by: ["placementStatus"], where, _count: { _all: true } }),
    prisma.student.groupBy({ by: ["engagementStatus"], where, _count: { _all: true } }),
  ]);
  const placement = (s: string) =>
    byPlacement.find((g) => g.placementStatus === s)?._count._all ?? 0;
  const engagement = (s: string) =>
    byEngagement.find((g) => g.engagementStatus === s)?._count._all ?? 0;

  const totalStudents = byPlacement.reduce((sum, g) => sum + g._count._all, 0);
  const placedStudents = placement("PLACED");
  const completedStudents = placement("COMPLETED");
  return {
    asOf: new Date(),
    totalStudents,
    placedStudents,
    // UNPLACED, APPLIED and WITHDRAWN: everyone without a placement right now.
    unplacedStudents: totalStudents - placedStudents - completedStudents,
    completedStudents,
    activeStudents: engagement("ACTIVE"),
    atRiskStudents: engagement("AT_RISK"),
    inactiveStudents: engagement("INACTIVE"),
    placementCoverage: totalStudents
      ? Math.round((placedStudents / totalStudents) * 1000) / 10
      : 0,
  };
}

export async function supervisorMetrics(userId: string) {
  const { supervisorId } = await loadActor(userId);
  if (!supervisorId) throw forbidden("Complete your supervisor profile first");

  const mine = { supervisorId };
  const entries = (status: ActivityStatus) => ({ status, student: mine });
  const [totalStudents, approved, pendingReviews, atRiskStudents] = await Promise.all([
    prisma.student.count({ where: mine }),
    prisma.activity.aggregate({ where: entries("APPROVED"), _sum: { hoursWorked: true } }),
    prisma.activity.count({ where: entries("PENDING") }),
    prisma.student.count({ where: { ...mine, engagementStatus: "AT_RISK" } }),
  ]);
  return {
    asOf: new Date(),
    totalStudents,
    hoursVerified: approved._sum.hoursWorked ?? 0,
    pendingReviews,
    atRiskStudents,
  };
}

type TimelineEvent = { at: Date; type: string } & Record<string, unknown>;

function entryEventType(from: ActivityStatus | null, to: ActivityStatus): string {
  if (from === null) return "ENTRY_SUBMITTED";
  if (to === "PENDING") return from === "NEEDS_REVISION" ? "ENTRY_RESUBMITTED" : "ENTRY_EDITED";
  return `ENTRY_${to}`; // ENTRY_APPROVED / ENTRY_NEEDS_REVISION / ENTRY_REJECTED
}

// profile -> placement -> submissions -> approvals -> completion,
// oldest first. Applications to other companies are in here, so the host side
// (supervisor, company admin) does not get it.
export async function studentTimeline(userId: string, studentId: string) {
  const actor = await loadActor(userId);
  const relation = await studentRelation(actor, studentId);
  if (relation === null || relation === "host") throw notFound("Student not found");

  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: {
      createdAt: true,
      applications: {
        select: {
          id: true,
          status: true,
          appliedAt: true,
          respondedAt: true,
          placement: { select: { id: true, title: true, company: { select: { name: true } } } },
        },
      },
      completion: true,
    },
  });
  if (!student) throw notFound("Student not found");

  const [verificationEvents, entryEvents] = await Promise.all([
    prisma.verificationEvent.findMany({
      where: { verification: { entityType: "STUDENT", entityId: studentId } },
      select: { createdAt: true, fromStatus: true, toStatus: true, note: true },
    }),
    prisma.activityEvent.findMany({
      where: { activity: { studentId } },
      select: {
        createdAt: true,
        fromStatus: true,
        toStatus: true,
        note: true,
        rating: true,
        activity: { select: { id: true, title: true, date: true } },
      },
    }),
  ]);

  const events: TimelineEvent[] = [{ at: student.createdAt, type: "PROFILE_CREATED" }];

  for (const e of verificationEvents) {
    events.push({ at: e.createdAt, type: `VERIFICATION_${e.toStatus}`, note: e.note });
  }
  for (const a of student.applications) {
    const placement = { id: a.placement.id, title: a.placement.title, company: a.placement.company.name };
    events.push({ at: a.appliedAt, type: "APPLICATION_SUBMITTED", applicationId: a.id, placement });
    if (a.respondedAt) {
      events.push({ at: a.respondedAt, type: `APPLICATION_${a.status}`, applicationId: a.id, placement });
    }
  }
  for (const e of entryEvents) {
    events.push({
      at: e.createdAt,
      type: entryEventType(e.fromStatus, e.toStatus),
      entry: e.activity,
      ...(e.note ? { note: e.note } : {}),
      ...(e.rating ? { rating: e.rating } : {}),
    });
  }
  const c = student.completion;
  if (c) {
    events.push({ at: c.requestedAt, type: "COMPLETION_REQUESTED" });
    if (c.supervisorSignedOffAt) {
      events.push({ at: c.supervisorSignedOffAt, type: "COMPLETION_SUPERVISOR_SIGNED_OFF" });
    }
    if (c.verifiedAt) {
      events.push({ at: c.verifiedAt, type: "COMPLETION_VERIFIED", certificateReference: c.certificateReference });
    }
    if (c.status === "DECLINED") {
      events.push({ at: c.updatedAt, type: "COMPLETION_DECLINED", note: c.declineReason });
    }
  }

  return events.sort((a, b) => a.at.getTime() - b.at.getTime());
}
