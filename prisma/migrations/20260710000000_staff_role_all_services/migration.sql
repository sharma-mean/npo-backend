-- Staff roles no longer carry a service category: every role applies to all services.
-- NULL serviceType already means "all services" across the app.
UPDATE "StaffRole" SET "serviceType" = NULL WHERE "serviceType" IS NOT NULL;
