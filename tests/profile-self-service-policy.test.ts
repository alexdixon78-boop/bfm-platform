import { test } from "node:test";
import assert from "node:assert/strict";
import { canEditField, canRequestMediatorField, canReviewMediatorField } from "../shared/mediator-rbac";
import { parseProfileImage } from "../server/services/profile-image.service";

test("mediator can request own staff-controlled facts but not decisions or another record", () => {
  assert.equal(canRequestMediatorField("mobilePhone", "m1", "m1"), true);
  assert.equal(canRequestMediatorField("fmcUrn", "m1", "m1"), true);
  assert.equal(canRequestMediatorField("contractFileUrl", "m1", "m1"), true);
  assert.equal(canRequestMediatorField("mobilePhone", "m1", "m2"), false);
  assert.equal(canRequestMediatorField("bankSortCode", "m1", "m1"), false);
  assert.equal(canRequestMediatorField("panelStatus", "m1", "m1"), false);
  assert.equal(canRequestMediatorField("engagementType", "m1", "m1"), false);
  assert.equal(canRequestMediatorField("profilePhotoApproved", "m1", "m1"), false);
  assert.equal(canEditField("profilePhotoUrl", "mediator", "m1", "m1"), false);
});

test("both admins can review eligible requests", () => {
  assert.equal(canReviewMediatorField("fmcUrn", "superadmin"), true);
  assert.equal(canReviewMediatorField("fmcUrn", "subadmin"), true);
  assert.equal(canReviewMediatorField("panelStatus", "superadmin"), false);
  assert.equal(canReviewMediatorField("fmcUrn", "mediator"), false);
});

test("profile picture accepts a small valid PNG and rejects MIME spoofing", () => {
  const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
  assert.equal(parseProfileImage(`data:image/png;base64,${png.toString("base64")}`).mimeType, "image/png");
  assert.throws(() => parseProfileImage(`data:image/jpeg;base64,${png.toString("base64")}`));
  assert.throws(() => parseProfileImage("data:image/png;base64,Zm9v"));
});
