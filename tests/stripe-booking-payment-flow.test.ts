/**
 * Regression tests for Stripe-backed MIAM booking payments.
 *
 * Run with: npx tsx tests/stripe-booking-payment-flow.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

function bootstrapUpdateFor(source: string, serviceName: string) {
  return source
    .split("await db.execute(`")
    .find((statement) => statement.includes("UPDATE service_types") && statement.includes(`WHERE name = '${serviceName}'`)) ?? "";
}

test("service and appointment schemas expose Stripe payment configuration", () => {
  const schemaSource = read("../shared/schema.ts");
  const bootstrapSource = read("../server/db-bootstrap.ts");
  const packageSource = read("../package.json");

  assert.match(packageSource, /"stripe"/);

  assert.match(schemaSource, /onlinePaymentEnabled:\s*boolean\("online_payment_enabled"\)/);
  assert.match(schemaSource, /paymentAmountPence:\s*integer\("payment_amount_pence"\)/);
  assert.match(schemaSource, /paymentCurrency:\s*text\("payment_currency"\)/);
  assert.match(schemaSource, /stripeCheckoutSessionId:\s*text\("stripe_checkout_session_id"\)/);
  assert.match(schemaSource, /stripePaymentIntentId:\s*text\("stripe_payment_intent_id"\)/);
  assert.match(schemaSource, /stripePaymentCompletedAt:\s*timestamp\("stripe_payment_completed_at"\)/);
  assert.match(schemaSource, /paymentFailureReason:\s*text\("payment_failure_reason"\)/);

  assert.match(bootstrapSource, /ALTER TABLE service_types ADD COLUMN IF NOT EXISTS online_payment_enabled BOOLEAN NOT NULL DEFAULT false/);
  assert.match(bootstrapSource, /ALTER TABLE appointments ADD COLUMN IF NOT EXISTS stripe_checkout_session_id TEXT/);
});

test("Replit docs describe Stripe booking payments instead of marking Stripe unimplemented", () => {
  const docs = read("../replit.md");

  assert.match(docs, /Stripe Checkout/);
  assert.match(docs, /STRIPE_SECRET_KEY/);
  assert.match(docs, /STRIPE_WEBHOOK_SECRET/);
  assert.match(docs, /npm install/);
  assert.match(docs, /npm run db:push/);
  assert.doesNotMatch(docs, /Payments\/Stripe\*\*: no payment processing/);
});

test("bootstrap backfills existing public booking services with safe Stripe defaults", () => {
  const indexSource = read("../server/db-bootstrap.ts");
  const miamBackfill = bootstrapUpdateFor(indexSource, "MIAM");
  const urgentBackfill = bootstrapUpdateFor(indexSource, "Urgent (Same Day) MIAM");
  const eveningBackfill = bootstrapUpdateFor(indexSource, "Evening/weekend MIAM");
  const directToCourtBackfill = bootstrapUpdateFor(indexSource, "Direct to Court Express");

  assert.match(miamBackfill, /online_payment_enabled\s*=\s*true/);
  assert.match(miamBackfill, /payment_amount_pence\s*=\s*15000/);
  assert.match(miamBackfill, /payment_currency\s*=\s*'gbp'/);

  assert.match(urgentBackfill, /online_payment_enabled\s*=\s*true/);
  assert.match(urgentBackfill, /payment_amount_pence\s*=\s*20000/);
  assert.match(urgentBackfill, /payment_currency\s*=\s*'gbp'/);

  assert.match(eveningBackfill, /payment_currency/);
  assert.match(eveningBackfill, /'gbp'/);
  assert.doesNotMatch(eveningBackfill, /online_payment_enabled\s*=\s*true/);
  assert.doesNotMatch(eveningBackfill, /payment_amount_pence\s*=\s*\d+/);

  assert.match(directToCourtBackfill, /payment_currency/);
  assert.match(directToCourtBackfill, /'gbp'/);
  assert.doesNotMatch(directToCourtBackfill, /online_payment_enabled\s*=\s*true/);
  assert.doesNotMatch(directToCourtBackfill, /payment_amount_pence\s*=\s*\d+/);
});

test("booking payment helpers require enabled positive GBP pricing", () => {
  const helperSource = read("../server/services/booking-payment.ts");

  assert.match(helperSource, /function hasOnlinePaymentPrice/);
  assert.match(helperSource, /onlinePaymentEnabled === true/);
  assert.match(helperSource, /paymentAmountPence > 0/);
  assert.match(helperSource, /\(config\.paymentCurrency \|\| "gbp"\)\.toLowerCase\(\) === "gbp"/);
  assert.match(helperSource, /function formatPaymentAmount/);
  assert.match(helperSource, /Intl\.NumberFormat\("en-GB"/);
});

test("public booking API only exposes payable services and returns Xero invoice payment details for new paid bookings", () => {
  const routeSource = read("../server/routes/booking.routes.ts");
  const bookingSource = read("../server/services/booking.service.ts");
  const repositorySource = read("../server/repositories/appointment.repository.ts");

  assert.match(routeSource, /hasOnlinePaymentPrice/);
  assert.match(routeSource, /paymentAmountPence/);
  assert.match(routeSource, /formattedPaymentAmount/);
  assert.match(routeSource, /bookingAlreadyUsed/);
  assert.match(routeSource, /existingAppointment/);
  assert.match(routeSource, /getActiveBookingLinkAppointment\(req\.params\.token, result\.partyId\)/);
  assert.match(routeSource, /xeroInvoiceUrl:\s*result\.xeroInvoiceUrl/);
  assert.match(routeSource, /xeroInvoiceNumber:\s*result\.xeroInvoiceNumber/);
  assert.match(routeSource, /xeroInvoiceEmailSent:\s*result\.xeroInvoiceEmailSent/);
  assert.match(routeSource, /mode must be hold or stripe_checkout/);
  assert.match(routeSource, /mode === "hold" \|\| mode === "held"/);
  assert.match(routeSource, /bookingMode/);

  assert.match(bookingSource, /createInvoiceForAppointment/);
  assert.match(bookingSource, /BOOKING_LINK_ALREADY_USED_MESSAGE/);
  assert.match(bookingSource, /getActiveBookingLinkAppointment\(token, validation\.partyId\)/);
  assert.match(bookingSource, /This booking link has already been used to reserve an appointment/);
  assert.match(bookingSource, /This service is not configured for online payment/);
  assert.match(bookingSource, /PublicBookingMode = "hold" \| "stripe_checkout"/);
  assert.match(bookingSource, /mode === "stripe_checkout"/);
  assert.match(bookingSource, /status:\s*bookingMode/);
  assert.match(bookingSource, /paymentProvider:\s*appointmentPaymentProvider/);
  assert.match(bookingSource, /bookingPaymentProvider === "direct_stripe_checkout" \? "stripe" : "xero_stripe"/);
  assert.match(bookingSource, /calculatePublicBookingHoldDeadline\(appointmentDate\)/);
  assert.match(bookingSource, /xeroInvoiceUrl/);
  assert.match(bookingSource, /xeroInvoiceEmailSent/);
  assert.match(bookingSource, /holdExpiresAt/);
  assert.match(bookingSource, /await storage\.deleteAppointment\(appointment\.id\)/);
  assert.doesNotMatch(bookingSource, /createBfmEvent/);
  assert.doesNotMatch(bookingSource, /splitAvailabilityForBooking/);

  assert.match(repositorySource, /getActiveByPartyAndBookingToken/);
  assert.match(repositorySource, /notInArray\(appointments\.status, \["cancelled", "expired"\]\)/);
});

test("Stripe webhook verifies raw body, records payment, and auto-confirms hold appointments", () => {
  const stripeRouteSource = read("../server/routes/stripe.routes.ts");
  const stripeServiceSource = read("../server/services/stripe-payment.service.ts");
  const indexSource = read("../server/routes/index.ts");

  assert.match(indexSource, /stripeRoutes/);
  assert.match(stripeRouteSource, /\/api\/public\/stripe\/webhook/);
  assert.match(stripeRouteSource, /req\.rawBody/);
  assert.match(stripeRouteSource, /STRIPE_WEBHOOK_SECRET/);
  assert.match(stripeRouteSource, /stripePaymentService\.handleWebhookEvent/);

  assert.match(stripeServiceSource, /checkout\.session\.completed/);
  assert.match(stripeServiceSource, /stripeCheckoutSessionId/);
  assert.match(stripeServiceSource, /paymentStatus:\s*"paid"/);
  assert.match(stripeServiceSource, /const paidAt = new Date\(\)/);
  assert.match(stripeServiceSource, /stripePaymentCompletedAt:\s*paidAt/);
  assert.match(stripeServiceSource, /financeService\.recordBookingPayment/);
  assert.match(stripeServiceSource, /appointmentService\.confirm/);
  assert.match(stripeServiceSource, /latest\?\.status === "hold" \|\| latest\?\.status === "held"/);
  assert.match(stripeServiceSource, /status === "confirmed"/);
  assert.match(stripeServiceSource, /checkout\.session\.expired/);
  assert.match(stripeServiceSource, /failed_or_not_received/);
  assert.match(stripeServiceSource, /charge\.refunded/);
  assert.match(stripeServiceSource, /overrideNoShowNoRefund: true/);
  assert.match(stripeServiceSource, /Stripe refund webhook received after provider-side refund was processed/);
});

test("payment return status can reconcile a paid Stripe session without waiting for webhook", () => {
  const routeSource = read("../server/routes/booking.routes.ts");
  const stripeServiceSource = read("../server/services/stripe-payment.service.ts");

  assert.match(routeSource, /session_id/);
  assert.match(routeSource, /normalizeStripeSessionId/);
  assert.ok(routeSource.includes('replace(/\\?+$/, "")'));
  assert.match(routeSource, /reconcileCheckoutSessionReturn/);
  assert.match(routeSource, /stripeCheckoutSessionId !== sessionId/);
  assert.match(routeSource, /return_status_check/);
  assert.match(routeSource, /reconciliationAction/);

  assert.match(stripeServiceSource, /finalizePaidCheckoutSession/);
  assert.match(stripeServiceSource, /payment_status === "paid"/);
  assert.match(stripeServiceSource, /session\.status === "complete"/);
  assert.match(stripeServiceSource, /return_status_check/);
  assert.match(stripeServiceSource, /stripe\.checkout\.sessions\.retrieve/);
});

test("Stripe payment logs are human-readable and avoid raw sensitive payloads", () => {
  const stripeRouteSource = read("../server/routes/stripe.routes.ts");
  const bookingRouteSource = read("../server/routes/booking.routes.ts");
  const stripeServiceSource = read("../server/services/stripe-payment.service.ts");

  assert.match(stripeRouteSource, /logger\.warn\("Stripe webhook secret is not configured"/);
  assert.match(stripeRouteSource, /logger\.warn\("Stripe webhook signature is missing"/);
  assert.match(stripeRouteSource, /logger\.warn\("Stripe webhook raw body is unavailable"/);
  assert.match(stripeRouteSource, /logger\.info\("Stripe webhook verified"/);
  assert.match(stripeRouteSource, /logger\.warn\("Stripe webhook rejected"/);

  assert.match(stripeServiceSource, /logger\.info\("Stripe Checkout Session created"/);
  assert.match(stripeServiceSource, /logger\.info\("Stripe payment finalized"/);
  assert.match(bookingRouteSource, /logger\.warn\("Stripe return check session mismatch"/);
  assert.match(stripeServiceSource, /logger\.warn\("Stripe return check found unpaid session"/);
  assert.match(stripeServiceSource, /logger\.warn\("Stripe return check could not retrieve session"/);
  assert.doesNotMatch(stripeServiceSource, /JSON\.stringify\(session\)/);
  assert.doesNotMatch(stripeRouteSource, /JSON\.stringify\(req\.rawBody\)/);
});

test("public booking UI shows Xero invoice payment details and preserves legacy Stripe return states", () => {
  const pageSource = read("../client/src/pages/book.tsx");
  const servicesPageSource = read("../client/src/pages/services.tsx");

  assert.match(pageSource, /checkoutUrl/);
  assert.match(pageSource, /window\.location\.assign\(data\.checkoutUrl\)/);
  assert.match(pageSource, /xeroInvoiceUrl/);
  assert.match(pageSource, /button-pay-xero-invoice/);
  assert.match(pageSource, /Pay invoice/);
  assert.match(pageSource, /button-hold-appointment/);
  assert.match(pageSource, /Hold appointment/);
  assert.match(pageSource, /stripe_checkout/);
  assert.match(pageSource, /Creating your secure invoice/);
  assert.match(pageSource, /your Xero payment link is being prepared/);
  assert.match(pageSource, /Holding your appointment/);
  assert.match(pageSource, /We are reserving the slot while payment is pending\./);
  assert.match(pageSource, /aria-live="polite"/);
  assert.match(pageSource, /data-testid="booking-pending-status"/);
  assert.match(pageSource, /data-testid="hold-appointment-rules"/);
  assert.match(pageSource, /72 hours before the appointment/);
  assert.match(pageSource, /55 hours before the appointment/);
  assert.match(pageSource, /disabled=\{bookMutation\.isPending\}/);
  assert.match(pageSource, /appointment slot is reserved in the CRM pending payment/);
  assert.match(pageSource, /appointment slot remains on a payment hold/);
  assert.match(pageSource, /Hold deadline/);
  assert.match(pageSource, /paymentReturn === "success"/);
  assert.match(pageSource, /returnSessionId/);
  assert.match(pageSource, /session_id=\$\{encodeURIComponent\(returnSessionId\)\}/);
  assert.match(pageSource, /data\?\.status === "confirmed" && data\?\.paymentStatus === "paid"/);
  assert.match(pageSource, /Payment processing/);
  assert.match(pageSource, /payment may still be processing/i);
  assert.match(pageSource, /Payment cancelled/);
  assert.match(pageSource, /bookingAlreadyUsed/);
  assert.match(pageSource, /card-booking-link-already-used/);
  assert.match(pageSource, /Booking link already used/);
  assert.match(pageSource, /text-existing-booking-date/);
  assert.match(pageSource, /formattedPaymentAmount/);
  assert.match(pageSource, /parseApiError\(bookMutation\.error\)\.userMessage/);

  assert.match(servicesPageSource, /onlinePaymentEnabled/);
  assert.match(servicesPageSource, /paymentAmountPounds/);
  assert.match(servicesPageSource, /input-service-payment-amount/);
  assert.match(servicesPageSource, /switch-service-online-payment/);
});

test("booking hold communications use appointment-time deadline language", () => {
  const notificationSource = read("../server/services/notification.service.ts");
  const emailSource = read("../server/services/email.service.ts");
  const docs = read("../replit.md");

  assert.match(notificationSource, /reserved in the CRM pending payment or voucher acceptance before the hold deadline/);
  assert.match(notificationSource, /No calendar invite has been sent yet/);
  assert.match(notificationSource, /auto-cancelled because payment or voucher acceptance was not recorded before the hold deadline/);
  assert.match(emailSource, /Staff receive a 72-hours-before payment alert/);
  assert.match(emailSource, /auto-cancel 55 hours before the appointment/);
  assert.match(docs, /Public availability shows valid future mediator\/calendar slots, including urgent near-term slots/);
  assert.match(docs, /Near-term public bookings made after that 55-hour point use the appointment start time as the hold expiry/);
  assert.doesNotMatch(notificationSource, /held for 72 hours|mediator will confirm it within 72 hours|expired after 72 hours/);
  assert.doesNotMatch(emailSource, /held for 72 hours|mediator will confirm it within 72 hours|expired after 72 hours/);
});
