import type { Prisma } from "../../generated/prisma/client.js";
import {
  ApplicationStatus,
  PlacementApprovalStatus,
  PlacementStatus,
} from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { badRequest, conflict, forbidden, notFound } from "../../lib/http-error.js";
import { isUniqueViolation, skipTake, type Page } from "../../lib/pagination.js";
import { stripUndefined } from "../../lib/object.js";
import { isAdmin, loadActor, type Actor } from "../access/actor.js";
import type {
  ApplyInput,
  ApprovePlacementInput,
  CreatePlacementInput,
  ListPlacementsQuery,
  UpdatePlacementInput,
} from "./placement.schema.js";

const COMPANY_SUMMARY = {
  id: true,
  companyCode: true,
  name: true,
  industry: true,
  state: true,
  country: true,
  logoUrl: true,
} as const;

const STUDENT_SUMMARY = {
  id: true,
  studentCode: true,
  firstName: true,
  lastName: true,
  department: true,
  level: true,
} as const;

const PLACEMENT_INCLUDE = { company: { select: COMPANY_SUMMARY } } as const;

type PlacementRow = Prisma.PlacementGetPayload<{ include: typeof PLACEMENT_INCLUDE }>;

/**
 * Who may see which placements:
 * - platform admin: everything
 * - company admin: only their own company's rows, in any state
 * - everyone else: only live, school-approved rows
 */
function visibilityScope(actor: Actor): Prisma.PlacementWhereInput {
  if (isAdmin(actor)) return {};
  if (actor.role === "COMPANY_ADMIN" && actor.ownedCompanyId) {
    return { companyId: actor.ownedCompanyId };
  }
  return { isActive: true, approvalStatus: PlacementApprovalStatus.APPROVED };
}

function canManageCompanyPlacements(actor: Actor, companyId: string): boolean {
  return isAdmin(actor) || (actor.role === "COMPANY_ADMIN" && actor.ownedCompanyId === companyId);
}

export async function createPlacement(userId: string, input: CreatePlacementInput) {
  const actor = await loadActor(userId);
  if (actor.role !== "COMPANY_ADMIN" && !isAdmin(actor)) {
    throw forbidden("Only a company admin can create placements");
  }

  // A company admin can only ever post for the company they own, so their own
  // id wins over anything in the body. Platform admins must name a company.
  const companyId = actor.ownedCompanyId ?? input.companyId;
  if (!companyId) throw badRequest("companyId is required when posting for a company");

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { id: true },
  });
  if (!company) throw notFound("Company not found");

  return prisma.placement.create({
    data: {
      companyId,
      title: input.title,
      description: input.description ?? null,
      department: input.department,
      requiredLevel: input.requiredLevel ?? null,
      requiredSkills: input.requiredSkills ?? [],
      availableSlots: input.availableSlots,
      startDate: input.startDate,
      endDate: input.endDate,
      location: input.location ?? null,
      workMode: input.workMode,
      isActive: true,
      // New placements always wait for the school's verdict.
      approvalStatus: PlacementApprovalStatus.PENDING,
    },
    include: PLACEMENT_INCLUDE,
  });
}

export async function listPlacements(
  userId: string,
  q: ListPlacementsQuery,
): Promise<Page<PlacementRow>> {
  const actor = await loadActor(userId);

  const where: Prisma.PlacementWhereInput = {
    AND: [
      visibilityScope(actor),
      stripUndefined({
        companyId: q.companyId,
        department: q.department,
        workMode: q.workMode,
        isActive: q.isActive,
        approvalStatus: q.approvalStatus,
      }),
      q.from || q.to
        ? {
            startDate: {
              ...(q.from ? { gte: q.from } : {}),
              ...(q.to ? { lte: q.to } : {}),
            },
          }
        : {},
    ],
  };

  const [rows, total] = await Promise.all([
    prisma.placement.findMany({
      where,
      include: PLACEMENT_INCLUDE,
      orderBy: [{ createdAt: "desc" }],
      ...skipTake(q.page, q.pageSize),
    }),
    prisma.placement.count({ where }),
  ]);

  return { data: rows, page: q.page, pageSize: q.pageSize, total };
}

export async function getPlacement(userId: string, placementId: string) {
  const actor = await loadActor(userId);
  const placement = await prisma.placement.findUnique({
    where: { id: placementId },
    include: PLACEMENT_INCLUDE,
  });
  if (!placement) throw notFound("Placement not found");

  const visible =
    isAdmin(actor) ||
    canManageCompanyPlacements(actor, placement.companyId) ||
    (placement.isActive && placement.approvalStatus === PlacementApprovalStatus.APPROVED);
  if (!visible) throw notFound("Placement not found");

  return placement;
}

export async function updatePlacement(
  userId: string,
  placementId: string,
  input: UpdatePlacementInput,
) {
  const actor = await loadActor(userId);
  const placement = await prisma.placement.findUnique({ where: { id: placementId } });
  if (!placement) throw notFound("Placement not found");
  if (!canManageCompanyPlacements(actor, placement.companyId)) {
    throw forbidden("Only the company that owns this placement can edit it");
  }
  if (input.availableSlots !== undefined && input.availableSlots < placement.filledSlots) {
    throw badRequest(
      `availableSlots cannot be lower than the ${placement.filledSlots} slot(s) already filled`,
    );
  }

  return prisma.placement.update({
    where: { id: placementId },
    data: stripUndefined({
      title: input.title,
      description: input.description,
      department: input.department,
      requiredLevel: input.requiredLevel,
      requiredSkills: input.requiredSkills,
      availableSlots: input.availableSlots,
      startDate: input.startDate,
      endDate: input.endDate,
      location: input.location,
      workMode: input.workMode,
    }),
    include: PLACEMENT_INCLUDE,
  });
}

export async function setPlacementActive(userId: string, placementId: string, isActive: boolean) {
  const actor = await loadActor(userId);
  const placement = await prisma.placement.findUnique({ where: { id: placementId } });
  if (!placement) throw notFound("Placement not found");
  if (!canManageCompanyPlacements(actor, placement.companyId)) {
    throw forbidden("Only the company that owns this placement can change its status");
  }

  return prisma.placement.update({
    where: { id: placementId },
    data: { isActive },
    include: PLACEMENT_INCLUDE,
  });
}

export async function approvePlacement(
  userId: string,
  placementId: string,
  input: ApprovePlacementInput,
) {
  const actor = await loadActor(userId);
  if (!isAdmin(actor) && actor.role !== "SCHOOL_COORDINATOR") {
    throw forbidden("Only a school coordinator or platform admin can approve placements");
  }

  const placement = await prisma.placement.findUnique({ where: { id: placementId } });
  if (!placement) throw notFound("Placement not found");

  return prisma.placement.update({
    where: { id: placementId },
    data: {
      approvalStatus: input.approvalStatus,
      approvedById: actor.id,
      approvedAt: new Date(),
      approvalNote: input.approvalNote ?? null,
    },
    include: PLACEMENT_INCLUDE,
  });
}

export async function applyToPlacement(userId: string, placementId: string, input: ApplyInput) {
  const actor = await loadActor(userId);
  if (!actor.studentId) throw forbidden("Create your student profile before applying");

  const placement = await prisma.placement.findUnique({
    where: { id: placementId },
    select: {
      id: true,
      isActive: true,
      approvalStatus: true,
      availableSlots: true,
      filledSlots: true,
    },
  });
  if (!placement) throw notFound("Placement not found");
  if (!placement.isActive || placement.approvalStatus !== PlacementApprovalStatus.APPROVED) {
    throw conflict("This placement is not open for applications");
  }
  if (placement.filledSlots >= placement.availableSlots) {
    throw conflict("This placement has no available slots");
  }

  try {
    const application = await prisma.$transaction(async (tx) => {
      const created = await tx.application.create({
        data: {
          studentId: actor.studentId!,
          placementId,
          coverNote: input.coverNote ?? null,
          status: ApplicationStatus.PENDING,
        },
        include: { student: { select: STUDENT_SUMMARY } },
      });

      // Applying is a state change on the student, not on the slot count.
      // Slots are only consumed when a company accepts.
      await tx.student.updateMany({
        where: { id: actor.studentId!, placementStatus: PlacementStatus.UNPLACED },
        data: { placementStatus: PlacementStatus.APPLIED },
      });

      return created;
    });

    return application;
  } catch (err) {
    // @@unique([studentId, placementId]) is the real duplicate guard.
    if (isUniqueViolation(err)) throw conflict("You have already applied to this placement");
    throw err;
  }
}

/**
 * Accepting is the only place a slot is consumed, so the count can never drift
 * from the number of students actually placed.
 */
export async function acceptApplication(userId: string, applicationId: string) {
  const actor = await loadActor(userId);

  return prisma.$transaction(async (tx) => {
    const application = await tx.application.findUnique({
      where: { id: applicationId },
      include: { placement: { select: { id: true, companyId: true } } },
    });
    if (!application) throw notFound("Application not found");
    if (!canManageCompanyPlacements(actor, application.placement.companyId)) {
      throw forbidden("Only the company that owns this placement can accept applications");
    }
    if (application.status !== ApplicationStatus.PENDING) {
      throw conflict(`This application is already ${application.status.toLowerCase()}`);
    }

    // Compare-and-swap on filledSlots: a concurrent accept loses the race
    // instead of pushing filledSlots past availableSlots.
    const fresh = await tx.placement.findUnique({
      where: { id: application.placementId },
      select: { availableSlots: true, filledSlots: true },
    });
    if (!fresh || fresh.filledSlots >= fresh.availableSlots) {
      throw conflict("This placement has no available slots");
    }
    const { count } = await tx.placement.updateMany({
      where: { id: application.placementId, filledSlots: fresh.filledSlots },
      data: { filledSlots: { increment: 1 } },
    });
    if (count === 0) throw conflict("This placement was just filled, please retry");

    const accepted = await tx.application.update({
      where: { id: applicationId },
      data: { status: ApplicationStatus.ACCEPTED, respondedAt: new Date() },
      include: { student: { select: STUDENT_SUMMARY } },
    });

    await tx.student.update({
      where: { id: application.studentId },
      data: {
        placementId: application.placementId,
        placementStatus: PlacementStatus.PLACED,
      },
    });

    return accepted;
  });
}

export async function rejectApplication(userId: string, applicationId: string) {
  const actor = await loadActor(userId);

  return prisma.$transaction(async (tx) => {
    const application = await tx.application.findUnique({
      where: { id: applicationId },
      include: { placement: { select: { companyId: true } } },
    });
    if (!application) throw notFound("Application not found");
    if (!canManageCompanyPlacements(actor, application.placement.companyId)) {
      throw forbidden("Only the company that owns this placement can reject applications");
    }
    if (application.status !== ApplicationStatus.PENDING) {
      throw conflict(`This application is already ${application.status.toLowerCase()}`);
    }

    const rejected = await tx.application.update({
      where: { id: applicationId },
      data: { status: ApplicationStatus.REJECTED, respondedAt: new Date() },
      include: { student: { select: STUDENT_SUMMARY } },
    });

    await tx.student.updateMany({
      where: { id: application.studentId, placementStatus: PlacementStatus.APPLIED },
      data: { placementStatus: PlacementStatus.UNPLACED },
    });

    return rejected;
  });
}

export async function listApplications(userId: string, placementId: string) {
  const actor = await loadActor(userId);
  const placement = await prisma.placement.findUnique({
    where: { id: placementId },
    select: { companyId: true },
  });
  if (!placement) throw notFound("Placement not found");
  if (!canManageCompanyPlacements(actor, placement.companyId)) {
    throw forbidden("Only the company that owns this placement can view its applications");
  }

  return prisma.application.findMany({
    where: { placementId },
    include: { student: { select: STUDENT_SUMMARY } },
    orderBy: { appliedAt: "desc" },
  });
}
