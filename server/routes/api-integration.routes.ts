import { Router, type Request, type Response } from "express";
import crypto from "crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { db } from "../db";
import { apiIntegrations, enquiries, ENQUIRY_CONTACT_METHODS, ISSUE_TYPES, LEAD_SOURCES, REFERRAL_TYPES } from "@shared/schema";
import { enquiryService } from "../services/enquiry.service";
import { logAudit } from "../services/audit-log.service";
import { storage } from "../storage";
import type { ApiIntegration, User } from "@shared/schema";
import { logger } from "../logger";
import {
  buildCalendlyDuplicateNeedle,
  buildCalendlyMetadata,
  enrichCalendlyConsultation,
  getCalendlySafeDiagnostics,
  getCalendlyValidationDiagnostics,
} from "../services/calendly-intake.service";
import {
  CalendlyApiError,
  createCalendlyWebhookSubscription,
  getCalendlySubscriptionConfigStatus,
  validateCalendlyCallbackUrl,
} from "../services/calendly-subscription.service";
import { xeroService } from "../services/xero.service";
import { paymentSettingsService } from "../services/payment-settings.service";

const router = Router();
const WEBSITE_ENQUIRY_TYPE = "website_enquiries";
const CALENDLY_SIGNATURE_HEADER = "Calendly-Webhook-Signature";
const CALENDLY_ALLOWED_SKEW_MS = 5 * 60 * 1000;
const CALENDLY_IGNORED_EVENTS = new Set(["invitee.canceled"]);

function hashApiKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

function publicIntegration(row: ApiIntegration) {
  const { keyHash: _keyHash, ...safe } = row;
  return safe;
}

async function loadSuperadmin(req: Request, res: Response): Promise<User | null> {
  const userId = req.session.userId;
  if (!userId) {
    res.status(401).json({ message: "Not authenticated" });
    return null;
  }
  const user = await storage.getUser(userId);
  if (!user) {
    res.status(401).json({ message: "Not authenticated" });
    return null;
  }
  if (user.role !== "superadmin") {
    res.status(403).json({ message: "Only superadmins can manage external APIs" });
    return null;
  }
  return user;
}

function extractApiKey(req: Request): string | null {
  const auth = req.header("Authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice("Bearer ".length).trim();
  const headerKey = req.header("X-API-Key");
  return headerKey?.trim() || null;
}

function safeCompareHex(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function verifyCalendlySignature(req: Request): { ok: true } | { ok: false; status: number; message: string } {
  const signingKey = process.env.CALENDLY_WEBHOOK_SIGNING_KEY;
  if (!signingKey) {
    return { ok: false, status: 503, message: "Calendly webhook signing key is not configured" };
  }

  const signatureHeader = req.header(CALENDLY_SIGNATURE_HEADER);
  const rawBody = req.rawBody;
  if (!signatureHeader || !Buffer.isBuffer(rawBody)) {
    return { ok: false, status: 401, message: "Invalid Calendly webhook signature" };
  }

  const parts = Object.fromEntries(
    signatureHeader.split(",").map((part) => {
      const [key, ...valueParts] = part.trim().split("=");
      return [key, valueParts.join("=")];
    }),
  );
  const timestamp = parts.t;
  const signature = parts.v1 || parts.signature;
  if (!timestamp || !signature) {
    return { ok: false, status: 401, message: "Invalid Calendly webhook signature" };
  }

  const timestampMs = Number(timestamp) * 1000;
  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > CALENDLY_ALLOWED_SKEW_MS) {
    return { ok: false, status: 401, message: "Invalid Calendly webhook signature" };
  }

  const expected = crypto
    .createHmac("sha256", signingKey)
    .update(`${timestamp}.${rawBody.toString("utf8")}`)
    .digest("hex");

  try {
    return safeCompareHex(signature, expected)
      ? { ok: true }
      : { ok: false, status: 401, message: "Invalid Calendly webhook signature" };
  } catch {
    return { ok: false, status: 401, message: "Invalid Calendly webhook signature" };
  }
}

async function authenticateWebsiteIntegration(req: Request) {
  const apiKey = extractApiKey(req);
  if (!apiKey) return { ok: false as const, status: 401, message: "Missing API key" };

  const [integration] = await db
    .select()
    .from(apiIntegrations)
    .where(and(
      eq(apiIntegrations.type, WEBSITE_ENQUIRY_TYPE),
      eq(apiIntegrations.keyHash, hashApiKey(apiKey)),
    ))
    .limit(1);

  if (!integration) return { ok: false as const, status: 401, message: "Invalid API key" };
  if (integration.status !== "active") return { ok: false as const, status: 403, message: "API key has been revoked" };

  await db.update(apiIntegrations).set({ lastUsedAt: new Date() }).where(eq(apiIntegrations.id, integration.id));
  return { ok: true as const, integration };
}

const createIntegrationSchema = z.object({
  label: z.string().trim().min(1).max(120).optional(),
});

const calendlyWebhookSubscriptionSchema = z.object({
  callbackUrl: z.string().trim().min(1),
});

router.get("/api/integrations", requireAuth, async (req, res) => {
  const user = await loadSuperadmin(req, res);
  if (!user) return;

  const rows = await db
    .select()
    .from(apiIntegrations)
    .where(eq(apiIntegrations.type, WEBSITE_ENQUIRY_TYPE));

  res.json(rows.map(publicIntegration));
});

router.get("/api/integrations/status", requireAuth, async (req, res) => {
  const user = await loadSuperadmin(req, res);
  if (!user) return;

  const status = getCalendlySubscriptionConfigStatus();
  const xeroStatus = xeroService.getConfigStatus();
  const stripeStatus = paymentSettingsService.getStripeReadiness();
  res.json({
    calendlyPatConfigured: status.calendlyPatConfigured,
    calendlyWebhookSigningKeyConfigured: status.calendlyWebhookSigningKeyConfigured,
    calendlyOrganizationUriConfigured: status.calendlyOrganizationUriConfigured,
    ...xeroStatus,
    ...stripeStatus,
  });
});

router.post("/api/integrations/calendly/webhook-subscription", requireAuth, async (req, res) => {
  const user = await loadSuperadmin(req, res);
  if (!user) return;

  const parsed = calendlyWebhookSubscriptionSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ success: false, message: "Calendly callback URL is required" });
  }

  const callbackValidation = validateCalendlyCallbackUrl(parsed.data.callbackUrl);
  if (!callbackValidation.ok) {
    return res.status(400).json({ success: false, message: callbackValidation.message });
  }

  const token = process.env.CALENDLY_PAT;
  const signingKey = process.env.CALENDLY_WEBHOOK_SIGNING_KEY;
  const organizationUri = process.env.CALENDLY_ORGANIZATION_URI;
  if (!token || !signingKey || !organizationUri) {
    const status = getCalendlySubscriptionConfigStatus();
    return res.status(503).json({
      success: false,
      message: "Calendly subscription management is not fully configured",
      status,
    });
  }

  const callbackUrl = parsed.data.callbackUrl;
  logger.info("[Calendly] Subscription update started", { callbackUrl });

  try {
    const result = await createCalendlyWebhookSubscription({
      callbackUrl,
      token,
      signingKey,
      organizationUri,
    });

    logger.info("[Calendly] Subscription updated", {
      callbackUrl,
      deletedCount: result.deletedCount,
      subscriptionUri: result.subscription.uri,
      state: result.subscription.state,
      preflightStatus: result.preflight.status,
    });
    await logAudit({
      userId: user.id,
      action: "calendly_webhook_subscription_updated",
      entity: "integration",
      entityRef: "calendly_consultations",
      details: JSON.stringify({
        callbackUrl,
        deletedCount: result.deletedCount,
        subscriptionUri: result.subscription.uri,
        state: result.subscription.state,
        events: result.subscription.events,
        scope: result.subscription.scope,
        organization: result.subscription.organization,
        preflight: result.preflight,
      }),
    });

    return res.json({
      success: true,
      subscription: result.subscription,
      deletedCount: result.deletedCount,
      preflight: result.preflight,
    });
  } catch (error) {
    const status = error instanceof CalendlyApiError ? error.status : 502;
    const safeMessage = error instanceof CalendlyApiError
      ? error.safeMessage
      : "Calendly API request failed";

    logger.error("[Calendly] Subscription update failed", {
      callbackUrl,
      status,
      reason: safeMessage,
    });
    await logAudit({
      userId: user.id,
      action: "calendly_webhook_subscription_failed",
      entity: "integration",
      entityRef: "calendly_consultations",
      details: JSON.stringify({
        callbackUrl,
        status,
        reason: safeMessage,
        preflight: error instanceof CalendlyApiError && safeMessage.startsWith("Callback URL is not reachable")
          ? { ok: false, status, reason: safeMessage }
          : undefined,
      }),
    });

    return res.status(502).json({
      success: false,
      message: safeMessage,
    });
  }
});

router.post("/api/integrations", requireAuth, async (req, res) => {
  const user = await loadSuperadmin(req, res);
  if (!user) return;

  const parsed = createIntegrationSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ message: "Invalid integration data" });

  const rawKey = `bfm_live_${crypto.randomBytes(32).toString("hex")}`;
  const [row] = await db.insert(apiIntegrations).values({
    type: WEBSITE_ENQUIRY_TYPE,
    label: parsed.data.label || "Website enquiries",
    keyHash: hashApiKey(rawKey),
    keyPrefix: rawKey.slice(0, 18),
    status: "active",
    createdBy: user.id,
  }).returning();

  await logAudit({
    userId: user.id,
    action: "api_integration_key_created",
    entity: "api_integration",
    entityId: row.id,
    entityRef: row.label,
    details: JSON.stringify({ type: row.type, keyPrefix: row.keyPrefix }),
  });

  res.status(201).json({ integration: publicIntegration(row), apiKey: rawKey });
});

router.patch("/api/integrations/:id/revoke", requireAuth, async (req, res) => {
  const user = await loadSuperadmin(req, res);
  if (!user) return;

  const [row] = await db.update(apiIntegrations).set({
    status: "revoked",
    revokedAt: new Date(),
    revokedBy: user.id,
  }).where(eq(apiIntegrations.id, req.params.id)).returning();

  if (!row) return res.status(404).json({ message: "Integration key not found" });

  await logAudit({
    userId: user.id,
    action: "api_integration_key_revoked",
    entity: "api_integration",
    entityId: row.id,
    entityRef: row.label,
    details: JSON.stringify({ type: row.type, keyPrefix: row.keyPrefix }),
  });

  res.json(publicIntegration(row));
});

const websiteEnquirySchema = z.object({
  firstName: z.string().trim().min(1),
  middleName: z.string().trim().optional().nullable(),
  lastName: z.string().trim().min(1),
  dateOfBirth: z.string().trim().optional().nullable(),
  email: z.string().trim().email(),
  mobileTelephone: z.string().trim().min(1),
  phoneCode: z.string().trim().optional().nullable(),
  landlineTelephone: z.string().trim().optional().nullable(),
  contactMethod: z.enum(ENQUIRY_CONTACT_METHODS).optional(),
  postcode: z.string().trim().min(1),
  leadSource: z.enum(LEAD_SOURCES),
  leadSourceOther: z.string().trim().optional().nullable(),
  referralType: z.enum(REFERRAL_TYPES),
  issueType: z.enum(ISSUE_TYPES),
  issueTypeOther: z.string().trim().optional().nullable(),
  addressLine1: z.string().trim().min(1),
  addressLine2: z.string().trim().optional().nullable(),
  notes: z.string().trim().optional().nullable(),
  consentFollowUp: z.boolean().optional(),
  consentAnonymisedData: z.boolean().optional(),
  privacyConsent: z.boolean().optional(),
  websitePageUrl: z.string().trim().url().optional().nullable(),
  utmSource: z.string().trim().optional().nullable(),
  utmMedium: z.string().trim().optional().nullable(),
  utmCampaign: z.string().trim().optional().nullable(),
});

function buildWebsiteNotes(data: z.infer<typeof websiteEnquirySchema>): string | undefined {
  const meta = [
    "Source: Website API",
    data.websitePageUrl ? `Website page: ${data.websitePageUrl}` : null,
    data.utmSource ? `UTM source: ${data.utmSource}` : null,
    data.utmMedium ? `UTM medium: ${data.utmMedium}` : null,
    data.utmCampaign ? `UTM campaign: ${data.utmCampaign}` : null,
  ].filter(Boolean);
  return [data.notes || null, meta.length ? meta.join("\n") : null].filter(Boolean).join("\n\n") || undefined;
}

router.post("/api/public/integrations/website-enquiries", async (req, res) => {
  const auth = await authenticateWebsiteIntegration(req);
  if (!auth.ok) return res.status(auth.status).json({ success: false, message: auth.message });

  const parsed = websiteEnquirySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, message: "Invalid enquiry data", errors: parsed.error.flatten() });
  }
  const data = parsed.data;

  const result = await enquiryService.create({
    firstName: data.firstName,
    middleName: data.middleName || undefined,
    lastName: data.lastName,
    dateOfBirth: data.dateOfBirth || undefined,
    email: data.email.toLowerCase(),
    mobileTelephone: data.mobileTelephone,
    phoneCode: data.phoneCode || "+44",
    landlineTelephone: data.landlineTelephone || undefined,
    contactMethod: "Website form",
    ...(data.contactMethod ? { contactMethod: data.contactMethod } : {}),
    issueType: data.issueType,
    referralType: data.referralType,
    addressLine1: data.addressLine1,
    addressLine2: data.addressLine2 || undefined,
    postcode: data.postcode,
    consentFollowUp: data.consentFollowUp ?? false,
    consentAnonymisedData: data.consentAnonymisedData ?? false,
    privacyConsent: data.privacyConsent ?? false,
    leadSource: data.leadSource,
    leadSourceOther: data.leadSourceOther || undefined,
    issueTypeOther: data.issueTypeOther || undefined,
    notes: buildWebsiteNotes(data),
  });

  if (!result.ok) return res.status(result.status).json({ success: false, message: result.error });

  await logAudit({
    userId: null,
    action: "public_website_enquiry_created",
    entity: "enquiry",
    entityId: result.enquiry.id,
    entityRef: result.enquiry.enquiryRef,
    details: JSON.stringify({
      integrationId: auth.integration.id,
      integrationLabel: auth.integration.label,
      email: result.enquiry.email,
      source: "Website API",
      leadSource: result.enquiry.leadSource,
      acknowledgementStatus: result.enquiry.acknowledgementStatus,
    }),
  });

  res.status(201).json({ success: true, enquiryRef: result.enquiry.enquiryRef });
});

router.post("/api/public/integrations/calendly-consultations", async (req, res) => {
  const signature = verifyCalendlySignature(req);
  if (!signature.ok) {
    logger.warn("[Calendly] Webhook signature rejected", {
      status: signature.status,
      hasSignatureHeader: Boolean(req.header(CALENDLY_SIGNATURE_HEADER)),
      hasRawBody: Buffer.isBuffer(req.rawBody),
    });
    return res.status(signature.status).json({ success: false, message: signature.message });
  }

  const mapped = await enrichCalendlyConsultation(req.body, {
    token: process.env.CALENDLY_PAT,
  });
  const metadata = buildCalendlyMetadata(mapped);
  const baseDiagnostics = {
    event: mapped.event || "unknown",
    enrichmentStatus: mapped.enrichment.status,
    eventUriPresent: Boolean(metadata.calendly.eventUri),
    inviteeUriPresent: Boolean(metadata.calendly.inviteeUri),
    answerCount: mapped.questionsAndAnswers.length,
  };

  logger.info("[Calendly] Webhook received", baseDiagnostics);

  if (mapped.event !== "invitee.created" || CALENDLY_IGNORED_EVENTS.has(mapped.event)) {
    await logAudit({
      userId: null,
      action: "public_calendly_consultation_ignored",
      entity: "integration",
      entityRef: "calendly_consultations",
      details: JSON.stringify({
        ...baseDiagnostics,
        source: "Calendly",
        eventUri: metadata.calendly.eventUri,
        inviteeUri: metadata.calendly.inviteeUri,
      }),
    });
    return res.json({ success: true, ignored: true });
  }

  if (mapped.enrichment.status === "failed") {
    logger.error("[Calendly] Invitee detail fetch failed", {
      ...baseDiagnostics,
      httpStatus: mapped.enrichment.httpStatus,
      reason: mapped.enrichment.reason,
    });
    await logAudit({
      userId: null,
      action: "public_calendly_consultation_fetch_failed",
      entity: "integration",
      entityRef: "calendly_consultations",
      details: JSON.stringify({
        ...baseDiagnostics,
        source: "Calendly",
        eventUri: metadata.calendly.eventUri,
        inviteeUri: metadata.calendly.inviteeUri,
        httpStatus: mapped.enrichment.httpStatus,
        reason: mapped.enrichment.reason,
      }),
    });
    return res.status(502).json({
      success: false,
      message: "Failed to fetch Calendly invitee details",
    });
  }

  const validationDiagnostics = getCalendlyValidationDiagnostics(mapped.data);
  if (
    validationDiagnostics.missingFields.length > 0 ||
    Object.keys(validationDiagnostics.invalidEnums).length > 0
  ) {
    const safeDiagnostics = getCalendlySafeDiagnostics(mapped);
    logger.warn("[Calendly] Consultation data rejected", {
      ...baseDiagnostics,
      missingFields: validationDiagnostics.missingFields,
      invalidEnumFields: Object.keys(validationDiagnostics.invalidEnums),
      answerLabels: safeDiagnostics.answerLabels,
      normalizedAnswerLabels: safeDiagnostics.normalizedAnswerLabels,
      phoneCandidateFieldsPresent: safeDiagnostics.phoneCandidateFieldsPresent,
    });
    await logAudit({
      userId: null,
      action: "public_calendly_consultation_rejected",
      entity: "integration",
      entityRef: "calendly_consultations",
      details: JSON.stringify({
        ...baseDiagnostics,
        source: "Calendly",
        eventUri: metadata.calendly.eventUri,
        inviteeUri: metadata.calendly.inviteeUri,
        fieldErrors: validationDiagnostics.missingFields,
        invalidEnums: validationDiagnostics.invalidEnums,
        answerLabels: safeDiagnostics.answerLabels,
        normalizedAnswerLabels: safeDiagnostics.normalizedAnswerLabels,
        phoneCandidateFieldsPresent: safeDiagnostics.phoneCandidateFieldsPresent,
      }),
    });
    const fieldErrors = Object.fromEntries(
      validationDiagnostics.missingFields.map((field) => [field, ["Required"]]),
    );
    return res.status(400).json({
      success: false,
      message: "Invalid Calendly consultation data",
      errors: {
        formErrors: [],
        fieldErrors: {
          ...fieldErrors,
          ...Object.fromEntries(
            Object.entries(validationDiagnostics.invalidEnums).map(([field, value]) => [
              field,
              [`Invalid value: ${value}`],
            ]),
          ),
        },
      },
    });
  }

  const duplicateNeedle = buildCalendlyDuplicateNeedle(metadata.calendly.inviteeUri);
  if (duplicateNeedle) {
    const [existing] = await db
      .select({ id: enquiries.id, enquiryRef: enquiries.enquiryRef })
      .from(enquiries)
      .where(and(
        eq(enquiries.contactMethod, "Calendly consultation"),
        sql`${enquiries.metadata} LIKE ${`%${duplicateNeedle}%`}`,
      ))
      .limit(1);
    if (existing) {
      logger.info("[Calendly] Duplicate webhook ignored", {
        ...baseDiagnostics,
        enquiryRef: existing.enquiryRef,
      });
      await logAudit({
        userId: null,
        action: "public_calendly_consultation_duplicate",
        entity: "enquiry",
        entityId: existing.id,
        entityRef: existing.enquiryRef,
        details: JSON.stringify({
          ...baseDiagnostics,
          source: "Calendly",
          eventUri: metadata.calendly.eventUri,
          inviteeUri: metadata.calendly.inviteeUri,
        }),
      });
      return res.json({
        success: true,
        duplicate: true,
        enquiryRef: existing.enquiryRef,
      });
    }
  }

  const data = mapped.data;
  const result = await enquiryService.create({
    firstName: data.firstName,
    lastName: data.lastName,
    email: data.email.toLowerCase(),
    mobileTelephone: data.mobileTelephone,
    phoneCode: "+44",
    contactMethod: "Calendly consultation",
    issueType: data.issueType,
    referralType: data.referralType,
    addressLine1: data.addressLine1,
    postcode: data.postcode,
    consentFollowUp: false,
    consentAnonymisedData: false,
    privacyConsent: false,
    leadSource: data.leadSource,
    leadSourceOther: data.leadSourceOther || undefined,
    issueTypeOther: data.issueTypeOther || undefined,
    notes: data.notes || undefined,
    metadata: JSON.stringify(metadata),
  });

  if (!result.ok) {
    logger.error("[Calendly] Enquiry creation failed", {
      ...baseDiagnostics,
      status: result.status,
      error: result.error,
    });
    return res.status(result.status).json({ success: false, message: result.error });
  }

  await logAudit({
    userId: null,
    action: "public_calendly_consultation_created",
    entity: "enquiry",
    entityId: result.enquiry.id,
    entityRef: result.enquiry.enquiryRef,
    details: JSON.stringify({
      source: "Calendly",
      email: result.enquiry.email,
      leadSource: result.enquiry.leadSource,
      eventUri: metadata.calendly.eventUri,
      inviteeUri: metadata.calendly.inviteeUri,
      acknowledgementStatus: result.enquiry.acknowledgementStatus,
      ...baseDiagnostics,
    }),
  });

  logger.info("[Calendly] Consultation enquiry created", {
    ...baseDiagnostics,
    enquiryRef: result.enquiry.enquiryRef,
  });

  res.status(201).json({ success: true, enquiryRef: result.enquiry.enquiryRef });
});

export default router;
