const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

async function main() {
  const now = BigInt(Date.now());
  const PASSWORD = await bcrypt.hash("123456", 10);

  console.log("🌱 Seeding full NPO flow...\n");

  // ─── 1. SUPER ADMIN (no org) ─────────────────────────────────────────────
  const superAdmin = await prisma.user.upsert({
    where: { email: "superadmin@gmail.com" },
    update: {},
    create: {
      fullName: "Super Admin",
      email: "superadmin@gmail.com",
      password: PASSWORD,
      role: "SUPER_ADMIN",
      phone: "9000000000",
      status: true,
      createdAt: now,
      updatedAt: now,
    },
  });
  console.log("✅ SUPER_ADMIN  →", superAdmin.email);

  // ─── 2. SUBSCRIPTION PLANS ───────────────────────────────────────────────
  const plan = await prisma.subscriptionPlan.upsert({
    where: { id: "plan-seed-001" },
    update: {},
    create: {
      id: "plan-seed-001",
      name: "Standard Plan",
      durationDays: 365,
      price: 0,
      maxUsers: 200,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  });

  await prisma.subscriptionPlan.upsert({
    where: { id: "plan-monthly-001" },
    update: {},
    create: {
      id: "plan-monthly-001",
      name: "Monthly",
      durationDays: 30,
      price: 49,
      maxUsers: 25,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  });

  await prisma.subscriptionPlan.upsert({
    where: { id: "plan-yearly-001" },
    update: {},
    create: {
      id: "plan-yearly-001",
      name: "Yearly",
      durationDays: 365,
      price: 499,
      maxUsers: 100,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  });
  console.log("✅ Plans        → Standard, Monthly ($49/30d), Yearly ($499/yr)");

  // ─── 3. ORGANIZATION ─────────────────────────────────────────────────────
  const org = await prisma.organization.upsert({
    where: { code: "SUNRISE001" },
    update: {},
    create: {
      name: "Sunrise Care NPO",
      code: "SUNRISE001",
      email: "Sunrise@Sunrise.org",
      phone: "9100000000",
      address: "45 Sunrise Avenue",
      city: "Melbourne",
      state: "Victoria",
      country: "Australia",
      postalCode: "3000",
      status: "ACTIVE",
      createdAt: now,
      updatedAt: now,
    },
  });
  console.log("✅ Organization →", org.name, `(${org.id})`);

  // ─── 4. SUBSCRIPTION ─────────────────────────────────────────────────────
  const existingSub = await prisma.organizationSubscription.findFirst({
    where: { organizationId: org.id },
  });
  if (!existingSub) {
    await prisma.organizationSubscription.create({
      data: {
        organizationId: org.id,
        planId: plan.id,
        planName: plan.name,
        amount: plan.price,
        isTrial: false,
        paymentRef: "SEED-INIT",
        createdBy: superAdmin.id,
        startAt: now,
        endAt: now + BigInt(365 * 24 * 60 * 60 * 1000),
        status: "ACTIVE",
        createdAt: now,
        updatedAt: now,
      },
    });
  }
  console.log("✅ Subscription → ACTIVE (1 year, Standard)");

  // ─── 5. NPO ADMIN ────────────────────────────────────────────────────────
  const admin = await prisma.user.upsert({
    where: { email: "admin@gmail.com" },
    update: {},
    create: {
      fullName: "NPO Admin",
      email: "admin@gmail.com",
      password: PASSWORD,
      role: "NPO_ADMIN",
      phone: "9111111111",
      organizationId: org.id,
      status: true,
      createdAt: now,
      updatedAt: now,
    },
  });
  console.log("✅ NPO_ADMIN    →", admin.email);

  // ─── 6. STAFF ROLES ──────────────────────────────────────────────────────
  const driverRole = await prisma.staffRole.upsert({
    where: { id: "role-driver-001" },
    update: {},
    create: {
      id: "role-driver-001",
      name: "Driver",
      description: "Operates transport vehicles for participants",
      roleType: "DRIVER",
      serviceType: "MOBILITY",
      organizationId: org.id,
      createdBy: admin.id,
      status: true,
      createdAt: now,
      updatedAt: now,
    },
  });

  const supportRole = await prisma.staffRole.upsert({
    where: { id: "role-support-001" },
    update: {},
    create: {
      id: "role-support-001",
      name: "Support Worker",
      description: "Provides personal care and support to participants",
      roleType: "SUPPORT_WORKER",
      serviceType: null,
      organizationId: org.id,
      createdBy: admin.id,
      status: true,
      createdAt: now,
      updatedAt: now,
    },
  });

  const coordinatorRole = await prisma.staffRole.upsert({
    where: { id: "role-coordinator-001" },
    update: {},
    create: {
      id: "role-coordinator-001",
      name: "Coordinator",
      description: "Manages bookings, staff, and participants",
      roleType: "COORDINATOR",
      serviceType: null,
      organizationId: org.id,
      createdBy: admin.id,
      status: true,
      createdAt: now,
      updatedAt: now,
    },
  });

  const nurseRole = await prisma.staffRole.upsert({
    where: { id: "role-nurse-001" },
    update: {},
    create: {
      id: "role-nurse-001",
      name: "Nurse",
      description: "Provides medical support during sessions",
      roleType: "NURSE",
      serviceType: "DAYCARE",
      organizationId: org.id,
      createdBy: admin.id,
      status: true,
      createdAt: now,
      updatedAt: now,
    },
  });
  console.log("✅ Staff Roles  → Driver, Support Worker, Coordinator, Nurse");

  // ─── 7. STAFF USERS ──────────────────────────────────────────────────────
  const coordinator = await prisma.user.upsert({
    where: { email: "coordinator@gmail.com" },
    update: {},
    create: {
      fullName: "Sam Coordinator",
      email: "coordinator@gmail.com",
      password: PASSWORD,
      role: "COORDINATOR",
      phone: "9222222222",
      organizationId: org.id,
      designationId: coordinatorRole.id,
      serviceType: null,
      dateOfJoining: now,
      status: true,
      createdAt: now,
      updatedAt: now,
    },
  });
  console.log("✅ COORDINATOR  →", coordinator.email);

  const driver = await prisma.user.upsert({
    where: { email: "driver@gmail.com" },
    update: {},
    create: {
      fullName: "Mike Driver",
      email: "driver@gmail.com",
      password: PASSWORD,
      role: "STAFF",
      phone: "9333333333",
      organizationId: org.id,
      designationId: driverRole.id,
      serviceType: "MOBILITY",
      dateOfJoining: now,
      status: true,
      createdAt: now,
      updatedAt: now,
    },
  });
  console.log("✅ STAFF/DRIVER →", driver.email);

  const supportWorker = await prisma.user.upsert({
    where: { email: "staff@gmail.com" },
    update: {},
    create: {
      fullName: "Jane Support",
      email: "staff@gmail.com",
      password: PASSWORD,
      role: "STAFF",
      phone: "9444444444",
      organizationId: org.id,
      designationId: supportRole.id,
      serviceType: null,
      dateOfJoining: now,
      status: true,
      createdAt: now,
      updatedAt: now,
    },
  });
  console.log("✅ STAFF/SUPPORT→", supportWorker.email);

  const nurse = await prisma.user.upsert({
    where: { email: "nurse@gmail.com" },
    update: {},
    create: {
      fullName: "Dr. Priya Nurse",
      email: "nurse@gmail.com",
      password: PASSWORD,
      role: "STAFF",
      phone: "9555555555",
      organizationId: org.id,
      designationId: nurseRole.id,
      serviceType: "DAYCARE",
      dateOfJoining: now,
      status: true,
      createdAt: now,
      updatedAt: now,
    },
  });
  console.log("✅ STAFF/NURSE  →", nurse.email);

  // ─── 8. GUARDIANS ────────────────────────────────────────────────────────
  const guardian1 = await prisma.user.upsert({
    where: { email: "guardian@gmail.com" },
    update: {},
    create: {
      fullName: "David Guardian",
      email: "guardian@gmail.com",
      password: PASSWORD,
      role: "GUARDIAN",
      phone: "9666666666",
      alternatePhone: "9666666677",
      organizationId: org.id,
      relationshipType: "Parent",
      address: "12 Oak Street",
      city: "Melbourne",
      state: "Victoria",
      country: "Australia",
      postalCode: "3001",
      status: true,
      createdAt: now,
      updatedAt: now,
    },
  });
  console.log("✅ GUARDIAN 1   →", guardian1.email);

  const guardian2 = await prisma.user.upsert({
    where: { email: "guardian2@gmail.com" },
    update: {},
    create: {
      fullName: "Sarah Guardian",
      email: "guardian2@gmail.com",
      password: PASSWORD,
      role: "GUARDIAN",
      phone: "9777777777",
      alternatePhone: "9777777788",
      organizationId: org.id,
      relationshipType: "Sibling",
      address: "34 Maple Lane",
      city: "Sydney",
      state: "New South Wales",
      country: "Australia",
      postalCode: "2000",
      status: true,
      createdAt: now,
      updatedAt: now,
    },
  });
  console.log("✅ GUARDIAN 2   →", guardian2.email);

  // ─── 9. PARTICIPANTS ─────────────────────────────────────────────────────
  const participant1 = await prisma.user.upsert({
    where: { email: "participant@gmail.com" },
    update: {},
    create: {
      fullName: "Tom Participant",
      email: "participant@gmail.com",
      password: PASSWORD,
      role: "PARTICIPANT",
      phone: "9888888881",
      organizationId: org.id,
      guardianUserId: guardian1.id,
      gender: "Male",
      dateOfBirth: BigInt(new Date("2005-03-15").getTime()),
      medicalNotes: "Requires wheelchair assistance",
      allergyNotes: "Nut allergy",
      mobilitySupport: true,
      emergencyContactPhone: guardian1.phone,
      emergencyInstructions: "Contact David immediately",
      participantStatus: "ACTIVE",
      status: true,
      createdAt: now,
      updatedAt: now,
    },
  });
  console.log("✅ PARTICIPANT 1→", participant1.email, "(guardian:", guardian1.email + ")");

  const participant2 = await prisma.user.upsert({
    where: { email: "participant2@gmail.com" },
    update: {},
    create: {
      fullName: "Emma Participant",
      email: "participant2@gmail.com",
      password: PASSWORD,
      role: "PARTICIPANT",
      phone: "9888888882",
      organizationId: org.id,
      guardianUserId: guardian2.id,
      gender: "Female",
      dateOfBirth: BigInt(new Date("2010-07-22").getTime()),
      medicalNotes: "Autism spectrum — needs structured routine",
      allergyNotes: "None",
      mobilitySupport: false,
      emergencyContactPhone: guardian2.phone,
      emergencyInstructions: "Contact Sarah immediately",
      participantStatus: "ACTIVE",
      status: true,
      createdAt: now,
      updatedAt: now,
    },
  });
  console.log("✅ PARTICIPANT 2→", participant2.email, "(guardian:", guardian2.email + ")");

  // ─── 10. VEHICLES ────────────────────────────────────────────────────────
  const vehicle1 = await prisma.vehicle.upsert({
    where: { vehicleNumber: "VIC-001-ABC" },
    update: {},
    create: {
      organizationId: org.id,
      serviceType: "MOBILITY",
      vehicleName: "Toyota HiAce",
      vehicleNumber: "VIC-001-ABC",
      vehicleType: "Van",
      capacity: 12,
      wheelchairCapacity: 2,
      wheelchairAccessible: true,
      GPSId: "GPS-001",
      equipmentDetails: ["Wheelchair ramp", "Seatbelt harness", "First aid kit"],
      Notes: "Primary mobility transport vehicle",
      createdBy: admin.id,
      status: true,
      createdAt: now,
      updatedAt: now,
    },
  });

  const vehicle2 = await prisma.vehicle.upsert({
    where: { vehicleNumber: "NSW-002-XYZ" },
    update: {},
    create: {
      organizationId: org.id,
      serviceType: null,
      vehicleName: "Ford Transit",
      vehicleNumber: "NSW-002-XYZ",
      vehicleType: "Minibus",
      capacity: 15,
      wheelchairCapacity: 0,
      wheelchairAccessible: false,
      GPSId: "GPS-002",
      equipmentDetails: ["Air conditioning", "First aid kit"],
      Notes: "General purpose transport",
      createdBy: admin.id,
      status: true,
      createdAt: now,
      updatedAt: now,
    },
  });
  console.log("✅ Vehicles     → Toyota HiAce, Ford Transit");

  // ─── 11. VENUES ──────────────────────────────────────────────────────────
  const venue1 = await prisma.venue.upsert({
    where: { id: "venue-seed-001" },
    update: {},
    create: {
      id: "venue-seed-001",
      organizationId: org.id,
      name: "Sunrise Main Hall",
      address: "45 Sunrise Avenue, Melbourne VIC 3000",
      capacity: 50,
      availableCapacity: 50,
      serviceType: "RECREATION",
      contactPerson: "John Manager",
      contactPhone: "9100000011",
      status: true,
      isOccupied: false,
      createdBy: admin.id,
      createdAt: now,
      updatedAt: now,
    },
  });

  const venue2 = await prisma.venue.upsert({
    where: { id: "venue-seed-002" },
    update: {},
    create: {
      id: "venue-seed-002",
      organizationId: org.id,
      name: "Daycare Activity Room",
      address: "45 Sunrise Avenue, Room B, Melbourne VIC 3000",
      capacity: 20,
      availableCapacity: 20,
      serviceType: "DAYCARE",
      contactPerson: "Lisa Coordinator",
      contactPhone: "9100000022",
      status: true,
      isOccupied: false,
      createdBy: admin.id,
      createdAt: now,
      updatedAt: now,
    },
  });
  console.log("✅ Venues       → Sunrise Main Hall, Daycare Activity Room");

  // ─── 12. SERVICES ────────────────────────────────────────────────────────
  const existingServices = await prisma.service.findMany({
    where: { organizationId: org.id },
  });

  if (existingServices.length === 0) {
    await prisma.service.createMany({
      data: [
        {
          organizationId: org.id,
          category: "MOBILITY",
          serviceName: "Mobility Transport",
          defaultCapacity: 10,
          durationMinutes: 60,
          description: "Door-to-door transport for participants with mobility needs",
          requiresTransport: true,
          requiresStaff: true,
          status: true,
          createdAt: now,
          updatedAt: now,
        },
        {
          organizationId: org.id,
          category: "RECREATION",
          serviceName: "Recreation Program",
          defaultCapacity: 20,
          durationMinutes: 120,
          description: "Group recreational activities and social programs",
          requiresTransport: false,
          requiresStaff: true,
          status: true,
          createdAt: now,
          updatedAt: now,
        },
        {
          organizationId: org.id,
          category: "DAYCARE",
          serviceName: "Daycare Support",
          defaultCapacity: 15,
          durationMinutes: 480,
          description: "Full-day structured care and activity program",
          requiresTransport: false,
          requiresStaff: true,
          status: true,
          createdAt: now,
          updatedAt: now,
        },
      ],
    });
  }
  console.log("✅ Services     → Mobility Transport, Recreation Program, Daycare Support");

  // ─── 13. SAMPLE BOOKING (PENDING) ────────────────────────────────────────
  const bookingDate = now + BigInt(2 * 24 * 60 * 60 * 1000); // 2 days from now
  const startTime = bookingDate + BigInt(9 * 60 * 60 * 1000); // 9:00 AM
  const endTime = startTime + BigInt(2 * 60 * 60 * 1000);    // 11:00 AM

  const existingBooking = await prisma.booking.findFirst({
    where: { guardianId: guardian1.id, participantId: participant1.id },
  });

  let booking = existingBooking;
  if (!existingBooking) {
    booking = await prisma.booking.create({
      data: {
        organizationId: org.id,
        participantId: participant1.id,
        guardianId: guardian1.id,
        serviceType: "MOBILITY",
        venueId: venue1.id,
        vehicleId: vehicle1.id,
        bookingDate,
        startTime,
        endTime,
        requiredSeats: 1,
        participantCount: 1,
        purpose: "Weekly mobility session",
        notes: "Wheelchair accessible vehicle required",
        status: "PENDING",
        createdAt: now,
        updatedAt: now,
      },
    });
  }
  console.log("✅ Booking      → PENDING (Tom + David, MOBILITY)");

  // ─── 14. BOOKING STAFF ASSIGNMENT ────────────────────────────────────────
  if (booking) {
    const existingAssignment = await prisma.bookingStaffAssignment.findFirst({
      where: { bookingId: booking.id, userId: driver.id },
    });

    if (!existingAssignment) {
      await prisma.bookingStaffAssignment.create({
        data: {
          bookingId: booking.id,
          userId: driver.id,
          organizationId: org.id,
          assignmentRole: "DRIVER",
          status: "ASSIGNED",
          assignedBy: admin.id,
          assignedAt: now,
          createdAt: now,
          updatedAt: now,
        },
      });
    }
    console.log("✅ Assignment   → Mike Driver assigned to booking");
  }

  // ─── 15. SERVICE SLOTS ───────────────────────────────────────────────────
  const recreationService = await prisma.service.findFirst({
    where: { organizationId: org.id, category: "RECREATION" },
  });

  if (recreationService) {
    const slotStart = now + BigInt(3 * 24 * 60 * 60 * 1000) + BigInt(10 * 60 * 60 * 1000);
    const existingSlot = await prisma.serviceSlot.findFirst({
      where: { serviceId: recreationService.id },
    });
    if (!existingSlot) {
      await prisma.serviceSlot.create({
        data: {
          organizationId: org.id,
          serviceId: recreationService.id,
          venueId: venue1.id,
          serviceType: "RECREATION",
          slotDate: now + BigInt(3 * 24 * 60 * 60 * 1000),
          startTime: slotStart,
          endTime: slotStart + BigInt(2 * 60 * 60 * 1000),
          capacity: 2,
          bookedCount: 0,
          createdBy: admin.id,
          createdAt: now,
          updatedAt: now,
        },
      });
    }
    console.log("✅ Service Slot → Recreation @ Sunrise Main Hall (cap 2)");
  }

  // ─── 16. STAFF AVAILABILITY ──────────────────────────────────────────────
  const existingAvail = await prisma.staffAvailability.findFirst({
    where: { userId: supportWorker.id },
  });
  if (!existingAvail) {
    const unavailStart = now + BigInt(1 * 24 * 60 * 60 * 1000);
    await prisma.staffAvailability.create({
      data: {
        organizationId: org.id,
        userId: supportWorker.id,
        startTime: unavailStart,
        endTime: unavailStart + BigInt(8 * 60 * 60 * 1000),
        reason: "Annual leave",
        createdAt: now,
        updatedAt: now,
      },
    });
  }
  console.log("✅ Availability → Jane Support unavailable (tomorrow)");

  // ─── 17. SAMPLE INCIDENT ─────────────────────────────────────────────────
  const existingIncident = await prisma.incident.findFirst({
    where: { organizationId: org.id },
  });
  if (!existingIncident && booking) {
    await prisma.incident.create({
      data: {
        organizationId: org.id,
        bookingId: booking.id,
        reportedBy: driver.id,
        type: "DELAY",
        severity: "MEDIUM",
        status: "OPEN",
        title: "Vehicle running 20 min late",
        description: "Traffic on pickup route",
        createdAt: now,
        updatedAt: now,
      },
    });
  }
  console.log("✅ Incident → Sample DELAY (OPEN)");

  // ─── SUMMARY ─────────────────────────────────────────────────────────────
  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  SEED COMPLETE — All passwords: 123456
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ROLE           EMAIL                    PASSWORD
  ─────────────────────────────────────────────────
  SUPER_ADMIN    superadmin@gmail.com     123456
  NPO_ADMIN      admin@gmail.com          123456
  COORDINATOR    coordinator@gmail.com    123456
  STAFF/DRIVER   driver@gmail.com         123456
  STAFF/SUPPORT  staff@gmail.com          123456
  STAFF/NURSE    nurse@gmail.com          123456
  GUARDIAN       guardian@gmail.com       123456
  GUARDIAN       guardian2@gmail.com      123456
  PARTICIPANT    participant@gmail.com    123456
  PARTICIPANT    participant2@gmail.com   123456

  ORG:    Sunrise Care NPO (SUNRISE001)
  STATUS: ACTIVE + 1yr subscription

  Booking: Tom → Sunrise Main Hall + Toyota HiAce
           PENDING, Mike Driver assigned
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
