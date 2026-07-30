-- CreateIndex
CREATE INDEX IF NOT EXISTS "AuditLog_organizationId_entity_action_idx" ON "AuditLog"("organizationId", "entity", "action");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AuditLog_actorId_idx" ON "AuditLog"("actorId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Booking_organizationId_status_idx" ON "Booking"("organizationId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Booking_organizationId_bookingDate_idx" ON "Booking"("organizationId", "bookingDate");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Booking_participantId_idx" ON "Booking"("participantId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Booking_guardianId_idx" ON "Booking"("guardianId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Booking_slotId_idx" ON "Booking"("slotId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Booking_vehicleId_idx" ON "Booking"("vehicleId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Booking_venueId_idx" ON "Booking"("venueId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Booking_recurrenceGroupId_idx" ON "Booking"("recurrenceGroupId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BookingStaffAssignment_bookingId_idx" ON "BookingStaffAssignment"("bookingId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BookingStaffAssignment_userId_idx" ON "BookingStaffAssignment"("userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BookingStaffAssignment_organizationId_idx" ON "BookingStaffAssignment"("organizationId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Incident_organizationId_status_isDeleted_idx" ON "Incident"("organizationId", "status", "isDeleted");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Incident_bookingId_idx" ON "Incident"("bookingId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Incident_reportedBy_idx" ON "Incident"("reportedBy");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Invoice_organizationId_idx" ON "Invoice"("organizationId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Invoice_subscriptionId_idx" ON "Invoice"("subscriptionId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Notification_userId_isRead_idx" ON "Notification"("userId", "isRead");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Notification_organizationId_idx" ON "Notification"("organizationId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OrganizationSubscription_organizationId_status_idx" ON "OrganizationSubscription"("organizationId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OrganizationSubscription_planId_idx" ON "OrganizationSubscription"("planId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Service_organizationId_isDeleted_idx" ON "Service"("organizationId", "isDeleted");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ServiceSlot_organizationId_isDeleted_idx" ON "ServiceSlot"("organizationId", "isDeleted");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ServiceSlot_serviceId_idx" ON "ServiceSlot"("serviceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ServiceSlot_venueId_idx" ON "ServiceSlot"("venueId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "StaffAttendance_organizationId_isDeleted_idx" ON "StaffAttendance"("organizationId", "isDeleted");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "StaffAttendance_userId_idx" ON "StaffAttendance"("userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "StaffAvailability_organizationId_isDeleted_idx" ON "StaffAvailability"("organizationId", "isDeleted");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "StaffAvailability_userId_idx" ON "StaffAvailability"("userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "StaffRole_organizationId_idx" ON "StaffRole"("organizationId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "User_organizationId_role_isDeleted_idx" ON "User"("organizationId", "role", "isDeleted");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "User_organizationId_status_idx" ON "User"("organizationId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "User_designationId_idx" ON "User"("designationId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "User_guardianUserId_idx" ON "User"("guardianUserId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Vehicle_organizationId_idx" ON "Vehicle"("organizationId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Venue_organizationId_idx" ON "Venue"("organizationId");
