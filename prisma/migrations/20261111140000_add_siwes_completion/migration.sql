-- CreateEnum
CREATE TYPE "CompletionStatus" AS ENUM ('PENDING_SUPERVISOR', 'PENDING_SCHOOL', 'VERIFIED', 'DECLINED');

-- CreateTable
CREATE TABLE "SiwesCompletion" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "status" "CompletionStatus" NOT NULL DEFAULT 'PENDING_SUPERVISOR',
    "totalHours" DOUBLE PRECISION NOT NULL,
    "approvedEntries" INTEGER NOT NULL,
    "weeksLogged" INTEGER NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supervisorId" TEXT,
    "supervisorSignedOffAt" TIMESTAMP(3),
    "supervisorRemarks" TEXT,
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "declineReason" TEXT,
    "certificateReference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiwesCompletion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SiwesCompletion_studentId_key" ON "SiwesCompletion"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "SiwesCompletion_certificateReference_key" ON "SiwesCompletion"("certificateReference");

-- CreateIndex
CREATE INDEX "SiwesCompletion_status_idx" ON "SiwesCompletion"("status");

-- AddForeignKey
ALTER TABLE "SiwesCompletion" ADD CONSTRAINT "SiwesCompletion_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiwesCompletion" ADD CONSTRAINT "SiwesCompletion_supervisorId_fkey" FOREIGN KEY ("supervisorId") REFERENCES "Supervisor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiwesCompletion" ADD CONSTRAINT "SiwesCompletion_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Same Row Level Security as every other public table (20261110200000).
-- The policy is guarded because service_role exists only on Supabase.
ALTER TABLE "SiwesCompletion" ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE POLICY "service_role_all_siwes_completion" ON "SiwesCompletion"
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;
