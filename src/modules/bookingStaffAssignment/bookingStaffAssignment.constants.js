const ASSIGNMENT_STATUS = {
  // Manager just assigned — staff has NOT yet acknowledged. Soft gate: still
  // counts toward staffing so the booking isn't left short on paper, but the
  // staff member cannot START until they accept.
  PENDING_ACCEPTANCE: "PENDING_ACCEPTANCE",

  ASSIGNED: "ASSIGNED",

  START: "START",

  END: "END",

  COMPLETED: "COMPLETED",

  CANCELLED: "CANCELLED",

  // Staff refused the task (with a reason) — manager must reassign.
  DECLINED: "DECLINED",
};

// Statuses that DON'T count as a live/held assignment: a cancelled or declined
// assignment frees the staff member's time and drops out of the staffing tally.
const INACTIVE_STATUSES = [
  ASSIGNMENT_STATUS.CANCELLED,
  ASSIGNMENT_STATUS.DECLINED,
];

// must mirror the StaffRoleType enum in prisma/schema.prisma
const ASSIGNMENT_ROLES = {
  DRIVER: "DRIVER",

  SUPPORT_WORKER: "SUPPORT_WORKER",

  COORDINATOR: "COORDINATOR",

  NURSE: "NURSE",

  ACTIVITY_LEADER: "ACTIVITY_LEADER",

  OTHER: "OTHER",
};

module.exports = {
  ASSIGNMENT_STATUS,
  ASSIGNMENT_ROLES,
  INACTIVE_STATUSES,
};
