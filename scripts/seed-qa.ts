// Additive QA cohort seed and teardown for live staging/Supabase E2E tests.
// Every record is prefixed with "qa-" or "QA_" so teardown removes ONLY QA data.
//
//   npx tsx scripts/seed-qa.ts
//   npx tsx scripts/seed-qa.ts --teardown
import "dotenv/config";
import bcrypt from "bcrypt";
import { prisma } from "../src/lib/prisma.js";

const QA_PASSWORD = "QaTest2026!";

const QA_USER_IDS = [
  "qa-user-admin",
  "qa-user-coord",
  "qa-user-company",
  "qa-user-sup",
  "qa-user-stu-active",
  "qa-user-stu-complete",
  "qa-user-stu-atrisk",
  "qa-user-stu-unplaced",
];

const QA_STUDENT_IDS = [
  "qa-stu-active",
  "qa-stu-complete",
  "qa-stu-atrisk",
  "qa-stu-unplaced",
];

async function teardown() {
  // Delete in dependency order, strictly scoped to qa-* IDs.
  await prisma.siwesCompletion.deleteMany({ where: { studentId: { in: QA_STUDENT_IDS } } });
  await prisma.activityEvent.deleteMany({ where: { activity: { studentId: { in: QA_STUDENT_IDS } } } });
  await prisma.activity.deleteMany({ where: { studentId: { in: QA_STUDENT_IDS } } });
  await prisma.verificationEvent.deleteMany({ where: { verification: { id: { startsWith: "qa-" } } } });
  await prisma.verification.deleteMany({ where: { id: { startsWith: "qa-" } } });
  await prisma.document.deleteMany({ where: { id: { startsWith: "qa-" } } });
  await prisma.application.deleteMany({ where: { studentId: { in: QA_STUDENT_IDS } } });
  await prisma.student.deleteMany({ where: { id: { in: QA_STUDENT_IDS } } });
  await prisma.placement.deleteMany({ where: { id: { startsWith: "qa-" } } });
  await prisma.supervisor.deleteMany({ where: { id: { startsWith: "qa-" } } });
  await prisma.subscription.deleteMany({ where: { id: { startsWith: "qa-" } } });
  await prisma.payment.deleteMany({ where: { id: { startsWith: "qa-" } } });
  await prisma.plan.deleteMany({ where: { id: { startsWith: "qa-" } } });
  await prisma.company.deleteMany({ where: { id: { startsWith: "qa-" } } });
  await prisma.school.deleteMany({ where: { id: { startsWith: "qa-" } } });
  await prisma.refreshToken.deleteMany({ where: { userId: { in: QA_USER_IDS } } });
  await prisma.emailVerificationToken.deleteMany({ where: { userId: { in: QA_USER_IDS } } });
  await prisma.user.deleteMany({ where: { id: { in: QA_USER_IDS } } });
  console.log("QA cohort teardown complete.");
}

async function seed() {
  await teardown();

  const passwordHash = await bcrypt.hash(QA_PASSWORD, 12);
  const now = new Date();
  const dayMs = 24 * 60 * 60 * 1000;

  const mkUser = (id: string, email: string, role: "STUDENT" | "SUPERVISOR" | "SCHOOL_COORDINATOR" | "COMPANY_ADMIN" | "PLATFORM_ADMIN") =>
    prisma.user.create({
      data: { id, email, passwordHash, role, isEmailVerified: true },
    });

  const adminUser = await mkUser("qa-user-admin", "qa-admin@siwesflow.test", "PLATFORM_ADMIN");
  const coordUser = await mkUser("qa-user-coord", "qa-coord@siwesflow.test", "SCHOOL_COORDINATOR");
  const companyUser = await mkUser("qa-user-company", "qa-company@siwesflow.test", "COMPANY_ADMIN");
  const supUser = await mkUser("qa-user-sup", "qa-supervisor@siwesflow.test", "SUPERVISOR");
  const stuActiveUser = await mkUser("qa-user-stu-active", "qa-student-active@siwesflow.test", "STUDENT");
  const stuCompleteUser = await mkUser("qa-user-stu-complete", "qa-student-complete@siwesflow.test", "STUDENT");
  const stuAtRiskUser = await mkUser("qa-user-stu-atrisk", "qa-student-atrisk@siwesflow.test", "STUDENT");
  const stuUnplacedUser = await mkUser("qa-user-stu-unplaced", "qa-student-unplaced@siwesflow.test", "STUDENT");

  const school = await prisma.school.create({
    data: {
      id: "qa-school-01",
      schoolCode: "QA-UNILAG",
      name: "QA_University of Lagos",
      institutionType: "UNIVERSITY",
      address: "Akoka, Yaba",
      state: "Lagos",
      country: "Nigeria",
      email: "qa-school@siwesflow.test",
      phone: "+2348010000001",
      coordinatorId: coordUser.id,
      coordinatorEmail: coordUser.email,
      coordinatorPhone: "+2348010000001",
      faculties: ["Science", "Engineering"],
      departments: ["Computer Science", "Systems Engineering"],
      programmes: ["BSc", "BEng"],
      levels: ["300", "400"],
      verificationStatus: "VERIFIED",
      verifiedById: adminUser.id,
      verifiedAt: now,
    },
  });

  const company = await prisma.company.create({
    data: {
      id: "qa-company-01",
      companyCode: "QA-TECH",
      name: "QA_TechSolutions Ltd",
      registrationName: "QA TechSolutions Nigeria Limited",
      industry: "Information Technology",
      description: "QA test host company for SIWESFlow end-to-end verification.",
      address: "12 Marina, Lagos",
      state: "Lagos",
      country: "Nigeria",
      website: "https://qa.siwesflow.test",
      email: "qa-company@siwesflow.test",
      phone: "+2348020000002",
      ownerUserId: companyUser.id,
      verificationStatus: "VERIFIED",
      verifiedById: adminUser.id,
      verifiedAt: now,
    },
  });

  const plan = await prisma.plan.create({
    data: {
      id: "qa-plan-01",
      code: "QA_STARTER",
      name: "QA Starter Plan",
      amountKobo: 5_000_000,
      durationDays: 90,
      maxActivePlacements: 5,
      maxSlots: 20,
    },
  });

  await prisma.subscription.create({
    data: {
      id: "qa-sub-01",
      companyId: company.id,
      planId: plan.id,
      status: "ACTIVE",
      startDate: new Date(now.getTime() - 10 * dayMs),
      expiryDate: new Date(now.getTime() + 80 * dayMs),
    },
  });

  const supervisor = await prisma.supervisor.create({
    data: {
      id: "qa-sup-01",
      userId: supUser.id,
      companyId: company.id,
      fullName: "QA_Tunde Bakare",
      position: "Engineering Manager",
      department: "Engineering",
      email: supUser.email,
      phone: "+2348030000003",
      activationStatus: "ACTIVE",
      verificationStatus: "VERIFIED",
      verifiedById: adminUser.id,
      verifiedAt: now,
    },
  });

  const placement = await prisma.placement.create({
    data: {
      id: "qa-plc-01",
      companyId: company.id,
      title: "QA_Software Engineering Intern",
      description: "Full-stack and API engineering internship for QA testing.",
      department: "Engineering",
      requiredLevel: "300",
      requiredSkills: ["TypeScript", "React", "PostgreSQL"],
      availableSlots: 5,
      filledSlots: 3,
      startDate: new Date("2026-06-01"),
      endDate: new Date("2026-11-30"),
      location: "Lagos, Nigeria",
      workMode: "HYBRID",
      isActive: true,
      approvalStatus: "APPROVED",
      approvedById: coordUser.id,
      approvedAt: now,
    },
  });

  // 1. Active placed student
  const stuActive = await prisma.student.create({
    data: {
      id: "qa-stu-active",
      userId: stuActiveUser.id,
      studentCode: "QA-STU-001",
      firstName: "QA_Ada",
      lastName: "Okafor",
      dateOfBirth: new Date("2003-04-12"),
      gender: "FEMALE",
      email: stuActiveUser.email,
      phoneNumber: "+2348040000001",
      address: "Yaba, Lagos",
      schoolId: school.id,
      faculty: "Science",
      department: "Computer Science",
      programme: "BSc Computer Science",
      level: "300",
      matriculationNumber: "QA-190404001",
      academicSession: "2025/2026",
      siwesSession: "2026",
      siwesStartDate: new Date("2026-06-01"),
      siwesEndDate: new Date("2026-11-30"),
      placementStatus: "PLACED",
      placementId: placement.id,
      coordinatorId: coordUser.id,
      supervisorId: supervisor.id,
      verificationStatus: "VERIFIED",
      verifiedById: coordUser.id,
      verifiedAt: now,
      engagementStatus: "ACTIVE",
      lastActivitySubmittedAt: new Date(now.getTime() - 1 * dayMs),
    },
  });

  // 2. Completion-ready placed student (>= 480 approved hours, >= 12 weeks, 0 pending)
  const stuComplete = await prisma.student.create({
    data: {
      id: "qa-stu-complete",
      userId: stuCompleteUser.id,
      studentCode: "QA-STU-002",
      firstName: "QA_Chinedu",
      lastName: "Okonkwo",
      dateOfBirth: new Date("2002-05-14"),
      gender: "MALE",
      email: stuCompleteUser.email,
      phoneNumber: "+2348040000002",
      address: "Akoka, Lagos",
      schoolId: school.id,
      faculty: "Engineering",
      department: "Systems Engineering",
      programme: "BEng Systems Engineering",
      level: "400",
      matriculationNumber: "QA-190408002",
      academicSession: "2025/2026",
      siwesSession: "2026",
      siwesStartDate: new Date("2026-06-01"),
      siwesEndDate: new Date("2026-11-30"),
      placementStatus: "PLACED",
      placementId: placement.id,
      coordinatorId: coordUser.id,
      supervisorId: supervisor.id,
      verificationStatus: "VERIFIED",
      verifiedById: coordUser.id,
      verifiedAt: now,
      engagementStatus: "ACTIVE",
      lastActivitySubmittedAt: new Date(now.getTime() - 2 * dayMs),
    },
  });

  // 3. At-Risk placed student with SUBMITTED verification in queue
  const stuAtRisk = await prisma.student.create({
    data: {
      id: "qa-stu-atrisk",
      userId: stuAtRiskUser.id,
      studentCode: "QA-STU-003",
      firstName: "QA_Emeka",
      lastName: "Nwosu",
      dateOfBirth: new Date("2003-08-20"),
      gender: "MALE",
      email: stuAtRiskUser.email,
      phoneNumber: "+2348040000003",
      address: "Surulere, Lagos",
      schoolId: school.id,
      faculty: "Science",
      department: "Computer Science",
      programme: "BSc Computer Science",
      level: "300",
      matriculationNumber: "QA-190404003",
      academicSession: "2025/2026",
      siwesSession: "2026",
      siwesStartDate: new Date("2026-06-01"),
      siwesEndDate: new Date("2026-11-30"),
      placementStatus: "PLACED",
      placementId: placement.id,
      coordinatorId: coordUser.id,
      supervisorId: supervisor.id,
      verificationStatus: "SUBMITTED",
      engagementStatus: "AT_RISK",
      lastActivitySubmittedAt: new Date(now.getTime() - 10 * dayMs),
    },
  });

  // 4. Unplaced student
  await prisma.student.create({
    data: {
      id: "qa-stu-unplaced",
      userId: stuUnplacedUser.id,
      studentCode: "QA-STU-004",
      firstName: "QA_Zainab",
      lastName: "Bello",
      dateOfBirth: new Date("2004-01-15"),
      gender: "FEMALE",
      email: stuUnplacedUser.email,
      phoneNumber: "+2348040000004",
      address: "Ikeja, Lagos",
      schoolId: school.id,
      faculty: "Engineering",
      department: "Systems Engineering",
      programme: "BEng Systems Engineering",
      level: "300",
      matriculationNumber: "QA-190408004",
      academicSession: "2025/2026",
      siwesSession: "2026",
      siwesStartDate: new Date("2026-06-01"),
      siwesEndDate: new Date("2026-11-30"),
      placementStatus: "UNPLACED",
      coordinatorId: coordUser.id,
      verificationStatus: "UNVERIFIED",
      engagementStatus: "INACTIVE",
    },
  });

  // Pending Verification + Document for stuAtRisk
  const verif = await prisma.verification.create({
    data: {
      id: "qa-verif-01",
      entityType: "STUDENT",
      entityId: stuAtRisk.id,
      status: "SUBMITTED",
      notes: "QA student ID card verification submission",
    },
  });
  await prisma.document.create({
    data: {
      id: "qa-doc-01",
      studentId: stuAtRisk.id,
      uploadedById: stuAtRiskUser.id,
      documentType: "STUDENT_ID_CARD",
      filename: "qa-student-id.pdf",
      fileFormat: "PDF",
      fileSizeBytes: 120400,
      storageKey: "qa/qa-student-id.pdf",
      verificationStatus: "SUBMITTED",
      verificationId: verif.id,
    },
  });

  // Activities for stuActive (1 approved, 1 pending, 1 needs revision)
  await prisma.activity.createMany({
    data: [
      {
        id: "qa-act-01",
        studentId: stuActive.id,
        date: new Date(now.getTime() - 5 * dayMs),
        title: "QA_Built API integration tests",
        description: "Implemented integration tests for verification endpoints.",
        whatILearned: "Prisma transactions and Zod validation.",
        skillsUsed: ["TypeScript", "Prisma"],
        hoursWorked: 8,
        category: "Backend Development",
        status: "APPROVED",
        comment: "Clean test coverage.",
        rating: 5,
        reviewedById: supervisor.id,
        reviewedAt: new Date(now.getTime() - 4 * dayMs),
      },
      {
        id: "qa-act-02",
        studentId: stuActive.id,
        date: new Date(now.getTime() - 2 * dayMs),
        title: "QA_Refactored dashboard components",
        description: "Updated responsive cards for mobile viewport.",
        whatILearned: "Tailwind responsive breakpoints.",
        skillsUsed: ["React", "Tailwind CSS"],
        hoursWorked: 6,
        category: "Frontend Development",
        status: "PENDING",
      },
      {
        id: "qa-act-03",
        studentId: stuActive.id,
        date: new Date(now.getTime() - 3 * dayMs),
        title: "QA_Drafted schema migration",
        description: "Initial draft for document metadata.",
        whatILearned: "PostgreSQL indexes.",
        skillsUsed: ["PostgreSQL"],
        hoursWorked: 4,
        category: "Database",
        status: "NEEDS_REVISION",
        comment: "Please expand on the index strategy.",
        reviewedById: supervisor.id,
        reviewedAt: new Date(now.getTime() - 2 * dayMs),
      },
    ],
  });

  // 13 weeks x 40 hours (520 approved hours) for stuComplete
  const completionActs = [];
  for (let w = 0; w < 13; w++) {
    const d = new Date("2026-06-08");
    d.setUTCDate(d.getUTCDate() + w * 7);
    completionActs.push({
      id: `qa-comp-act-${w + 1}-a`,
      studentId: stuComplete.id,
      date: d,
      title: `QA_Week ${w + 1} Engineering Sprint Part 1`,
      description: `Completed core engineering tasks for week ${w + 1}.`,
      whatILearned: "Production software engineering.",
      skillsUsed: ["TypeScript", "Node.js"],
      hoursWorked: 20,
      category: "Engineering",
      status: "APPROVED" as const,
      comment: "Approved.",
      rating: 5,
      reviewedById: supervisor.id,
      reviewedAt: now,
    });
    const d2 = new Date(d);
    d2.setUTCDate(d2.getUTCDate() + 2);
    completionActs.push({
      id: `qa-comp-act-${w + 1}-b`,
      studentId: stuComplete.id,
      date: d2,
      title: `QA_Week ${w + 1} Engineering Sprint Part 2`,
      description: `Completed testing and review tasks for week ${w + 1}.`,
      whatILearned: "Integration testing.",
      skillsUsed: ["PostgreSQL", "React"],
      hoursWorked: 20,
      category: "Engineering",
      status: "APPROVED" as const,
      comment: "Approved.",
      rating: 5,
      reviewedById: supervisor.id,
      reviewedAt: now,
    });
  }
  await prisma.activity.createMany({ data: completionActs });

  console.log("Seeded tagged QA_ cohort successfully (Password: QaTest2026!):");
  console.log("  SCHOOL_COORDINATOR : qa-coord@siwesflow.test");
  console.log("  SUPERVISOR         : qa-supervisor@siwesflow.test");
  console.log("  STUDENT (Active)   : qa-student-active@siwesflow.test");
  console.log("  STUDENT (Complete) : qa-student-complete@siwesflow.test");
  console.log("  STUDENT (At-Risk)  : qa-student-atrisk@siwesflow.test");
  console.log("  STUDENT (Unplaced) : qa-student-unplaced@siwesflow.test");
}

async function main() {
  if (process.argv.includes("--teardown")) {
    await teardown();
  } else {
    await seed();
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
