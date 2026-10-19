/**
 * Regression tests for the MIAM booking onboarding flow.
 *
 * Run with: npx tsx tests/booking-onboarding-flow.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ALLOWED_PUBLIC_NEW_CASE_BOOKING_SERVICE_NAMES,
  BOOKING_ONBOARDING_DESCRIPTION_MARKER,
  isPublicNewCaseBookingServiceName,
  normalizeFamilyCaseSubtype,
  validateBookingOnboardingDetails,
  splitFullName,
  stripBookingOnboardingDescriptionMarker,
} from "../server/services/booking-onboarding";
import { FAMILY_CASE_SUBTYPES } from "../shared/schema";

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const validOnboarding = {
  fullName: "Alex Morgan",
  dateOfBirth: "1984-05-01",
  addressLine1: "10 High Street",
  postcode: "SW1A 1AA",
  email: "alex@example.com",
  phone: "07123456789",
  caseType: "Family",
  caseSubtype: "Property & finance (PF)",
  caseDescription: "We need help discussing finances.",
  howHeard: "Website",
  termsConsent: true,
};

test("baseline seed includes the new Evening/weekend MIAM service", () => {
  const seedSource = read("../server/seed.ts");
  assert.match(seedSource, /name:\s*"Evening\/weekend MIAM"/);
  assert.match(seedSource, /name:\s*"Evening\/weekend MIAM"[\s\S]*category:\s*"MIAM"/);
});

test("baseline seed includes explicit online payment defaults for public booking services", () => {
  const seedSource = read("../server/seed.ts");

  assert.match(seedSource, /name:\s*"MIAM"[\s\S]*?onlinePaymentEnabled:\s*true[\s\S]*?paymentAmountPence:\s*15000[\s\S]*?paymentCurrency:\s*"gbp"/);
  assert.match(seedSource, /name:\s*"Urgent \(Same Day\) MIAM"[\s\S]*?onlinePaymentEnabled:\s*true[\s\S]*?paymentAmountPence:\s*20000[\s\S]*?paymentCurrency:\s*"gbp"/);
  assert.match(seedSource, /name:\s*"Evening\/weekend MIAM"[\s\S]*?onlinePaymentEnabled:\s*false[\s\S]*?paymentAmountPence:\s*null[\s\S]*?paymentCurrency:\s*"gbp"/);
  assert.match(seedSource, /name:\s*"Direct to Court Express"[\s\S]*?onlinePaymentEnabled:\s*false[\s\S]*?paymentAmountPence:\s*null[\s\S]*?paymentCurrency:\s*"gbp"/);
});

test("public new-case booking services are allow-listed to the four client-approved services", () => {
  assert.deepEqual(ALLOWED_PUBLIC_NEW_CASE_BOOKING_SERVICE_NAMES, [
    "MIAM",
    "Evening/weekend MIAM",
    "Urgent (Same Day) MIAM",
    "Direct to Court Express",
  ]);

  assert.equal(isPublicNewCaseBookingServiceName("MIAM"), true);
  assert.equal(isPublicNewCaseBookingServiceName("Evening/weekend MIAM"), true);
  assert.equal(isPublicNewCaseBookingServiceName("Urgent (Same Day) MIAM"), true);
  assert.equal(isPublicNewCaseBookingServiceName("Direct to Court Express"), true);
  assert.equal(isPublicNewCaseBookingServiceName("Mediation Sessions"), false);
  assert.equal(isPublicNewCaseBookingServiceName("Court Application Package (C100)"), false);
});

test("family case subtypes use client-friendly labels everywhere", () => {
  assert.deepEqual(FAMILY_CASE_SUBTYPES.slice(0, 3), [
    "Child arrangements (CA)",
    "Property & finance (PF)",
    "All issues mediation (AIM)",
  ]);
});

test("family case subtype aliases normalize to client-friendly labels", () => {
  assert.equal(normalizeFamilyCaseSubtype("Child arrangements"), "Child arrangements (CA)");
  assert.equal(normalizeFamilyCaseSubtype("Finance & Property"), "Property & finance (PF)");
  assert.equal(normalizeFamilyCaseSubtype("All Issues Mediation"), "All issues mediation (AIM)");
  assert.equal(normalizeFamilyCaseSubtype("Property & finance (PF)"), "Property & finance (PF)");
  assert.equal(normalizeFamilyCaseSubtype("Grandparent"), "Grandparent");
  assert.equal(normalizeFamilyCaseSubtype(null), null);
});

test("booking onboarding validation rejects missing mandatory details before appointment creation", () => {
  const result = validateBookingOnboardingDetails({
    ...validOnboarding,
    postcode: "",
    termsConsent: false,
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, {
    postcode: "Postcode is required",
    termsConsent: "Terms consent is required",
  });
});

test("Client A booking onboarding keeps intake fields required but makes children details optional", () => {
  const childRelated = validateBookingOnboardingDetails({
    ...validOnboarding,
    caseSubtype: "Child arrangements (CA)",
    childrenDetails: "",
  }, "A");
  assert.equal(childRelated.ok, true);

  const missingClientAFields = validateBookingOnboardingDetails({
    ...validOnboarding,
    caseDescription: "",
    howHeard: "",
  }, "A");
  assert.equal(missingClientAFields.ok, false);
  assert.deepEqual(missingClientAFields.errors, {
    caseDescription: "Case description is required",
    howHeard: "How-heard is required",
  });
});

test("non-A booking onboarding ignores forged Client-A-only intake fields", () => {
  const result = validateBookingOnboardingDetails({
    ...validOnboarding,
    caseDescription: "Client A's private description",
    howHeard: "Referral partner",
    childrenDetails: "Children's private details",
  }, "B");

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.caseDescription, "");
  assert.equal(result.data.howHeard, "");
  assert.equal(result.data.childrenDetails, null);
});

test("booking onboarding helpers normalize full name for client persistence", () => {
  assert.deepEqual(splitFullName("Alex Morgan"), { firstName: "Alex", lastName: "Morgan" });
  assert.deepEqual(splitFullName("Alex Sarah Morgan"), { firstName: "Alex Sarah", lastName: "Morgan" });
  assert.deepEqual(splitFullName("Alex"), { firstName: "Alex", lastName: "" });
});

test("booking appointment route requires onboarding details and passes them into the service", () => {
  const routeSource = read("../server/routes/booking.routes.ts");
  const serviceSource = read("../server/services/booking.service.ts");

  assert.match(routeSource, /onboardingDetails/);
  assert.match(routeSource, /createBookingAppointment\([\s\S]*onboardingDetails/);
  assert.match(routeSource, /mode must be hold or stripe_checkout/);
  assert.match(serviceSource, /validateBookingOnboardingDetails/);
  assert.match(serviceSource, /persistBookingOnboardingDetails/);
  assert.match(serviceSource, /Missing required booking details/);
});

test("booking onboarding persistence updates existing CRM records without making monitoring data mandatory", () => {
  const serviceSource = read("../server/services/booking.service.ts");
  const bookPageSource = read("../client/src/pages/book.tsx");

  assert.match(serviceSource, /updateClient\(party\.clientId/);
  assert.match(serviceSource, /upsertDemographicData/);
  assert.match(serviceSource, /normalizeFamilyCaseSubtype\(details\.caseSubtype\)/);
  assert.match(serviceSource, /upsertMiamRecord/);
  assert.match(serviceSource, /introNotes: details\.caseDescription/);
  assert.doesNotMatch(serviceSource, /updateCaseNotes/);
  assert.match(serviceSource, /refreshCaseFilterCache/);
  assert.doesNotMatch(serviceSource, /lifeSatisfaction/);
  assert.doesNotMatch(serviceSource, /anxietyScore/);
  assert.doesNotMatch(serviceSource, /emotionalWellbeing/);

  assert.match(bookPageSource, /Confirm Your Details/);
  assert.match(bookPageSource, /Child arrangements \(CA\)/);
  assert.match(bookPageSource, /Property & finance \(PF\)/);
  assert.match(bookPageSource, /All issues mediation \(AIM\)/);
  assert.match(bookPageSource, /data-testid="input-booking-full-name"/);
  assert.match(bookPageSource, /data-testid="textarea-booking-children"/);
  assert.match(bookPageSource, /data-testid="checkbox-booking-terms"/);
});

test("booking description helper strips the technical onboarding marker", () => {
  assert.equal(BOOKING_ONBOARDING_DESCRIPTION_MARKER, "Booking onboarding description:");
  assert.equal(
    stripBookingOnboardingDescriptionMarker("Booking onboarding description:\nWe need help discussing finances."),
    "We need help discussing finances.",
  );
  assert.equal(
    stripBookingOnboardingDescriptionMarker("Staff note\n\nBooking onboarding description:\nClient text"),
    "Staff note\n\nClient text",
  );
  assert.equal(stripBookingOnboardingDescriptionMarker("Clean client text"), "Clean client text");
  assert.equal(stripBookingOnboardingDescriptionMarker(null), "");
});

test("booking link details do not prefill public description from case notes", () => {
  const serviceSource = read("../server/services/booking.service.ts");

  assert.doesNotMatch(serviceSource, /caseDescription: caseData\.notes \|\| ""/);
  assert.match(serviceSource, /const existingMiamRecord = await storage\.getCurrentMiamRecord\(party\.id, party\.caseId\)/);
  assert.match(serviceSource, /caseDescription: stripBookingOnboardingDescriptionMarker\(stableMiamRenewalPrefill\.introNotes/);
});

test("booking page honors service and date deep links from acknowledgement emails", () => {
  const bookPageSource = read("../client/src/pages/book.tsx");

  assert.match(bookPageSource, /searchParams\.get\("serviceTypeId"\)/);
  assert.match(bookPageSource, /searchParams\.get\("date"\)/);
  assert.match(bookPageSource, /isValidBookingDeepLinkDate/);
  assert.match(bookPageSource, /setSelectedServiceId\(requestedServiceTypeId\)/);
  assert.match(bookPageSource, /setSelectedDate\(parseBookingDeepLinkDate\(requestedDate\)/);
  assert.match(bookPageSource, /setStep\(requestedDate \? "time" : "date"\)/);
});

test("repeat MIAM booking uses stable prefill and creates a fresh renewal record", () => {
  const bookingSource = read("../server/services/booking.service.ts");
  const onboardingSource = read("../server/services/booking-onboarding.ts");
  const repoSource = read("../server/repositories/miam-record.repository.ts");

  assert.match(onboardingSource, /export function buildStableMiamRenewalPrefill/);
  assert.match(onboardingSource, /clientName/);
  assert.match(onboardingSource, /otherClientName/);
  assert.match(onboardingSource, /children/);
  assert.match(onboardingSource, /dateOfSeparation/);
  assert.doesNotMatch(onboardingSource, /suitableForMediation:/);
  assert.doesNotMatch(onboardingSource, /approvalStatus:/);
  assert.doesNotMatch(onboardingSource, /reviewedAt:/);
  assert.match(bookingSource, /createRenewalMiamRecordFromBooking/);
  assert.match(bookingSource, /createRenewalMiamRecord/);
  assert.match(repoSource, /renewalOfMiamRecordId/);
  assert.match(repoSource, /renewalSequence/);
});

test("expired MIAM booking routes are available to both staff and clients", () => {
  const bookingRouteSource = read("../server/routes/booking.routes.ts");
  const bookingSource = read("../server/services/booking.service.ts");
  const casePageSource = read("../client/src/pages/case-detail.tsx");

  assert.match(bookingRouteSource, /\/api\/parties\/:partyId\/miam-renewal-booking-link/);
  assert.match(bookingRouteSource, /\/api\/parties\/:partyId\/miam-renewal-self-service-link/);
  assert.match(bookingSource, /generateMiamRenewalBookingLink/);
  assert.match(bookingSource, /renewalBookingAvailable/);
  assert.match(casePageSource, /button-send-repeat-miam-link/);
  assert.match(casePageSource, /button-client-repeat-miam/);
});

test("fresh MIAM self-service booking route is client-owned and redirects without email", () => {
  const bookingRouteSource = read("../server/routes/booking.routes.ts");
  const bookingSource = read("../server/services/booking.service.ts");
  const casePageSource = read("../client/src/pages/case-detail.tsx");

  const routeBlock = bookingRouteSource.match(/router\.post\("\/api\/parties\/:partyId\/miam-self-service-booking-link"[\s\S]*?\n\}\);/)?.[0] || "";

  assert.match(routeBlock, /requireAuth/);
  assert.match(routeBlock, /user\.role !== "client" \|\| party\.userId !== user\.id/);
  assert.match(routeBlock, /Clients can only create MIAM booking links for their own party record/);
  assert.match(routeBlock, /generateFreshMiamSelfServiceBookingLink\(req\.params\.partyId, clientActor\(party, "miam_self_service"\)/);
  assert.match(routeBlock, /generate_miam_self_service_booking_link/);
  assert.match(routeBlock, /emailSent: result\.emailSent/);
  assert.match(bookingSource, /generateFreshMiamSelfServiceBookingLink/);
  assert.match(bookingSource, /sendEmail: false/);
  assert.match(casePageSource, /miam-self-service-booking-link/);
  assert.match(casePageSource, /window\.location\.assign\(data\.bookingUrl\)/);
  assert.doesNotMatch(casePageSource, /setBookingLinkResult\(.*miam-self-service-booking-link/);
});

test("fresh MIAM self-service booking rejects active MIAM bookings and valid MIAMs", () => {
  const bookingSource = read("../server/services/booking.service.ts");

  assert.match(bookingSource, /ACTIVE_MIAM_BOOKING_SERVICE_NAMES/);
  assert.match(bookingSource, /isActiveMiamBookingBlocker/);
  assert.match(bookingSource, /ACTIVE_MIAM_BOOKING_HOLD_STATUSES\.has\(appointment\.status\)/);
  assert.match(bookingSource, /appointment\.status !== "confirmed"/);
  assert.match(bookingSource, /appointmentTime >= now\.getTime\(\)/);
  assert.match(bookingSource, /partyValidity\?\.valid/);
  assert.match(bookingSource, /You already have an active MIAM booking/);
  assert.match(bookingSource, /Your MIAM is already valid for court applications/);
  assert.match(bookingSource, /generateBookingLink\(partyId, actor, \{ \.\.\.options, sendEmail: false \}\)/);
});

test("repeat MIAM button is blocked only by active MIAM bookings", () => {
  const casePageSource = read("../client/src/pages/case-detail.tsx");
  const repeatButtonTestId = casePageSource.indexOf("button-send-repeat-miam-link");
  const repeatButtonStart = casePageSource.lastIndexOf("<Button", repeatButtonTestId);
  const repeatButtonEnd = casePageSource.indexOf("</Button>", repeatButtonTestId);
  const repeatButtonBlock = casePageSource.slice(repeatButtonStart, repeatButtonEnd);

  assert.match(casePageSource, /partyHasActiveMiamBooking/);
  assert.match(casePageSource, /ACTIVE_MIAM_BOOKING_SERVICE_NAMES/);
  assert.match(repeatButtonBlock, /disabled=\{repeatMiamLinkMutation\.isPending \|\| partyHasActiveMiamBooking\}/);
  assert.doesNotMatch(repeatButtonBlock, /partyHasActiveAppointment/);
});

test("past confirmed MIAM appointments do not block repeat MIAM booking", () => {
  const casePageSource = read("../client/src/pages/case-detail.tsx");

  assert.match(casePageSource, /function isActiveMiamBookingBlocker/);
  assert.match(casePageSource, /appointmentTime >= now/);
  assert.match(casePageSource, /ACTIVE_MIAM_BOOKING_HOLD_STATUSES\.has\(appt\.status\)/);
  assert.match(casePageSource, /ACTIVE_MIAM_BOOKING_SERVICE_NAMES\.has\(appt\.serviceName \|\| ""\)/);
  assert.match(casePageSource, /isActiveMiamBookingBlocker\(a\)/);
});

test("case details appointment list exposes general appointment completion action", () => {
  const casePageSource = read("../client/src/pages/case-detail.tsx");

  assert.match(casePageSource, /const completeMutation = useMutation/);
  assert.match(casePageSource, /apiRequest\("PATCH", `\/api\/appointments\/\$\{id\}\/complete`\)/);
  assert.match(casePageSource, /button-complete-appointment-/);
  assert.match(casePageSource, /Mark completed/);
  assert.match(casePageSource, /canCompleteAppointment/);
  assert.doesNotMatch(casePageSource, /canCompleteMiamAppointment/);
  const completionGuardBlock = casePageSource.match(/const canCompleteAppointment = \(appt: AppointmentData\): boolean => \{[\s\S]*?\n  \};/)?.[0] || "";
  assert.doesNotMatch(completionGuardBlock, /ACTIVE_MIAM_BOOKING_SERVICE_NAMES/);
  assert.match(completionGuardBlock, /appt\.status === "confirmed"/);
  assert.match(completionGuardBlock, /isPastAppointment\(appt\)/);
});

test("appointment completion endpoint uses case access policy and rejects future appointments", () => {
  const routeSource = read("../server/routes/appointment.routes.ts");
  const appointmentServiceSource = read("../server/services/appointment.service.ts");

  const completeRouteBlock = routeSource.match(/router\.patch\("\/api\/appointments\/:id\/complete"[\s\S]*?\n\}\);/)?.[0] || "";
  const completeServiceBlock = appointmentServiceSource.match(/async complete\(id: string[\s\S]*?\n  \}/)?.[0] || "";

  assert.match(completeRouteBlock, /canManageAppointment\(user, req\.params\.id\)/);
  assert.match(routeSource, /hasFullOperationalCaseAccess\(access\)/);
  assert.match(routeSource, /access\.tier === "miam_only_mediator"/);
  assert.match(completeRouteBlock, /Access denied/);
  assert.match(completeServiceBlock, /appt\.status !== "confirmed"/);
  assert.match(completeServiceBlock, /new Date\(appt\.dateTime\)\.getTime\(\) >= Date\.now\(\)/);
  assert.match(completeServiceBlock, /Cannot complete a future appointment/);
});

test("fresh MIAM booking button is suppressed when repeat MIAM is available", () => {
  const casePageSource = read("../client/src/pages/case-detail.tsx");
  const freshButtonStart = casePageSource.indexOf("showFreshMiamBookingButton &&");
  const freshButtonEnd = casePageSource.indexOf("showClientFreshMiamBookingButton", freshButtonStart);
  const freshButtonBlock = casePageSource.slice(freshButtonStart, freshButtonEnd);

  assert.match(casePageSource, /const showRepeatMiamBookingButton =/);
  assert.match(casePageSource, /const showFreshMiamBookingButton =/);
  assert.match(casePageSource, /!showRepeatMiamBookingButton/);
  assert.match(freshButtonBlock, /showFreshMiamBookingButton/);
  assert.match(freshButtonBlock, /purpose="miam_booking"/);
});

test("client fresh MIAM booking button appears on the shared summary card only when needed", () => {
  const casePageSource = read("../client/src/pages/case-detail.tsx");
  const clientButtonTestId = casePageSource.indexOf("button-client-book-miam");
  const clientButtonStart = casePageSource.lastIndexOf("<Button", clientButtonTestId);
  const clientButtonEnd = casePageSource.indexOf("</Button>", clientButtonTestId);
  const clientButtonBlock = casePageSource.slice(clientButtonStart, clientButtonEnd);

  assert.match(casePageSource, /const showClientFreshMiamBookingButton =/);
  assert.match(casePageSource, /user\?\.role === "client"/);
  assert.match(casePageSource, /!partyMiamValidity\?\.valid/);
  assert.match(casePageSource, /!partyMiamValidity\?\.renewalBookingAvailable/);
  assert.match(casePageSource, /!partyHasActiveMiamBooking/);
  assert.match(casePageSource, /freshMiamSelfServiceLinkMutation/);
  assert.match(clientButtonBlock, /data-testid="button-client-book-miam"/);
  assert.match(clientButtonBlock, /Book MIAM/);
  assert.match(clientButtonBlock, /disabled=\{freshMiamSelfServiceLinkMutation\.isPending \|\| partyHasActiveMiamBooking\}/);
  assert.doesNotMatch(clientButtonBlock, /bookingLinkResult/);
});

test("client fresh MIAM button treats visible client appointments as own-party bookings", () => {
  const casePageSource = read("../client/src/pages/case-detail.tsx");
  const miamBlock = casePageSource.match(/const partyHasActiveMiamBookingByRole = \(role: string\): boolean => \{[\s\S]*?\n  \};/)?.[0] || "";

  assert.match(miamBlock, /if \(isClient\) return \(overviewAppointments \|\| \[\]\)\.some\(\(a\) => isActiveMiamBookingBlocker\(a\)\)/);
  assert.match(miamBlock, /a\.partyId === party\.id && isActiveMiamBookingBlocker\(a\)/);
});

test("bootstrap cleans legacy booking onboarding marker only when MIAM intro notes match", () => {
  const bootstrapSource = read("../server/db-bootstrap.ts");

  assert.match(bootstrapSource, /Booking onboarding description:/);
  assert.match(bootstrapSource, /cleanupLegacyBookingOnboardingCaseNotes/);
  assert.match(bootstrapSource, /JOIN miam_records mr ON mr\.case_id = c\.id/);
  assert.match(bootstrapSource, /mr\.intro_notes IS NOT NULL/);
  assert.match(bootstrapSource, /substring\(c\.notes from position/);
  assert.match(bootstrapSource, /Legacy booking onboarding case-note markers cleaned:/);
});
