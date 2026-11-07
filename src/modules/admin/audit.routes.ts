import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { skipTake } from "../../lib/pagination.js";
import { stripUndefined } from "../../lib/object.js";
import { requireAuth, requireRole } from "../../middlewares/auth.js";
import { paging } from "../profiles/common.schema.js";

const auditQuery = paging.extend({
  action: z.string().trim().max(64).optional(),
  entityType: z.string().trim().max(64).optional(),
  entityId: z.string().trim().max(64).optional(),
  actorId: z.string().trim().max(64).optional(),
});

export const auditRouter = Router();
auditRouter.use(requireAuth, requireRole("PLATFORM_ADMIN"));

// Read side of the audit trail, so an admin can answer "who verified this
// payment" or "who approved this placement" without touching the database.
auditRouter.get("/", async (req, res) => {
  const q = auditQuery.parse(req.query);
  const where = stripUndefined({
    action: q.action,
    entityType: q.entityType,
    entityId: q.entityId,
    actorId: q.actorId,
  });

  const [data, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: { actor: { select: { id: true, email: true, role: true } } },
      ...skipTake(q.page, q.pageSize),
    }),
    prisma.auditLog.count({ where }),
  ]);

  res.json({ data, page: q.page, pageSize: q.pageSize, total });
});
