-- Enable Row Level Security on all public tables
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Student" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Supervisor" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "School" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Company" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Placement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Application" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Activity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Verification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VerificationEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Document" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EmailVerificationToken" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RefreshToken" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Payment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Plan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Subscription" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "_SchoolApprovedCompanies" ENABLE ROW LEVEL SECURITY;

-- Service role full access policies
CREATE POLICY "service_role_all_user" ON "User" FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_student" ON "Student" FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_supervisor" ON "Supervisor" FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_school" ON "School" FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_company" ON "Company" FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_placement" ON "Placement" FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_application" ON "Application" FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_activity" ON "Activity" FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_verification" ON "Verification" FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_verification_event" ON "VerificationEvent" FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_document" ON "Document" FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_email_token" ON "EmailVerificationToken" FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_refresh_token" ON "RefreshToken" FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_payment" ON "Payment" FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_plan" ON "Plan" FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_subscription" ON "Subscription" FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_school_companies" ON "_SchoolApprovedCompanies" FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Reference data read policies
CREATE POLICY "public_read_plans" ON "Plan" FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "public_read_schools" ON "School" FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "public_read_companies" ON "Company" FOR SELECT TO anon, authenticated USING (true);
