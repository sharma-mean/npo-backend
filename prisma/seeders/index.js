require("dotenv").config();
const prisma = require("../../src/config/db");

// Ordered modular seeders. Each is also runnable standalone:
//   node prisma/seeders/<name>.seed.js
const steps = [
  ["Plans", require("./plans.seed")],
  ["Super Admin", require("./superAdmin.seed")],
  ["Organization", require("./organization.seed")],
  ["Staff Roles", require("./staffRoles.seed")],
  ["Staff", require("./staff.seed")],
  ["Guardians", require("./guardians.seed")],
  ["Participants", require("./participants.seed")],
  ["Vehicles", require("./vehicles.seed")],
  ["Venues", require("./venues.seed")],
  ["Services", require("./services.seed")],
  ["Operations", require("./operations.seed")],
];

async function main() {
  console.log("🌱 Seeding NPO data (modular)...\n");
  for (const [name, fn] of steps) {
    try {
      await fn(prisma);
    } catch (e) {
      console.error(`❌ ${name} failed:`, e.message);
      throw e;
    }
  }
  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  SEED COMPLETE — all passwords: 123456
  superadmin@gmail.com · admin@gmail.com · coordinator@gmail.com
  driver/staff/nurse@gmail.com · guardian(2)@gmail.com · participant(2)@gmail.com
  Org: Sunrise Care NPO (SUNRISE001)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
