const { now, hashPw, getOrg } = require("./_shared");

// Participant users (linked to guardians)
module.exports = async function seedParticipants(prisma) {
  const t = now();
  const pw = await hashPw();
  const org = await getOrg(prisma);
  if (!org) throw new Error("Run organization seeder first");

  const g1 = await prisma.user.findUnique({ where: { email: "guardian@gmail.com" } });
  const g2 = await prisma.user.findUnique({ where: { email: "guardian2@gmail.com" } });
  if (!g1 || !g2) throw new Error("Run guardians seeder first");

  const participants = [
    {
      fullName: "Tom Participant", email: "participant@gmail.com", phone: "9888888881", guardianUserId: g1.id,
      gender: "Male", dateOfBirth: BigInt(new Date("2005-03-15").getTime()), medicalNotes: "Requires wheelchair assistance",
      allergyNotes: "Nut allergy", mobilitySupport: true, emergencyContactPhone: g1.phone, emergencyInstructions: "Contact David immediately",
    },
    {
      fullName: "Emma Participant", email: "participant2@gmail.com", phone: "9888888882", guardianUserId: g2.id,
      gender: "Female", dateOfBirth: BigInt(new Date("2010-07-22").getTime()), medicalNotes: "Autism spectrum, needs structured routine",
      allergyNotes: "None", mobilitySupport: false, emergencyContactPhone: g2.phone, emergencyInstructions: "Contact Sarah immediately",
    },
  ];
  for (const p of participants) {
    await prisma.user.upsert({
      where: { email: p.email },
      update: {},
      create: {
        ...p,
        password: pw,
        role: "PARTICIPANT",
        organizationId: org.id,
        participantStatus: "ACTIVE",
        status: true,
        emailVerifiedAt: t,
        createdAt: t,
        updatedAt: t,
      },
    });
  }
  console.log("✅ Participants   → Tom (David), Emma (Sarah)");
};

if (require.main === module) {
  require("dotenv").config();
  const prisma = require("../../src/config/db");
  module.exports(prisma).finally(() => prisma.$disconnect());
}
