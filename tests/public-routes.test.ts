import { test } from "node:test";
import assert from "node:assert/strict";
import { isPublicRoute } from "../client/src/lib/public-routes";

test("public booking and token routes skip authenticated user bootstrap", () => {
  const publicPaths = [
    "/book/5f07097f-e7be-4897-803f-026eb5c7d24c",
    "/book/5f07097f-e7be-4897-803f-026eb5c7d24c?payment=success&appointmentId=7a46210b-b071-44d2-ad43-9b4b86d5be1a&session_id=cs_test_123",
    "/demographic-form/client-token",
    "/consent/representative/representative-token",
    "/consent/client-token",
    "/session-availability/proposal-token",
    "/apply/mediator/mediator-token",
    "/apply/contractor/contractor-token",
    "/update-application/applicant-token",
    "/register/invite-token",
    "/forgot-password",
    "/reset-password/reset-token",
    "/onboarding?token=onboarding-token",
  ];

  for (const path of publicPaths) {
    assert.equal(isPublicRoute(path), true, path);
  }
});

test("protected app routes still require authenticated user bootstrap", () => {
  const protectedPaths = [
    "/",
    "/dashboard",
    "/cases",
    "/cases/abc123",
    "/appointments",
    "/settings",
    "/login",
  ];

  for (const path of protectedPaths) {
    assert.equal(isPublicRoute(path), false, path);
  }
});
