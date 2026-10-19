import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middleware/auth";
import { requirePermission } from "../middleware/permissions";
import { storage } from "../storage";
import { logAudit } from "../services/audit-log.service";
import { clientService } from "../services/client.service";
import { caseActivityService, staffActor } from "../services/case-activity.service";
import { notificationService } from "../services/notification.service";
import { getNextRoleLetter } from "../utils/case-ref";
import { isClientDemographicComplete, REQUIRED_CLIENT_DEMOGRAPHIC_FIELDS } from "../utils/demographic-completion";
import crypto from "crypto";
import { z } from "zod";
import { classifyCaseAccess, hasFullOperationalCaseAccess } from "../security/case-access-policy";
import { permissionService } from "../services/permission.service";
import { canEditSection } from "@shared/permissions";

const router = Router();

function getBaseUrl(): string {
  if (process.env.BASE_URL) return process.env.BASE_URL;
  if (process.env.REPLIT_DEV_DOMAIN) return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  if (process.env.REPL_SLUG) return `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`;
  return "http://localhost:5000";
}

function getUser(req: Request) {
  return (req as Request & { user: { id: string; role: string; name: string; email: string } }).user;
}

const MEDIATOR_ONLY_FIELDS = ["familyCaseSubtype", "workplaceCaseSubtype"] as const;

const demographicDataSchema = z.object({
  dateOfBirth: z.string().max(20).optional().nullable(),
  genderIdentity: z.string().min(1, "Gender identity is required").max(100),
  genderSelfDescription: z.string().max(200).optional().nullable(),
  ethnicity: z.string().min(1, "Ethnicity is required").max(200),
  ethnicSelfDisclose: z.string().max(200).optional().nullable(),
  countryOfBirth: z.string().max(100).optional().nullable(),
  countryOfBirthOther: z.string().max(200).optional().nullable(),
  firstLanguage: z.string().min(1, "First language is required").max(100),
  firstLanguageOther: z.string().max(200).optional().nullable(),
  interpreterNeeded: z.string().min(1, "Interpreter support selection is required").max(200),
  interpreterLanguage: z.string().max(200).optional().nullable(),
  disabilityOrHealthConditions: z.string().max(2000).optional().nullable(),
  additionalNeeds: z.string().max(2000).optional().nullable(),
  employmentStatus: z.string().min(1, "Employment status is required").max(100),
  legalAidEligible: z.string().min(1, "Legal aid selection is required").max(100),
  voucherSchemeEligible: z.string().min(1, "Voucher scheme selection is required").max(100),
  courtProceedingsStatus: z.string().min(1, "Court proceedings status is required").max(200),
  courtReference: z.string().max(200).optional().nullable(),
  courtName: z.string().max(200).optional().nullable(),
  cafcassInvolved: z.string().min(1, "CAFCASS involvement selection is required").max(100),
  solicitorInvolved: z.string().max(100).optional().nullable(),
  solicitorName: z.string().max(500).optional().nullable(),
  childrenAges: z.string().max(500).optional().nullable(),
  lifeSatisfaction: z.number().min(0).max(10, "Must be 0-10"),
  anxietyScore: z.number().min(0).max(10, "Must be 0-10"),
  emotionalWellbeing: z.number().min(1).max(5, "Must be 1-5"),
  familyCaseSubtype: z.string().max(500).optional().nullable(),
  workplaceCaseSubtype: z.string().max(500).optional().nullable(),
}).strict();

function stripMediatorOnlyFields(data: Record<string, any>): Record<string, any> {
  const cleaned = { ...data };
  for (const field of MEDIATOR_ONLY_FIELDS) {
    delete cleaned[field];
  }
  return cleaned;
}

async function notifySuperadminDemographicCompleted(party: { firstName: string; lastName: string; caseId: string }) {
  const caseData = await storage.getCase(party.caseId);
  const clientName = `${party.firstName} ${party.lastName}`.trim();
  const caseRef = caseData?.caseRef || party.caseId;

  await notificationService.createNotification({
    recipientId: null,
    recipientRole: "superadmin",
    type: "demographic_data_completed",
    urgency: "green",
    caseId: party.caseId,
    appointmentId: null,
    title: `Demographic data completed — ${clientName}`,
    message: `${clientName} completed demographic data for case ${caseRef}.`,
    status: "active",
    assignedTo: null,
    followUpDate: null,
    caseNoteRequired: false,
  });
}

async function verifyCaseAccess(caseId: string, req: Request, res: Response): Promise<{ ok: boolean; userPartyRole?: string }> {
  const user = getUser(req);
  const access = await classifyCaseAccess(caseId, user);
  if (!hasFullOperationalCaseAccess(access)) {
    res.status(403).json({ message: "Access denied" });
    return { ok: false };
  }
  return { ok: true };
}

async function getClientPartyId(userId: string, caseId: string): Promise<string | null> {
  const userParties = await storage.listPartiesByUserId(userId);
  const partyInCase = userParties.find(p => p.caseId === caseId);
  return partyInCase?.id || null;
}

router.get("/api/demographic-data/case/:caseId", requirePermission("cases", "view"), async (req, res) => {
  try {
    const caseId = req.params.caseId;
    const user = getUser(req);
    const access = await classifyCaseAccess(caseId, user);
    if (access.tier === "none") return res.status(403).json({ message: "Access denied" });

    const allData = await storage.getDemographicDataByCase(caseId);

    if (access.tier === "client_party") {
      const clientPartyId = await getClientPartyId(user.id, caseId);
      if (!clientPartyId) return res.json([]);
      const filtered = allData.filter((d: any) => d.partyId === clientPartyId);
      return res.json(filtered);
    }

    if (!hasFullOperationalCaseAccess(access)) return res.status(403).json({ message: "Access denied" });
    res.json(allData);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch demographic data" });
  }
});

router.get("/api/demographic-data/party/:partyId", requirePermission("cases", "view"), async (req, res) => {
  try {
    const party = await storage.getParty(req.params.partyId);
    if (!party) return res.status(404).json({ message: "Party not found" });

    const user = getUser(req);
    const access = await classifyCaseAccess(party.caseId, user);
    if (access.tier === "none") return res.status(403).json({ message: "Access denied" });

    if (access.tier === "client_party") {
      const clientPartyId = await getClientPartyId(user.id, party.caseId);
      if (clientPartyId !== party.id) {
        return res.status(403).json({ message: "Not authorised" });
      }
    } else if (!hasFullOperationalCaseAccess(access)) return res.status(403).json({ message: "Access denied" });

    const data = await storage.getDemographicDataByParty(req.params.partyId);
    res.json(data || null);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch demographic data" });
  }
});

router.put("/api/demographic-data/party/:partyId", requirePermission("cases", "view"), async (req, res) => {
  try {
    const party = await storage.getParty(req.params.partyId);
    if (!party) return res.status(404).json({ message: "Party not found" });

    const user = getUser(req);
    const isStaff = user.role === "superadmin" || user.role === "subadmin" || user.role === "staff" || user.role === "mediator";

    if (isStaff) {
      const permissions = await permissionService.getPermissions();
      if (!canEditSection(permissions, user.role, "cases")) return res.status(403).json({ message: "Requires cases edit permission" });
      const access = await classifyCaseAccess(party.caseId, user);
      if (!hasFullOperationalCaseAccess(access)) return res.status(403).json({ message: "Access denied" });
    } else if (user.role === "client") {
      const clientPartyId = await getClientPartyId(user.id, party.caseId);
      if (clientPartyId !== party.id) {
        return res.status(403).json({ message: "Not authorised" });
      }
    } else {
      return res.status(403).json({ message: "Not authorised" });
    }

    const parsed = demographicDataSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid data", errors: parsed.error.flatten().fieldErrors });
    }

    let sanitized: Record<string, any> = parsed.data;
    if (user.role === "client") {
      sanitized = stripMediatorOnlyFields(sanitized);
    }

    if (isStaff) {
      const caseRecord = await storage.getCase(party.caseId);
      const issueType = caseRecord?.issueType || "";
      const isWorkplaceCase = /workplace|employment|grievance/i.test(issueType);
      const isEmptyJsonArray = (v: any) => !v || v === "[]" || v === "null";
      if (!isWorkplaceCase && isEmptyJsonArray(sanitized.familyCaseSubtype)) {
        return res.status(400).json({ message: "Invalid data", errors: { familyCaseSubtype: ["At least one family subtype is required"] } });
      }
      if (isWorkplaceCase && isEmptyJsonArray(sanitized.workplaceCaseSubtype)) {
        return res.status(400).json({ message: "Invalid data", errors: { workplaceCaseSubtype: ["At least one workplace subtype is required"] } });
      }
    }

    const existingDemographicData = await storage.getDemographicDataByParty(party.id);
    const wasClientDemographicComplete = isClientDemographicComplete(existingDemographicData);

    const data = await storage.upsertDemographicData(party.id, party.caseId, {
      ...sanitized,
      completedBy: user.role === "client"
        ? `${user.name} (client)`
        : `${user.name} (staff)`,
      completedAt: new Date(),
    });

    await logAudit({
      userId: user.id,
      action: "update",
      entity: "demographic_data",
      entityId: data.id,
      details: `Updated demographic data for party ${party.firstName} ${party.lastName}`,
      ipAddress: req.ip,
    });

    const isClientCompletionTransition = user.role === "client" && !wasClientDemographicComplete && isClientDemographicComplete(data);
    if (isClientCompletionTransition) {
      await notifySuperadminDemographicCompleted(party);
    }

    res.json(data);
  } catch (err) {
    console.error("[DemographicRoutes] Error saving demographic data:", err);
    res.status(500).json({ message: "Failed to save demographic data" });
  }
});

router.post("/api/demographic-data/send-form/:partyId", requirePermission("cases", "edit"), async (req, res) => {
  try {
    const party = await storage.getParty(req.params.partyId);
    if (!party) return res.status(404).json({ message: "Party not found" });
    if (!party.email) return res.status(400).json({ message: "Party has no email address" });

    const user = getUser(req);
    if (user.role === "client") {
      return res.status(403).json({ message: "Not authorised" });
    }

    const access = await verifyCaseAccess(party.caseId, req, res);
    if (!access.ok) return;

    const token = crypto.randomUUID();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await storage.updateParty(party.id, {
      miamFormToken: token,
      miamFormTokenExpiresAt: expiresAt,
    });

    const caseData = await storage.getCase(party.caseId);
    const formUrl = `${getBaseUrl()}/demographic-form/${token}`;

    const { sendDemographicFormEmail } = await import("../services/email.service");
    const emailSent = await sendDemographicFormEmail(
      party.email,
      party.firstName,
      formUrl,
      caseData?.caseRef
    );

    await logAudit({
      userId: user.id,
      action: "send_demographic_form",
      entity: "demographic_data",
      entityId: party.id,
      entityRef: caseData?.caseRef,
      details: `Sent demographic form to ${party.firstName} ${party.lastName} (${party.email})`,
      ipAddress: req.ip,
    });

    res.json({ sent: true, emailSent, formUrl });
  } catch (err) {
    console.error("[DemographicRoutes] Error sending form:", err);
    res.status(500).json({ message: "Failed to send demographic form" });
  }
});

router.get("/api/public/demographic-form/:token", async (req, res) => {
  try {
    const party = await storage.getPartyByMiamFormToken(req.params.token);
    if (!party) return res.status(404).json({ message: "Invalid or expired form link" });

    if (party.miamFormTokenExpiresAt && new Date(party.miamFormTokenExpiresAt) < new Date()) {
      return res.status(410).json({ message: "This form link has expired. Please contact your mediator for a new link." });
    }

    const existingData = await storage.getDemographicDataByParty(party.id);

    res.json({
      firstName: party.firstName,
      lastName: party.lastName,
      dateOfBirth: party.dateOfBirth,
      email: party.email,
      gender: party.gender,
      ethnicOrigin: party.ethnicOrigin,
      existingData: existingData || null,
    });
  } catch (err) {
    res.status(500).json({ message: "Failed to load form" });
  }
});

router.post("/api/public/demographic-form/:token", async (req, res) => {
  try {
    const party = await storage.getPartyByMiamFormToken(req.params.token);
    if (!party) return res.status(404).json({ message: "Invalid or expired form link" });

    if (party.miamFormTokenExpiresAt && new Date(party.miamFormTokenExpiresAt) < new Date()) {
      return res.status(410).json({ message: "This form link has expired." });
    }

    const parsed = demographicDataSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid data", errors: parsed.error.flatten().fieldErrors });
    }
    const missingClientFields = REQUIRED_CLIENT_DEMOGRAPHIC_FIELDS.filter((field) => {
      const value = parsed.data[field];
      return value === null || value === undefined || value === "" || (typeof value === "number" && Number.isNaN(value));
    });
    if (missingClientFields.length > 0) {
      return res.status(400).json({ message: "Invalid data", errors: Object.fromEntries(missingClientFields.map((field) => [field, ["This field is required"]])) });
    }

    const existingDemographicData = await storage.getDemographicDataByParty(party.id);
    const wasClientDemographicComplete = isClientDemographicComplete(existingDemographicData);
    const sanitized = stripMediatorOnlyFields(parsed.data);

    const data = await storage.upsertDemographicData(party.id, party.caseId, {
      ...sanitized,
      completedBy: `${party.firstName} ${party.lastName} (client)`,
      completedAt: new Date(),
    });

    await storage.updateParty(party.id, {
      miamFormToken: null,
      miamFormTokenExpiresAt: null,
    });

    await logAudit({
      action: "submit_demographic_form",
      entity: "demographic_data",
      entityId: data.id,
      details: `Demographic form submitted by ${party.firstName} ${party.lastName} via email link`,
      ipAddress: req.ip,
    });

    if (!wasClientDemographicComplete && isClientDemographicComplete(data)) {
      await notifySuperadminDemographicCompleted(party);
    }

    res.json({ success: true });
  } catch (err) {
    console.error("[DemographicRoutes] Error submitting form:", err);
    res.status(500).json({ message: "Failed to submit form" });
  }
});

// Legacy `/add-party-b` and `/link-party-b` endpoints removed in favour of the
// generic `POST /api/cases/:caseId/parties` handler below, which assigns the
// next free letter (A→Z) and handles both create-new and link-existing flows.

const addPartySchema = z.union([
  z.object({
    firstName: z.string().min(1, "First name is required").max(100),
    lastName: z.string().min(1, "Last name is required").max(100),
    email: z.string().email("Valid email is required").max(255),
  }),
  z.object({
    userId: z.string().min(1, "userId is required"),
  }),
]);

router.post("/api/cases/:caseId/parties", requirePermission("cases", "edit"), async (req, res) => {
  try {
    const user = getUser(req);
    // Adding parties is restricted to staff (superadmin/subadmin) and mediators only.
    // Clients, contractors, or any other role with cases.edit are explicitly blocked.
    const allowedRoles = new Set(["superadmin", "subadmin", "mediator"]);
    if (!allowedRoles.has(user.role)) {
      return res.status(403).json({ message: "Not authorised" });
    }

    const caseId = req.params.caseId;
    const access = await verifyCaseAccess(caseId, req, res);
    if (!access.ok) return;

    const caseRecord = await storage.getCase(caseId);
    if (!caseRecord) {
      return res.status(404).json({ message: "Case not found" });
    }

    const existingParties = await storage.listPartiesByCase(caseId);
    const nextLetter = getNextRoleLetter(existingParties.map((p) => p.role));
    if (!nextLetter) {
      return res.status(409).json({ message: "Maximum number of parties (Z) reached for this case" });
    }

    const parsed = addPartySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid data", errors: parsed.error.flatten().fieldErrors });
    }

    const data = parsed.data;

    // Link existing user flow
    if ("userId" in data) {
      const existingUser = await storage.getUser(data.userId);
      if (!existingUser || existingUser.role !== "client") {
        return res.status(404).json({ message: "Client user not found" });
      }

      const isAlreadyPartyInCase = existingParties.some((p) => p.userId === data.userId);
      if (isAlreadyPartyInCase) {
        return res.status(409).json({ message: "This client is already a party in this case" });
      }

      let linkedClient = await storage.getClientByUserId(existingUser.id);
      if (!linkedClient) {
        linkedClient = await storage.findClientByEmail(existingUser.email);
      }
      if (!linkedClient) {
        const nameParts = (existingUser.name || "").split(" ");
        linkedClient = await storage.createClient({
          firstName: nameParts[0] || "",
          lastName: nameParts.slice(1).join(" ") || "",
          email: existingUser.email,
          userId: existingUser.id,
        });
      } else if (!linkedClient.userId) {
        await storage.updateClient(linkedClient.id, { userId: existingUser.id });
      }

      const party = await storage.createParty({
        caseId,
        clientId: linkedClient.id,
        role: nextLetter,
        portalStatus: existingUser.status === "active" ? "active" : "inactive",
      });

      await logAudit({
        userId: user.id,
        action: "link_party",
        entity: "party",
        entityId: party.id,
        entityRef: caseRecord.caseRef,
        details: `Linked existing client ${existingUser.name} (${existingUser.email}) as Party ${nextLetter} to case ${caseRecord.caseRef}`,
        ipAddress: req.ip,
      });

      await caseActivityService.log({
        caseId,
        type: "party_linked",
        title: `Party ${nextLetter} linked`,
        description: `${existingUser.name} (${existingUser.email}) was linked to this case as Party ${nextLetter}.`,
        actor: staffActor(user),
        relatedEntityId: party.id,
        relatedEntityType: "party",
      });

      return res.json({ party, role: nextLetter });
    }

    // Create new client flow
    const { firstName, lastName, email } = data;

    const existingUserWithEmail = await storage.getUserByEmail(email);
    if (existingUserWithEmail && existingUserWithEmail.role !== "client") {
      return res.status(409).json({ message: "This email belongs to a staff account and cannot be used for a client" });
    }

    if (existingUserWithEmail && existingParties.some((p) => p.userId === existingUserWithEmail.id)) {
      return res.status(409).json({ message: "This client is already a party in this case" });
    }

    const result = await clientService.createClient({
      caseId,
      role: nextLetter,
      firstName,
      lastName,
      email,
    });

    if (!result.ok) {
      return res.status(result.status || 500).json({ message: result.error });
    }

    await logAudit({
      userId: user.id,
      action: "add_party",
      entity: "party",
      entityId: result.party.id,
      entityRef: caseRecord.caseRef,
      details: `Added Party ${nextLetter} (${firstName} ${lastName}, ${email}) to case ${caseRecord.caseRef}`,
      ipAddress: req.ip,
    });

    await caseActivityService.log({
      caseId,
      type: "party_added",
      title: `Party ${nextLetter} added`,
      description: `${firstName} ${lastName} (${email}) was added to this case as Party ${nextLetter}.`,
      actor: staffActor(user),
      relatedEntityId: result.party.id,
      relatedEntityType: "party",
    });

    return res.json({ party: result.party, role: nextLetter });
  } catch (err) {
    console.error("[DemographicRoutes] Error adding party:", err);
    res.status(500).json({ message: "Failed to add party" });
  }
});

router.get("/api/clients/search-by-email", requirePermission("cases", "view"), async (req, res) => {
  const user = getUser(req);
  if (user.role !== "superadmin" && user.role !== "subadmin") {
    return res.status(403).json({ message: "Client search is restricted to administrators" });
  }
  try {
    const email = (req.query.email as string || "").trim().toLowerCase();
    if (!email || email.length < 3) {
      return res.json([]);
    }

    const allUsers = await storage.listUsers();
    const results: { id: string; name: string; email: string }[] = [];

    for (const u of allUsers) {
      if (u.role !== "client") continue;
      if (!u.email.toLowerCase().includes(email)) continue;
      results.push({
        id: u.id,
        name: u.name || u.email,
        email: u.email,
      });
      if (results.length >= 10) break;
    }

    res.json(results);
  } catch (err) {
    console.error("[DemographicRoutes] Error searching clients:", err);
    res.status(500).json({ message: "Failed to search clients" });
  }
});

export default router;
