// Dev seed: one coherent slice of the platform so every role can log in and
// every endpoint has something real to return.
//
//   npx tsx scripts/seed-dev.ts
//
// Destructive by design; only ever run against the local dev database.
import "dotenv/config";
import bcrypt from "bcrypt";
import { prisma } from "../src/lib/prisma.js";

const PASSWORD = "SiwesFlow2026!";

async function wipe() {
  // Dependency order; FKs cascade where they can.
  await prisma.payment.deleteMany();
  await prisma.subscription.deleteMany();
  await prisma.plan.deleteMany();
  await prisma.activity.deleteMany();
  await prisma.verificationEvent.deleteMany();
  await prisma.verification.deleteMany();
  await prisma.document.deleteMany();
  await prisma.application.deleteMany();
  await prisma.placement.deleteMany();
  await prisma.student.deleteMany();
  await prisma.supervisor.deleteMany();
  await prisma.school.deleteMany();
  await prisma.company.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.emailVerificationToken.deleteMany();
  await prisma.user.deleteMany();
}

async function main() {
  await wipe();

  const passwordHash = await bcrypt.hash(PASSWORD, 12);
  const user = (email: string, role: "STUDENT" | "SUPERVISOR" | "SCHOOL_COORDINATOR" | "COMPANY_ADMIN" | "PLATFORM_ADMIN") =>
    prisma.user.create({
      data: { email, passwordHash, role, isEmailVerified: true },
    });

  const adminUser = await user("admin@siwesflow.dev", "PLATFORM_ADMIN");
  const coordinatorUser = await user("coordinator@siwesflow.dev", "SCHOOL_COORDINATOR");
  const companyUser = await user("company@siwesflow.dev", "COMPANY_ADMIN");
  const supervisorUser = await user("supervisor@siwesflow.dev", "SUPERVISOR");
  const studentUser = await user("student@siwesflow.dev", "STUDENT");
  const student2User = await user("student2@siwesflow.dev", "STUDENT");

  const school = await prisma.school.create({
    data: {
      schoolCode: "UNILAG",
      name: "University of Lagos",
      institutionType: "UNIVERSITY",
      address: "Akoka, Yaba",
      state: "Lagos",
      country: "Nigeria",
      email: "siwes@unilag.edu.ng",
      phone: "+2348012345678",
      coordinatorId: coordinatorUser.id,
      coordinatorEmail: "coordinator@siwesflow.dev",
      coordinatorPhone: "+2348012345678",
      faculties: ["Science", "Engineering"],
      departments: ["Computer Science", "Electrical Engineering"],
      programmes: ["BSc", "BEng"],
      levels: ["300", "400"],
      verificationStatus: "VERIFIED",
      verifiedById: adminUser.id,
      verifiedAt: new Date(),
    },
  });

  const company = await prisma.company.create({
    data: {
      companyCode: "PAYSTACK",
      name: "Paystack",
      registrationName: "Paystack Payments Limited",
      industry: "Financial Technology",
      description: "Payments infrastructure for African businesses.",
      address: "1 Ozumba Mbadiwe Avenue",
      state: "Lagos",
      country: "Nigeria",
      website: "https://paystack.com",
      email: "siwes@paystack.dev",
      phone: "+2348098765432",
      ownerUserId: companyUser.id,
      verificationStatus: "VERIFIED",
      verifiedById: adminUser.id,
      verifiedAt: new Date(),
    },
  });

  const supervisor = await prisma.supervisor.create({
    data: {
      userId: supervisorUser.id,
      companyId: company.id,
      fullName: "Tunde Bakare",
      position: "Engineering Manager",
      department: "Platform",
      email: "supervisor@siwesflow.dev",
      phone: "+2348077777777",
      activationStatus: "ACTIVE",
      verificationStatus: "VERIFIED",
      verifiedById: adminUser.id,
      verifiedAt: new Date(),
    },
  });

  const student = await prisma.student.create({
    data: {
      userId: studentUser.id,
      studentCode: "STU-2026-001",
      firstName: "Ada",
      lastName: "Okafor",
      dateOfBirth: new Date("2003-04-12"),
      gender: "FEMALE",
      email: "student@siwesflow.dev",
      phoneNumber: "+2348066666666",
      address: "Yaba, Lagos",
      schoolId: school.id,
      faculty: "Science",
      department: "Computer Science",
      programme: "BSc",
      level: "300",
      matriculationNumber: "190404021",
      academicSession: "2025/2026",
      siwesSession: "2026",
      siwesStartDate: new Date("2026-06-01"),
      siwesEndDate: new Date("2026-11-30"),
      coordinatorId: coordinatorUser.id,
      supervisorId: supervisor.id,
      verificationStatus: "VERIFIED",
      verifiedById: adminUser.id,
      verifiedAt: new Date(),
    },
  });

  const student2 = await prisma.student.create({
    data: {
      userId: student2User.id,
      studentCode: "STU-2026-002",
      firstName: "Emeka",
      lastName: "Nwosu",
      dateOfBirth: new Date("2002-09-03"),
      gender: "MALE",
      email: "student2@siwesflow.dev",
      phoneNumber: "+2348055555555",
      schoolId: school.id,
      faculty: "Engineering",
      department: "Electrical Engineering",
      programme: "BEng",
      level: "400",
      matriculationNumber: "180404055",
      academicSession: "2025/2026",
      siwesSession: "2026",
      siwesStartDate: new Date("2026-06-01"),
      siwesEndDate: new Date("2026-11-30"),
      coordinatorId: coordinatorUser.id,
      supervisorId: supervisor.id,
      verificationStatus: "VERIFIED",
      verifiedById: adminUser.id,
      verifiedAt: new Date(),
    },
  });

  const plan = await prisma.plan.create({
    data: {
      code: "STARTER_90",
      name: "Starter (90 days)",
      amountKobo: 5_000_000,
      durationDays: 90,
      maxActivePlacements: 3,
      maxSlots: 10,
    },
  });
  await prisma.plan.create({
    data: {
      code: "GROWTH_365",
      name: "Growth (1 year)",
      amountKobo: 15_000_000,
      durationDays: 365,
      maxActivePlacements: 20,
      maxSlots: 100,
    },
  });

  console.log(`
Seeded SIWESFlow dev data. Password for every account: ${PASSWORD}

  PLATFORM_ADMIN     admin@siwesflow.dev
  SCHOOL_COORDINATOR coordinator@siwesflow.dev
  COMPANY_ADMIN      company@siwesflow.dev
  SUPERVISOR         supervisor@siwesflow.dev
  STUDENT            student@siwesflow.dev   (${student.studentCode})
  STUDENT            student2@siwesflow.dev  (${student2.studentCode})

  school    ${school.name} (${school.id})
  company   ${company.name} (${company.id})
  plan      ${plan.code} (${plan.id})
`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
