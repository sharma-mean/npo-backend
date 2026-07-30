const request = require("supertest");
const app = require("./app");

describe("Staff Module Routes", () => {
  test("GET /api/staff should return staff list", async () => {
    const response = await request(app).get("/api/staff");
    expect(response.status).toBe(200);
  });

  test("POST /api/staff should create new staff", async () => {
    const staffData = {
      fullName: "Test Staff",
      email: "test@example.com",
      phone: "1234567890",
      role: "ADMIN",
      organizationId: "test-org-id",
      createdBy: "test-user-id",
    };

    const response = await request(app).post("/api/staff").send(staffData);
    expect(response.status).toBe(201);
  });
});