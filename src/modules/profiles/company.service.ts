import { randomBytes } from "node:crypto";
import type { Company, Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { conflict, forbidden, notFound } from "../../lib/http-error.js";
import { isUniqueViolation, skipTake, type Page } from "../../lib/pagination.js";
import { stripUndefined } from "../../lib/object.js";
import { isAdmin, loadActor } from "../access/actor.js";
import { companyRelation, type CompanyRelation } from "../access/relations.js";
import { deleteStoredFilesForOwner } from "../../modules/document/document.service.js";
import type { CreateCompanyInput, UpdateCompanyInput } from "./company.schema.js";

const PRIVATE_FIELDS = [
  "email",
  "phone",
  "cacNumber",
  "registrationName",
  "registrationDocumentId",
  "ownerUserId",
  "verifiedById",
] as const;

// Students browsing placements see the public face of a company only.
function view(company: Company, relation: CompanyRelation): Partial<Company> {
  if (relation === "admin" || relation === "owner") return company;
  const copy: Partial<Company> = { ...company };
  for (const key of PRIVATE_FIELDS) delete copy[key];
  return copy;
}

const generateCompanyCode = () => `CMP-${randomBytes(4).toString("hex").toUpperCase()}`;

export async function createCompanyProfile(userId: string, input: CreateCompanyInput) {
  const actor = await loadActor(userId);
  if (actor.role !== "COMPANY_ADMIN") throw forbidden("Only company admin accounts can register a company");
  if (actor.ownedCompanyId) throw conflict("You already manage a company");
  try {
    return await prisma.company.create({
      data: {
        ...stripUndefined(input),
        companyCode: generateCompanyCode(),
        owner: { connect: { id: actor.id } },
      },
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("A company with this email already exists");
    throw err;
  }
}

export async function getMyCompany(userId: string) {
  const company = await prisma.company.findUnique({ where: { ownerUserId: userId } });
  if (!company) throw notFound("You have not registered a company yet");
  return company;
}

export async function getCompanyProfile(userId: string, companyId: string) {
  const actor = await loadActor(userId);
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) throw notFound("Company not found");
  const relation = companyRelation(actor, companyId);
  // Unverified companies are not browsable by outsiders.
  if (!relation && company.verificationStatus !== "VERIFIED") throw notFound("Company not found");
  return view(company, relation);
}

export async function listCompanies(
  userId: string,
  q: {
    page: number;
    pageSize: number;
    industry?: string | undefined;
    state?: string | undefined;
    verificationStatus?: Company["verificationStatus"] | undefined;
    search?: string | undefined;
  }
): Promise<Page<Partial<Company>>> {
  const actor = await loadActor(userId);
  const admin = isAdmin(actor);
  const where: Prisma.CompanyWhereInput = {
    ...stripUndefined({ industry: q.industry, state: q.state }),
    ...(q.search ? { name: { contains: q.search, mode: "insensitive" } } : {}),
    // Everyone but admins only sees verified companies (plus their own).
    ...(admin
      ? stripUndefined({ verificationStatus: q.verificationStatus })
      : {
          OR: [
            { verificationStatus: "VERIFIED" },
            ...(actor.ownedCompanyId ? [{ id: actor.ownedCompanyId }] : []),
          ],
        }),
  };
  const [rows, total] = await Promise.all([
    prisma.company.findMany({ where, orderBy: { name: "asc" }, ...skipTake(q.page, q.pageSize) }),
    prisma.company.count({ where }),
  ]);
  return {
    data: rows.map((c) => view(c, companyRelation(actor, c.id))),
    page: q.page,
    pageSize: q.pageSize,
    total,
  };
}

export async function updateCompanyProfile(userId: string, companyId: string, input: UpdateCompanyInput) {
  const actor = await loadActor(userId);
  const relation = companyRelation(actor, companyId);
  if (relation !== "admin" && relation !== "owner") {
    const exists = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true } });
    throw exists ? forbidden("You do not manage this company") : notFound("Company not found");
  }
  try {
    return await prisma.company.update({ where: { id: companyId }, data: stripUndefined(input) });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("A company with this email already exists");
    throw err;
  }
}

export async function deleteCompanyProfile(userId: string, companyId: string) {
  const actor = await loadActor(userId);
  if (!isAdmin(actor)) throw forbidden("Only a platform admin can delete a company");
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { id: true, supervisors: { select: { id: true } }, _count: { select: { placements: true } } },
  });
  if (!company) throw notFound("Company not found");
  if (company._count.placements > 0) throw conflict("Company still has placements");

  await deleteStoredFilesForOwner("company", companyId);
  for (const s of company.supervisors) await deleteStoredFilesForOwner("supervisor", s.id);
  await prisma.company.delete({ where: { id: companyId } });
}
