import crypto from "crypto";
import type { CaseRepresentative, InsertCaseRepresentative, UpdateCaseRepresentative, User } from "@shared/schema";
import { REPRESENTATIVE_TYPES, REPRESENTATIVE_CHANNELS } from "@shared/schema";

type RepType = (typeof REPRESENTATIVE_TYPES)[number];
type RepChannel = (typeof REPRESENTATIVE_CHANNELS)[number];
import { representativeRepository, type UpdateRepresentativeRow } from "../repositories/representative.repository";
import { clientRepresentativeRepository } from "../repositories/client-representative.repository";
import { clientRepresentativeService } from "./client-representative.service";
import { storage } from "../storage";
import { logAudit } from "./audit-log.service";
import { sendRepresentativeConsentRequestEmail } from "./email.service";

const STAFF_ROLES = new Set(["superadmin", "subadmin"]);

/**
 * Public-facing representative shape — strips internal consent token material
 * and IP from API responses. Staff and clients alike never need these fields
 * client-side; they exist only for server-side flow control + audit.
 */
export type PublicCaseRepresentative = Omit<
  CaseRepresentative,
  "consentTokenHash" | "consentTokenExpiresAt" | "consentDecisionIp"
>;
function toPublic(r: CaseRepresentative): PublicCaseRepresentative {
  const { consentTokenHash, consentTokenExpiresAt, consentDecisionIp, ...rest } = r;
  return rest;
}

export type RepActorContext = {
  user: User;
  caseId: string;
};

/** Single helper for token hashing so the algorithm lives in one place. */
function hashConsentToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Visibility rules for representatives (server-enforced — never trust the client):
 *   - superadmin / subadmin → see ALL reps on the case
 *   - mediator              → see ALL reps on the case ONLY when both:
 *                                 (a) cases.mediatorCanSeeReps = true, AND
 *                                 (b) the mediator is assigned to this case
 *                                     (primary mediator OR miam/allocated on any party).
 *                              Otherwise the request is rejected (case-scoped).
 *   - client portal user    → sees ONLY the reps belonging to their own party on this case
 *   - any other party (incl. another client on the same case) → never sees other parties' reps
 */
async function loadVisibilityContext(caseId: string, user: User) {
  const c = await storage.getCase(caseId);
  if (!c) return { ok: false as const, status: 404, error: "Case not found" };
  const isStaff = STAFF_ROLES.has(user.role);
  const isMediator = user.role === "mediator";
  let ownPartyId: string | null = null;

  if (isMediator) {
    const partiesForCase = await storage.listPartiesByCase(caseId);
    const isMediatorOnThisCase =
      c.mediatorId === user.id ||
      partiesForCase.some(p => p.miamMediatorId === user.id || p.allocatedMediatorId === user.id);
    if (!isMediatorOnThisCase) {
      return { ok: false as const, status: 403, error: "Not assigned to this case" };
    }
  }

  if (user.role === "client") {
    const partiesForCase = await storage.listPartiesByCase(caseId);
    const own = partiesForCase.find(p => p.userId === user.id);
    if (!own) return { ok: false as const, status: 403, error: "Not a party on this case" };
    ownPartyId = own.id;
  }
  return { ok: true as const, caseRecord: c, isStaff, isMediator, ownPartyId };
}

export const representativeService = {
  async listVisibleByCase(caseId: string, user: User) {
    const ctx = await loadVisibilityContext(caseId, user);
    if (!ctx.ok) return ctx;
    const all = await representativeRepository.listByCase(caseId);
    let visible: CaseRepresentative[];
    if (ctx.isStaff) visible = all;
    else if (ctx.isMediator) visible = ctx.caseRecord.mediatorCanSeeReps ? all : [];
    else if (ctx.ownPartyId) visible = all.filter(r => r.partyId === ctx.ownPartyId);
    else visible = [];
    // Strip internal token + IP fields from every API response.
    return { ok: true as const, reps: visible.map(toPublic) };
  },

  /**
   * Authorise a write (create/update/delete/send-consent) against a (case, party).
   * Staff can write any rep. Clients can only write reps for their own party.
   * Mediators are read-only on reps (returns 403).
   */
  async assertCanMutate(caseId: string, partyId: string, user: User) {
    const ctx = await loadVisibilityContext(caseId, user);
    if (!ctx.ok) return ctx;
    if (ctx.isStaff) return { ok: true as const };
    if (ctx.isMediator) return { ok: false as const, status: 403, error: "Mediators cannot modify representatives" };
    if (ctx.ownPartyId && ctx.ownPartyId === partyId) return { ok: true as const };
    return { ok: false as const, status: 403, error: "Not permitted to modify this representative" };
  },

  /**
   * Create a case-attachment. Task #202: this is now a two-step write —
   *   1. Upsert the client-owned master record (`client_representatives`)
   *      keyed by `(clientId, lower(email), lower(fullName))`.
   *   2. Insert the `case_representatives` row with `clientRepresentativeId`
   *      pointing at the master.
   * The same solicitor used on case 1 and case 2 will only ever produce one
   * master row — case 2's "Add" reuses it. Audit log records both the
   * attach (always) and the master create (only on first sighting).
   */
  async create(caseId: string, data: InsertCaseRepresentative, user: User) {
    const auth = await this.assertCanMutate(caseId, data.partyId, user);
    if (!auth.ok) return auth;
    const partiesForCase = await storage.listPartiesByCase(caseId);
    const party = partiesForCase.find(p => p.id === data.partyId);
    if (!party) {
      return { ok: false as const, status: 400, error: "Party does not belong to this case" };
    }
    // 1) Upsert the master Rolodex entry for this client.
    const upsert = await clientRepresentativeService.upsertForClient(party.clientId, {
      type: data.type,
      fullName: data.fullName,
      roleTitle: data.roleTitle ?? null,
      organisation: data.organisation ?? null,
      email: data.email ?? null,
      phone: data.phone ?? null,
      phoneCode: data.phoneCode ?? null,
      addressLine1: data.addressLine1 ?? null,
      addressLine2: data.addressLine2 ?? null,
      city: data.city ?? null,
      postcode: data.postcode ?? null,
      country: data.country ?? null,
    }, user);
    // 2) Write the per-case attachment, back-linked to the master.
    const created = await representativeRepository.create({
      ...data,
      caseId,
      createdBy: user.id,
      clientRepresentativeId: upsert.master.id,
    });
    await logAudit({
      userId: user.id,
      action: "attach_representative",
      entity: "case_representative",
      entityId: created.id,
      entityRef: caseId,
      details: JSON.stringify({
        clientRepresentativeId: upsert.master.id,
        masterCreated: upsert.created,
        partyId: created.partyId,
        fullName: created.fullName,
      }),
    });
    return { ok: true as const, rep: toPublic(created) };
  },

  /**
   * Edit a case-attachment. Person-level fields (name / org / email / phone /
   * address / type) mirror back to the master record so every other case the
   * rep is attached to picks up the new contact details. Attachment-only
   * fields (`notes`, `preferredChannel`) stay scoped to this case.
   */
  async update(id: string, patch: UpdateCaseRepresentative, user: User) {
    const existing = await representativeRepository.getById(id);
    if (!existing) return { ok: false as const, status: 404, error: "Representative not found" };
    const auth = await this.assertCanMutate(existing.caseId, existing.partyId, user);
    if (!auth.ok) return auth;
    const updated = await representativeRepository.update(id, patch);
    // Task #202: mirror person-level fields BOTH ways from a case-detail
    // edit:
    //   (a) UP to the master `client_representatives` row, so the Rolodex
    //       always shows canonical contact details;
    //   (b) OUT to every SIBLING `case_representatives` attachment of the
    //       same master, so an edit on case A also lands on case B without
    //       the staff member having to re-edit each card.
    // Attachment-local fields (`notes`, `preferredChannel`, consent state)
    // are intentionally NOT mirrored — they live per-case.
    // Explicit nulls / empty strings ARE included so that clearing a field
    // (e.g. removing a stale email) propagates as a clear, not a no-op.
    if (existing.clientRepresentativeId) {
      const mirrorableKeys = [
        "type", "fullName", "roleTitle", "organisation",
        "email", "phone", "phoneCode",
        "addressLine1", "addressLine2", "city", "postcode", "country",
      ] as const;
      const mirror: Partial<Record<(typeof mirrorableKeys)[number], string | null>> = {};
      let touched = false;
      for (const f of mirrorableKeys) {
        const v = patch[f];
        if (v !== undefined) {
          mirror[f] = v ?? null;
          touched = true;
        }
      }
      if (touched) {
        // (a) master record
        await clientRepresentativeService.mirrorFromAttachmentEdit(
          existing.clientRepresentativeId,
          mirror,
          user,
        );
        // (b) every sibling attachment (this is idempotent for the row we
        // just updated above — Postgres accepts the redundant write).
        // `mirror` types `type`/`fullName` as nullable for symmetry with the
        // address fields, but the public PATCH schema rejects null on those —
        // they only ever land here as defined enum/string values, so the
        // narrow Repository row type is safe.
        await representativeRepository.updateByClientRepresentativeId(
          existing.clientRepresentativeId,
          mirror as UpdateRepresentativeRow,
        );
      }
    }
    await logAudit({
      userId: user.id, action: "update_representative", entity: "case_representative",
      entityId: id, entityRef: existing.caseId,
      details: JSON.stringify(patch),
    });
    return { ok: true as const, rep: toPublic(updated!) };
  },

  /**
   * Detach the rep from this case. Task #202: the master record stays in the
   * client's Rolodex — only the `case_representatives` attachment is deleted.
   * Audit action is `detach_representative` (the master `delete` lives on the
   * dedicated `/api/client-representatives/:id` DELETE endpoint).
   */
  async remove(id: string, user: User) {
    const existing = await representativeRepository.getById(id);
    if (!existing) return { ok: false as const, status: 404, error: "Representative not found" };
    const auth = await this.assertCanMutate(existing.caseId, existing.partyId, user);
    if (!auth.ok) return auth;
    await representativeRepository.deleteById(id);
    await logAudit({
      userId: user.id, action: "detach_representative", entity: "case_representative",
      entityId: id, entityRef: existing.caseId,
      details: JSON.stringify({
        type: existing.type,
        fullName: existing.fullName,
        clientRepresentativeId: existing.clientRepresentativeId,
      }),
    });
    return { ok: true as const };
  },

  /**
   * Attach an existing master record to a case (Task #202). Used by the
   * "Pick from existing representatives" picker on case detail and the
   * "Attach to case…" action on /contacts and the staff client panel.
   */
  async attach(
    caseId: string,
    body: { clientRepresentativeId: string; partyId: string; notes?: string | null; preferredChannel?: string | null },
    user: User,
  ) {
    const auth = await this.assertCanMutate(caseId, body.partyId, user);
    if (!auth.ok) return auth;
    const partiesForCase = await storage.listPartiesByCase(caseId);
    const party = partiesForCase.find(p => p.id === body.partyId);
    if (!party) return { ok: false as const, status: 400, error: "Party does not belong to this case" };
    const master = await clientRepresentativeRepository.getById(body.clientRepresentativeId);
    if (!master) return { ok: false as const, status: 404, error: "Representative not found" };
    if (master.clientId !== party.clientId) {
      return { ok: false as const, status: 400, error: "This representative belongs to a different client" };
    }
    // Block double-attach: if there's already an attachment of this master to
    // this case, just return it (idempotent for double-clicks).
    const existing = await representativeRepository.listByCase(caseId);
    const dup = existing.find(r => r.clientRepresentativeId === master.id && r.partyId === body.partyId);
    if (dup) return { ok: true as const, rep: toPublic(dup), alreadyAttached: true as const };
    const created = await representativeRepository.create({
      caseId,
      partyId: body.partyId,
      clientRepresentativeId: master.id,
      type: master.type as RepType,
      fullName: master.fullName,
      roleTitle: master.roleTitle,
      organisation: master.organisation,
      email: master.email,
      phone: master.phone,
      phoneCode: master.phoneCode,
      addressLine1: master.addressLine1,
      addressLine2: master.addressLine2,
      city: master.city,
      postcode: master.postcode,
      country: master.country,
      notes: body.notes ?? null,
      preferredChannel: (body.preferredChannel ?? "email") as RepChannel,
      createdBy: user.id,
    });
    await logAudit({
      userId: user.id,
      action: "attach_representative",
      entity: "case_representative",
      entityId: created.id,
      entityRef: caseId,
      details: JSON.stringify({
        clientRepresentativeId: master.id,
        partyId: body.partyId,
        masterCreated: false,
        fullName: master.fullName,
        source: "pick-existing",
      }),
    });
    return { ok: true as const, rep: toPublic(created), alreadyAttached: false as const };
  },

  async sendConsent(id: string, user: User) {
    const existing = await representativeRepository.getById(id);
    if (!existing) return { ok: false as const, status: 404, error: "Representative not found" };
    const auth = await this.assertCanMutate(existing.caseId, existing.partyId, user);
    if (!auth.ok) return auth;
    if (!existing.email) return { ok: false as const, status: 400, error: "Representative has no email — add one before sending consent" };

    // 32-byte cryptographic random token; URL carries plaintext, DB stores sha256 hash.
    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = hashConsentToken(token);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
    const baseUrl = process.env.APP_URL || "";
    const consentUrl = `${baseUrl}/consent/representative/${token}`;
    const caseRecord = await storage.getCase(existing.caseId);
    const sent = await sendRepresentativeConsentRequestEmail(existing.email, existing.fullName, consentUrl, caseRecord?.caseRef);

    // NB: never persist `consentUrl` — the URL embeds the raw token. Only the
    // sha256 hash is stored so a DB read leak cannot grant consent.
    const updated = await representativeRepository.update(id, {
      consentTokenHash: tokenHash,
      consentTokenExpiresAt: expiresAt,
      consentRequestSentAt: new Date(),
      consentStatus: "sent",
    });
    await logAudit({
      userId: user.id, action: "send_rep_consent", entity: "case_representative",
      entityId: id, entityRef: existing.caseId,
      details: JSON.stringify({ sentTo: existing.email, emailDelivered: sent }),
    });
    return { ok: true as const, rep: toPublic(updated!), emailSent: sent };
  },

  /**
   * Validate a consent link without mutating state. Used by the public landing GET
   * so email-link prefetchers cannot accidentally grant consent.
   */
  async lookupByToken(token: string) {
    const tokenHash = hashConsentToken(token);
    const rep = await representativeRepository.getByConsentTokenHash(tokenHash);
    if (!rep) return { ok: false as const, status: 404, error: "Invalid or expired consent link" };
    if (!rep.consentTokenExpiresAt || new Date(rep.consentTokenExpiresAt) < new Date()) {
      return { ok: false as const, status: 410, error: "This consent link has expired" };
    }
    return { ok: true as const, rep };
  },

  async respondToConsent(token: string, decision: "granted" | "withdrawn" | "refused", responderIp: string | null) {
    const lookup = await this.lookupByToken(token);
    if (!lookup.ok) return lookup;
    const rep = lookup.rep;
    // Token-lifecycle policy:
    //   - "granted"  → token stays valid until its original expiry so the
    //                  recipient can return to the same link to *withdraw*
    //                  consent later. This is the GDPR-mandated reversibility
    //                  path and should not require an admin to re-issue a link.
    //   - "withdrawn" / "refused" → terminal decisions; the token is burned so
    //                  the link can't be replayed to flip back to "granted"
    //                  without a fresh admin-initiated send.
    const terminal = decision !== "granted";
    const updated = await representativeRepository.update(rep.id, {
      consentStatus: decision,
      consentDecidedAt: new Date(),
      consentDecisionIp: responderIp,
      consentTokenHash: terminal ? null : rep.consentTokenHash,
      consentTokenExpiresAt: terminal ? null : rep.consentTokenExpiresAt,
    });
    const action = decision === "granted" ? "rep_consent_granted"
      : decision === "withdrawn" ? "rep_consent_withdrawn"
      : "rep_consent_refused";
    await logAudit({
      userId: null, action, entity: "case_representative",
      entityId: rep.id, entityRef: rep.caseId,
      details: JSON.stringify({ representativeName: rep.fullName, ip: responderIp }),
    });
    return { ok: true as const, rep: toPublic(updated!), fullName: rep.fullName };
  },

  /**
   * Client-portal: return the authenticated client's master Rolodex with the
   * case attachments listed underneath each master record (Task #202 reshape).
   *
   * Shape:
   *   { master: ClientRepresentative,
   *     attachments: Array<{
   *       caseId, caseRef, caseStatus, issueType, partyId, partyRole,
   *       attachmentId, consentStatus, notes, preferredChannel,
   *       otherParties: [{role,name}],
   *     }>,
   *     myCases: Array<{caseId, caseRef, partyId, partyRole}>  // for the
   *                                                            // "Attach to case…" picker
   *   }
   */
  async listMineForClient(user: User) {
    if (user.role !== "client") {
      return { ok: false as const, status: 403, error: "Only clients can use this endpoint" };
    }
    const ownClient = await storage.getClientByUserId(user.id);
    if (!ownClient) {
      return { ok: true as const, masters: [], myCases: [], ownClientId: "" };
    }
    // Pull every master record this client owns…
    const masters = await clientRepresentativeRepository.listByClient(ownClient.id);
    // …and every case the client is a party on, plus the other side's name.
    const myParties = await storage.listPartiesByUserId(user.id);
    const myCases: Array<{ caseId: string; caseRef: string; caseStatus: string; partyId: string; partyRole: string; issueType: string | null; otherParties: Array<{ role: string; name: string }> }> = [];
    for (const p of myParties) {
      const c = await storage.getCase(p.caseId);
      if (!c) continue;
      const allParties = await storage.listPartiesByCase(p.caseId);
      const otherParties = allParties
        .filter(other => other.id !== p.id)
        .map(other => ({
          role: (other.role || "").toUpperCase(),
          name: [other.firstName, other.lastName].filter(Boolean).join(" ").trim(),
        }))
        .filter(o => o.name.length > 0);
      myCases.push({
        caseId: c.id,
        caseRef: c.caseRef,
        caseStatus: c.status,
        partyId: p.id,
        partyRole: (p.role || "").toUpperCase(),
        issueType: c.issueType ?? null,
        otherParties,
      });
    }
    // For each master, find every attachment that belongs to one of the
    // client's cases on their own party (never another party's reps).
    const mastersOut = [];
    for (const master of masters) {
      const attachments: Array<{
        attachmentId: string;
        caseId: string;
        caseRef: string;
        caseStatus: string;
        issueType: string | null;
        partyId: string;
        partyRole: string;
        consentStatus: string;
        notes: string | null;
        preferredChannel: string | null;
        otherParties: Array<{ role: string; name: string }>;
      }> = [];
      for (const myCase of myCases) {
        const reps = await representativeRepository.listByCase(myCase.caseId);
        const matched = reps.filter(r =>
          r.clientRepresentativeId === master.id && r.partyId === myCase.partyId,
        );
        for (const att of matched) {
          attachments.push({
            attachmentId: att.id,
            caseId: myCase.caseId,
            caseRef: myCase.caseRef,
            caseStatus: myCase.caseStatus,
            issueType: myCase.issueType,
            partyId: myCase.partyId,
            partyRole: myCase.partyRole,
            consentStatus: att.consentStatus,
            notes: att.notes,
            preferredChannel: att.preferredChannel,
            otherParties: myCase.otherParties,
          });
        }
      }
      mastersOut.push({ master, attachments });
    }
    mastersOut.sort((a, b) => a.master.fullName.localeCompare(b.master.fullName));
    const myCasesPublic = myCases.map(c => ({
      caseId: c.caseId,
      caseRef: c.caseRef,
      caseStatus: c.caseStatus,
      partyId: c.partyId,
      partyRole: c.partyRole,
      otherParties: c.otherParties,
    }));
    myCasesPublic.sort((a, b) => a.caseRef.localeCompare(b.caseRef));
    return { ok: true as const, masters: mastersOut, myCases: myCasesPublic, ownClientId: ownClient.id };
  },

  async setMediatorVisibility(caseId: string, value: boolean, user: User) {
    if (!STAFF_ROLES.has(user.role)) {
      return { ok: false as const, status: 403, error: "Only superadmin / subadmin can change this setting" };
    }
    const c = await storage.getCase(caseId);
    if (!c) return { ok: false as const, status: 404, error: "Case not found" };
    const previous = c.mediatorCanSeeReps ?? false;
    if (previous === value) {
      // No-op — don't pollute the audit log with redundant rows.
      return { ok: true as const, mediatorCanSeeReps: value };
    }
    await storage.updateCaseMediatorRepVisibility(caseId, value);
    await logAudit({
      userId: user.id, action: "update_mediator_rep_visibility", entity: "case",
      entityId: caseId, entityRef: c.caseRef,
      details: JSON.stringify({
        field: "mediatorCanSeeReps",
        previous,
        next: value,
      }),
    });
    return { ok: true as const, mediatorCanSeeReps: value };
  },
};
