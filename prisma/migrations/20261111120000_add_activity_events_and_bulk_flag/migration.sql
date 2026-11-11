-- AlterTable
ALTER TABLE "Activity" ADD COLUMN     "bulkFlaggedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ActivityEvent" (
    "id" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "fromStatus" "ActivityStatus",
    "toStatus" "ActivityStatus" NOT NULL,
    "changedFields" TEXT[],
    "note" TEXT,
    "rating" INTEGER,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ActivityEvent_activityId_idx" ON "ActivityEvent"("activityId");

-- AddForeignKey
ALTER TABLE "ActivityEvent" ADD CONSTRAINT "ActivityEvent_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityEvent" ADD CONSTRAINT "ActivityEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Same Row Level Security as every other public table (20261110200000).
-- The policy is guarded because service_role exists only on Supabase, and a
-- plain local Postgres would otherwise fail the whole migration.
ALTER TABLE "ActivityEvent" ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE POLICY "service_role_all_activity_event" ON "ActivityEvent"
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;
