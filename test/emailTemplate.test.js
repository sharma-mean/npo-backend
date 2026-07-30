const test = require("node:test");
const assert = require("node:assert");

const { renderTemplate } = require("../src/modules/notification/notification.helper");

test("emailTemplate: renders with full data and includes CTA", async () => {
  const html = await renderTemplate({
    templateName: "notification-template",
    data: {
      name: "Naveen",
      title: "Reset your password",
      message: "Click below to reset.",
      actionUrl: "https://app.test/reset?token=abc",
      actionText: "Reset Password",
    },
  });
  assert.match(html, /Reset your password/);
  assert.match(html, /Naveen/);
  assert.match(html, /Reset Password/);
  assert.match(html, /https:\/\/app\.test\/reset\?token=abc/);
});

test("emailTemplate: renders with minimal data without throwing (no ReferenceError)", async () => {
  const html = await renderTemplate({
    templateName: "notification-template",
    data: { title: "Hi", message: "hello" },
  });
  assert.match(html, /Hi/);
  assert.match(html, /hello/);
  // No CTA button when actionUrl absent
  assert.doesNotMatch(html, /View Details/);
});

test("emailTemplate: renders detail rows when provided", async () => {
  const html = await renderTemplate({
    templateName: "notification-template",
    data: {
      title: "Booking",
      message: "msg",
      participantName: "Alex",
      serviceType: "MOBILITY",
      bookingCode: "BK-1",
    },
  });
  assert.match(html, /Alex/);
  assert.match(html, /MOBILITY/);
  assert.match(html, /BK-1/);
});
