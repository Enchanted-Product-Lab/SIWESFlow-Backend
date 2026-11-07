import type { Prisma, Supervisor } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { conflict, forbidden, notFound } from "../../lib/http-error.js";
import { isUniqueViolation, skipTake, type Page } from "../../lib/pagination.js";
import { stripUndefined } from "../../lib/object.js";
import { isAdmin, loadActor } from "../access/actor.js";
import { isSupervisedBy, supervisorRelation } from "../access/relations.js";
import { deleteStoredFilesForOwner } from "../../modules/document/document.service.js";
import type {
  CompleteSupervisorInput,
  InviteSupervisorInput,
  UpdateSupervisorInput,
} from "./supervisor.schema.js";

async function requireCompanyManager(userId: string, companyId?: string) {
  const actor = await loadActor(userId);
  if (isAdmin(actor)) {
    if (!companyId) throw forbidden("companyId is required");
    return { actor, companyId };
  }
  if (actor.role !== "COMPANY_ADMIN" || !actor.ownedCompanyId) {
    throw forbidden("Only a company admin can manage supervisors");
  }
  if (companyId && companyId !== actor.ownedCompanyId) throw forbidden("That is not your company");
  return { actor, companyId: actor.ownedCompanyId };
}

// Company admin invites a supervisor; the record exists before the supervisor
// has an account and is linked when they complete their profile.
export async function inviteSupervisor(
  userId: string,
  input: InviteSupervisorInput & { companyId?: string }
) {
  const { companyId, ...fields } = input;
  const manager = await requireCompanyManager(userId, companyId);
  try {
    return await prisma.supervisor.create({
      data: {
        ...stripUndefined(fields),
        activationStatus: "INVITED",
        company: { connect: { id: manager.companyId } },
      },
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("A supervisor with this email already exists");
    throw err;
  }
}

export async function completeMySupervisorProfile(userId: string, input: CompleteSupervisorInput) {
  const actor = await loadActor(userId);
  if (actor.role !== "SUPERVISOR") throw forbidden("Only supervisor accounts can do this");

  const invited = await prisma.supervisor.findUnique({ where: { email: actor.email } });
  if (!invited) throw notFound("No supervisor invitation exists for your email");
  if (invited.userId && invited.userId !== actor.id) throw conflict("This invitation is already claimed");

  return prisma.supervisor.update({
    where: { id: invited.id },
    data: {
      ...stripUndefined(input),
      user: { connect: { id: actor.id } },
      activationStatus: invited.activationStatus === "INVITED" ? "PROFILE_COMPLETED" : invited.activationStatus,
    },
  });
}

export async function getMySupervisorProfile(userId: string) {
  const supervisor = await prisma.supervisor.findUnique({ where: { userId } });
  if (!supervisor) throw notFound("You have no supervisor profile yet");
  return supervisor;
}

export async function getSupervisorProfile(userId: string, supervisorId: string) {
  const actor = await loadActor(userId);
  const supervisor = await prisma.supervisor.findUnique({ where: { id: supervisorId } });
  if (!supervisor) throw notFound("Supervisor not found");

  const relation = supervisorRelation(actor, supervisor);
  if (relation) return supervisor;

  // A student can see who supervises them, minus contact and audit fields.
  if (await isSupervisedBy(actor, supervisorId)) {
    const { fullName, position, department, profileImageUrl, companyId, id } = supervisor;
    return { id, fullName, position, department, profileImageUrl, companyId };
  }
  throw notFound("Supervisor not found");
}

export async function listSupervisors(
  userId: string,
  q: {
    page: number;
    pageSize: number;
    companyId?: string | undefined;
    activationStatus?: Supervisor["activationStatus"] | undefined;
  }
): Promise<Page<Supervisor>> {
  const actor = await loadActor(userId);
  let scope: Prisma.SupervisorWhereInput;
  if (isAdmin(actor)) scope = stripUndefined({ companyId: q.companyId });
  else if (actor.role === "COMPANY_ADMIN" && actor.ownedCompanyId) scope = { companyId: actor.ownedCompanyId };
  else throw forbidden("Your role cannot list supervisors");

  const where: Prisma.SupervisorWhereInput = {
    ...scope,
    ...stripUndefined({ activationStatus: q.activationStatus }),
  };
  const [data, total] = await Promise.all([
    prisma.supervisor.findMany({ where, orderBy: { createdAt: "desc" }, ...skipTake(q.page, q.pageSize) }),
    prisma.supervisor.count({ where }),
  ]);
  return { data, page: q.page, pageSize: q.pageSize, total };
}

async function loadManaged(userId: string, supervisorId: string, allowSelf: boolean) {
  const actor = await loadActor(userId);
  const supervisor = await prisma.supervisor.findUnique({ where: { id: supervisorId } });
  if (!supervisor) throw notFound("Supervisor not found");
  const relation = supervisorRelation(actor, supervisor);
  const allowed = relation === "admin" || relation === "company" || (allowSelf && relation === "self");
  if (!allowed) throw relation ? forbidden("You cannot modify this supervisor") : notFound("Supervisor not found");
  return { actor, supervisor };
}

export async function updateSupervisorProfile(
  userId: string,
  supervisorId: string,
  input: UpdateSupervisorInput
) {
  await loadManaged(userId, supervisorId, true);
  return prisma.supervisor.update({ where: { id: supervisorId }, data: stripUndefined(input) });
}

// Company admin confirms a supervisor whose profile is complete.
export async function confirmSupervisor(userId: string, supervisorId: string) {
  const { actor, supervisor } = await loadManaged(userId, supervisorId, false);
  if (supervisor.activationStatus === "INVITED") {
    throw conflict("Supervisor has not completed their profile yet");
  }
  if (supervisor.activationStatus === "ACTIVE") return supervisor;
  return prisma.supervisor.update({
    where: { id: supervisorId },
    data: { activationStatus: "ACTIVE", confirmedBy: { connect: { id: actor.id } }, confirmedAt: new Date() },
  });
}

export async function suspendSupervisor(userId: string, supervisorId: string) {
  await loadManaged(userId, supervisorId, false);
  return prisma.supervisor.update({
    where: { id: supervisorId },
    data: { activationStatus: "SUSPENDED" },
  });
}

export async function deleteSupervisorProfile(userId: string, supervisorId: string) {
  await loadManaged(userId, supervisorId, false);
  const assigned = await prisma.student.count({ where: { supervisorId } });
  if (assigned > 0) throw conflict("Supervisor still has assigned students; reassign them first");
  const reviewed = await prisma.activity.count({ where: { reviewedById: supervisorId } });
  if (reviewed > 0) throw conflict("Supervisor has reviewed activities; suspend instead of deleting");

  await deleteStoredFilesForOwner("supervisor", supervisorId);
  await prisma.supervisor.delete({ where: { id: supervisorId } });
}
