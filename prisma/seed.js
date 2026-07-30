const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

async function main() {
  const now = BigInt(Date.now());

  // 1. Subscription Plan
  const plan = await prisma.subscriptionPlan.create({
    data: {
      name: "Basic Plan",
      durationDays: 365,
      price: 0,
      maxUsers: 100,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  });
  console.log("Plan created:", plan.id);

  // 2. Organization
  const org = await prisma.organization.create({
    data: {
      name: "Demo NPO",
      code: "DEMO001",
      email: "org@demo.com",
      phone: "1234567890",
      address: "123 Main St",
      city: "Delhi",
      state: "Delhi",
      country: "India",
      postalCode: "110001",
      status: "ACTIVE",
      createdAt: now,
      updatedAt: now,
    },
  });
  console.log("Organization created:", org.id);

  // 3. Subscription
  await prisma.organizationSubscription.create({
    data: {
      organizationId: org.id,
      planId: plan.id,
      startAt: now,
      endAt: now + BigInt(365 * 24 * 60 * 60 * 1000),
      status: "ACTIVE",
      createdAt: now,
      updatedAt: now,
    },
  });

  // 4. NPO Admin user
  const hashedPassword = await bcrypt.hash("12345", 10);
  const admin = await prisma.user.create({
    data: {
      fullName: "NPO Admin",
      email: "admin@gmail.com",
      password: hashedPassword,
      role: "NPO_ADMIN",
      phone: "9999999999",
      organizationId: org.id,
      status: true,
      createdAt: now,
      updatedAt: now,
    },
  });
  console.log("Admin user created:", admin.email);
  console.log("\nDone! Login with: admin@gmail.com / 12345");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
