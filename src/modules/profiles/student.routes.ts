import { Router } from "express";
import { currentUser, requireAuth, requireRole } from "../../middlewares/auth.js";
import { prisma } from "../../lib/prisma.js";
import { idParam } from "./common.schema.js";
import {
  createStudentSchema,
  listStudentsQuery,
  updateStudentSchema,
} from "./student.schema.js";
import {
  createStudentProfile,
  deleteStudentProfile,
  getMyStudentProfile,
  getStudentProfile,
  listStudents,
  updateStudentProfile,
} from "./student.service.js";

export const studentRouter = Router();
studentRouter.use(requireAuth);

studentRouter.post("/", requireRole("STUDENT"), async (req, res) => {
  const body = createStudentSchema.parse(req.body);
  res.status(201).json(await createStudentProfile(currentUser(req).id, body));
});

studentRouter.get("/me", requireRole("STUDENT"), async (req, res) => {
  res.json(await getMyStudentProfile(currentUser(req).id));
});

// Dedicated onboarding profile handler (accepts frontend PUT /profile or PUT /api/student/profile)
studentRouter.put("/profile", requireRole("STUDENT"), async (req, res) => {
  const existing = await prisma.student.findUnique({ where: { userId: currentUser(req).id } });
  if (existing) {
    const body = updateStudentSchema.parse(req.body);
    res.json(await updateStudentProfile(currentUser(req).id, existing.id, body));
  } else {
    const raw = req.body;
    const nameParts = (raw.fullName || "").trim().split(/\s+/);
    const firstName = raw.firstName || nameParts[0] || "Student";
    const lastName = raw.lastName || nameParts.slice(1).join(" ") || "User";
    const matriculationNumber = raw.matriculationNumber || raw.matricNumber || `MAT-${Date.now()}`;
    const levelStr = raw.level ? String(raw.level).trim() : "300";
    const validLevel = /^[1-9]00$/.test(levelStr) ? levelStr : "300";

    let schoolId = raw.schoolId;
    if (!schoolId) {
      const defaultSchool = await prisma.school.findFirst();
      if (defaultSchool) {
        schoolId = defaultSchool.id;
      } else {
        const createdSchool = await prisma.school.create({
          data: {
            schoolCode: `SCH-${Date.now()}`,
            name: "Default University",
            institutionType: "UNIVERSITY",
            state: "Lagos",
            country: "Nigeria",
            address: "University Road",
            email: `school-${Date.now()}@siwesflow.dev`,
            phone: "+2348011223344",
          },
        });
        schoolId = createdSchool.id;
      }
    }

    const payload = {
      firstName,
      lastName,
      matriculationNumber,
      schoolId,
      dateOfBirth: raw.dateOfBirth ? new Date(raw.dateOfBirth) : new Date("2002-01-01"),
      gender: (raw.gender === "FEMALE" || raw.gender === "OTHER") ? raw.gender : "MALE",
      phoneNumber: raw.phoneNumber && raw.phoneNumber.length >= 7 ? raw.phoneNumber : "+2348000000000",
      faculty: raw.faculty || "Engineering & Technology",
      department: raw.department || "Computer Science",
      programme: raw.programme || "B.Sc Computer Science",
      level: validLevel,
      academicSession: raw.academicSession || "2025/2026",
      siwesSession: raw.siwesSession || "2026",
      siwesStartDate: raw.siwesStartDate ? new Date(raw.siwesStartDate) : undefined,
      siwesEndDate: raw.siwesEndDate ? new Date(raw.siwesEndDate) : undefined,
    };

    const parsed = createStudentSchema.parse(payload);
    res.status(201).json(await createStudentProfile(currentUser(req).id, parsed));
  }
});

studentRouter.get("/", async (req, res) => {
  res.json(await listStudents(currentUser(req).id, listStudentsQuery.parse(req.query)));
});

studentRouter.get("/:id", async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json(await getStudentProfile(currentUser(req).id, id));
});

studentRouter.patch("/:id", async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json(await updateStudentProfile(currentUser(req).id, id, updateStudentSchema.parse(req.body)));
});

studentRouter.delete("/:id", requireRole("PLATFORM_ADMIN"), async (req, res) => {
  const { id } = idParam.parse(req.params);
  await deleteStudentProfile(currentUser(req).id, id);
  res.status(204).send();
});
