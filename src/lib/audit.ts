import type { Prisma } from "../generated/prisma/client.js";

// One helper so every module writes the same shape and omits undefined fields
// cleanly under `exactOptionalPropertyTypes`.
export interface AuditEntry {
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata?: Prisma.InputJsonValue;
}

export function auditData(entry: AuditEntry) {
  return {
    actorId: entry.actorId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    ...(entry.metadata === undefined ? {} : { metadata: entry.metadata }),
  };
}
