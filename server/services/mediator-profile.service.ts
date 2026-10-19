import { mediatorProfileRepository } from "../repositories/mediator-profile.repository";
import { storage } from "../storage";
import { logAudit } from "./audit-log.service";
import type { ServiceResult } from "./types";
import {
  redactProfile, filterEditableFields, canViewTab, computeExpiryAlerts,
  validateSectionA,
  validateSectionRequired,
  validateSectionShape,
  validateSectionC, validateSectionD, validateSectionF,
  requiresMediatorProfileCompletion,
  hasPublishableMediatorBio,
  SECTION_B_FIELD_META, SECTION_C_FIELD_META,
  SECTION_E_FIELD_META, SECTION_G_FIELD_META,
  SECTION_H_FIELD_META, SECTION_I_FIELD_META,
  type MediatorRole, type MediatorTab,
} from "@shared/mediator-rbac";
import type {
  MediatorProfile, InsertMediatorProfile,
  InsertMediatorCpdEntry, InsertMediatorReference, InsertMediatorTraining,
  InsertMediatorHoliday, InsertMediatorComplaint, InsertMediatorTimebankEntry,
  MediatorBioVersion,
} from "@shared/schema";
import { MEDIATION_ROLE_QUALIFICATIONS } from "@shared/schema";

export interface ProfileViewBundle {
  profile: Partial<MediatorProfile>;
  expiryAlerts: ReturnType<typeof computeExpiryAlerts>;
  visibleTabs: MediatorTab[];
}

const ALL_TABS: MediatorTab[] = [
  "profile", "edi", "credentials", "service_offering",
  "bio", "availability", "contracts", "payment", "compliance",
];

// Auto-derive bio fields (tags, years of experience, language list) whenever
// any of the source fields change. Targets canonical schema columns
// (bioAutoTags, bioYearsOfExperience, languagesSpoken) and reads from
// canonical sources (fmcAccreditationStatus, fmcAccreditationDate,
// mediationTypes, specialisms, ediFirstLanguage). Merged into the patch BEFORE
// the DB write so the audit trail captures derivations as one save.
function deriveBioAutoFields(
  before: Record<string, unknown> | null | undefined,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const SOURCE_FIELDS = [
    "fmcAccreditationStatus", "fmcAccreditationDate",
    "mediationTypes", "specialisms",
    "ediFirstLanguage", "languagesSpoken", "speaksOtherLanguages",
  ];
  const touched = SOURCE_FIELDS.some((f) => f in patch);
  if (!touched) return {};

  const merged: Record<string, unknown> = { ...(before ?? {}), ...patch };
  const tags = new Set<string>();
  const status = merged.fmcAccreditationStatus as string | null | undefined;
  if (status && status !== "N/A") tags.add(status);
  for (const t of (merged.mediationTypes as string[] | null | undefined) ?? []) tags.add(t);
  for (const s of (merged.specialisms as string[] | null | undefined) ?? []) tags.add(s);

  // Years of experience derived from FMC accreditation date.
  const refDateStr = merged.fmcAccreditationDate as string | Date | null | undefined;
  let yoe: number | null = null;
  if (refDateStr) {
    const ref = new Date(refDateStr);
    if (!isNaN(ref.getTime())) {
      yoe = Math.max(0, Math.floor((Date.now() - ref.getTime()) / (365.25 * 24 * 60 * 60 * 1000)));
    }
  }

  // Combined language list: first language (from EDI section) + any additional
  // languages the mediator entered in the bio "languages spoken" field.
  const languages: string[] = [];
  if (merged.ediFirstLanguage) languages.push(String(merged.ediFirstLanguage));
  for (const l of (merged.languagesSpoken as string[] | null | undefined) ?? []) {
    if (l && !languages.includes(l)) languages.push(l);
  }

  return {
    bioAutoTags: Array.from(tags),
    bioYearsOfExperience: yoe,
    languagesSpoken: languages,
  };
}

// Compliance side-effects: PI insurance lapse auto-flips panel status to
// "Paused — PI lapsed" and removes the mediator from the allocation pool.
// Returns extra fields to merge into the patch.
function derivePiLapseSideEffects(
  before: Record<string, unknown> | null | undefined,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  // Canonical schema field is `piExpiryDate` (text).
  const expiry = (("piExpiryDate" in patch ? patch.piExpiryDate : before?.piExpiryDate) ?? null) as string | Date | null;
  if (!expiry) return {};
  const expiryDate = new Date(expiry);
  if (isNaN(expiryDate.getTime())) return {};
  const now = new Date();
  const lapsed = expiryDate.getTime() < now.getTime();
  const currentPanel = (("panelStatus" in patch ? patch.panelStatus : before?.panelStatus) ?? "Active") as string;
  if (lapsed && currentPanel !== "Paused — PI lapsed" && currentPanel !== "Off-boarded" && currentPanel !== "Inactive") {
    return { panelStatus: "Paused — PI lapsed", panelStatusReason: "PI insurance expired on " + expiryDate.toISOString().slice(0, 10) };
  }
  // If PI was renewed and the previous pause was specifically because of a PI lapse, restore Active.
  if (!lapsed && currentPanel === "Paused — PI lapsed") {
    return { panelStatus: "Active", panelStatusReason: null };
  }
  return {};
}

function diffFields(oldRow: Record<string, unknown> | null | undefined, newPatch: Record<string, unknown>) {
  const changes: Array<{ field: string; old: unknown; new: unknown }> = [];
  for (const k of Object.keys(newPatch)) {
    const o = oldRow?.[k] ?? null;
    const n = newPatch[k] ?? null;
    if (JSON.stringify(o) !== JSON.stringify(n)) {
      changes.push({ field: k, old: o, new: n });
    }
  }
  return changes;
}

export const mediatorProfileService = {
  async getView(targetUserId: string, actorRole: MediatorRole, actorUserId: string): Promise<ProfileViewBundle | null> {
    const target = await storage.getUser(targetUserId);
    if (!target || target.role !== "mediator") return null;
    if (actorRole === "mediator" && actorUserId !== targetUserId) return null;

    let profile = await mediatorProfileRepository.getProfile(targetUserId);
    if (!profile) {
      // Bootstrap an empty profile so the page always has something to render.
      profile = await mediatorProfileRepository.upsertProfile(targetUserId, {
        firstName: target.name?.split(" ")[0] ?? null,
        lastName: target.name?.split(" ").slice(1).join(" ") || null,
      });
    }

    // Task #222 — back-compat read fallbacks (pure derivation, never persisted):
    //   • If structured `geographicCoverageAreas` is empty but the legacy
    //     `geographicCoverage` free-text column has content, surface the text
    //     split into discrete entries so the new multi-select shows existing
    //     data to admins. Stored value is left untouched.
    //   • Normalize any legacy `Form C100` entry in `courtFormPackages` to the
    //     canonical short label `C100` so the picker can render it.
    const p = profile as unknown as Record<string, unknown>;
    const areas = p.geographicCoverageAreas;
    const legacyText = p.geographicCoverage;
    if ((!Array.isArray(areas) || areas.length === 0) && typeof legacyText === "string" && legacyText.trim() !== "") {
      p.geographicCoverageAreas = legacyText
        .split(/[,;\n]+/)
        .map((s) => s.trim())
        .filter(Boolean);
    }
    const forms = p.courtFormPackages;
    if (Array.isArray(forms) && forms.includes("Form C100")) {
      p.courtFormPackages = forms.map((f) => (f === "Form C100" ? "C100" : f));
    }

    // Task #226 — back-compat seed for the per-day working-hours map. If the
    // new column is empty but the legacy global start/end pair is set, project
    // the legacy pair over every working day so existing mediators don't
    // suddenly see "missing required field" errors. Pure derivation — the
    // seeded value is only persisted when the mediator actively re-saves.
    const hoursMap = p.workingHoursByDay;
    const days = p.workingDays;
    const legacyStart = p.workingHoursStart;
    const legacyEnd = p.workingHoursEnd;
    if (
      (!hoursMap || typeof hoursMap !== "object" || Object.keys(hoursMap as object).length === 0) &&
      typeof legacyStart === "string" && legacyStart !== "" &&
      typeof legacyEnd === "string" && legacyEnd !== "" &&
      Array.isArray(days) && days.length > 0
    ) {
      const seeded: Record<string, { start: string; end: string }> = {};
      for (const d of days as string[]) seeded[d] = { start: legacyStart, end: legacyEnd };
      p.workingHoursByDay = seeded;
    }

    const visibleTabs = ALL_TABS.filter((t) => canViewTab(t, actorRole, actorUserId, targetUserId));
    const redacted = redactProfile(profile as unknown as Record<string, unknown>, actorRole, actorUserId, targetUserId);
    // Task #214 — `email` lives on the users table, not mediator_profiles.
    // Inject it into the bundle so the Profile tab can render it inline.
    (redacted as Record<string, unknown>).email = target.email;
    // Task #226 — `zoomLink` + calendar status also live on `users`.
    // Inject them so the Availability tab can render the Zoom row and the
    // calendar-sync mini-card without a second round-trip.
    (redacted as Record<string, unknown>).zoomLink = target.zoomLink ?? null;
    (redacted as Record<string, unknown>).googleCalendarConnected = !!target.googleCalendarConnected;
    (redacted as Record<string, unknown>).googleCalendarEmail = target.googleCalendarEmail ?? null;
    (redacted as Record<string, unknown>).lastCalendarSyncAt = target.lastCalendarSyncAt ?? null;
    (redacted as Record<string, unknown>).lastCalendarSyncError = target.lastCalendarSyncError ?? null;
    (redacted as Record<string, unknown>).outlookCalendarConnected = !!target.outlookCalendarConnected;
    (redacted as Record<string, unknown>).outlookCalendarEmail = target.outlookCalendarEmail ?? null;
    (redacted as Record<string, unknown>).lastOutlookSyncAt = target.lastOutlookSyncAt ?? null;
    (redacted as Record<string, unknown>).lastOutlookSyncError = target.lastOutlookSyncError ?? null;
    (redacted as Record<string, unknown>).activeCalendarProvider = target.activeCalendarProvider ?? null;
    const expiryAlerts = actorRole === "client" ? [] : computeExpiryAlerts(profile as unknown as Record<string, unknown>);
    return { profile: redacted as Partial<MediatorProfile>, expiryAlerts, visibleTabs };
  },

  async updateProfile(
    targetUserId: string,
    patch: Partial<InsertMediatorProfile>,
    actorRole: MediatorRole,
    actorUserId: string,
  ): Promise<{ ok: true; profile: MediatorProfile } | { ok: false; status: number; error: string }> {
    const target = await storage.getUser(targetUserId);
    if (!target || target.role !== "mediator") return { ok: false, status: 404, error: "Mediator not found" };

    const allowed = filterEditableFields(patch as Record<string, unknown>, actorRole, actorUserId, targetUserId);
    if (Object.keys(allowed).length === 0) {
      return { ok: false, status: 403, error: "No editable fields in request" };
    }

    // Task #214 — Section A validation (name lengths, email shape, phone shape,
    // dob plausibility). Runs before any DB writes so a single bad field
    // rejects the whole patch.
    const sectionAErrors = validateSectionA(allowed as Record<string, unknown>);
    if (sectionAErrors.length > 0) {
      return { ok: false, status: 400, error: sectionAErrors.map((e) => e.message).join("; ") };
    }

    // Task #217 — Sections B-I mandatory + shape check. Only fires for keys
    // present in `allowed`, so single-tab partial saves are never blocked by
    // empty fields belonging to another section. Shape rules (date/URL/
    // email/sortcode/etc.) come from the same metadata tables that drive the
    // client UI, so client and server stay in lockstep.
    const allowedRec = allowed as Record<string, unknown>;
    const requireComplete = requiresMediatorProfileCompletion(actorRole);
    if (
      "mediationRoleQualification" in allowedRec
      && !(MEDIATION_ROLE_QUALIFICATIONS as readonly unknown[]).includes(allowedRec.mediationRoleQualification)
    ) {
      return { ok: false, status: 400, error: "Invalid mediation role qualification" };
    }
    // Task #226 — Calendar sync is a Y-mandatory Section F requirement. The
    // `calendarConnected` key is metadata-only (synthetic, never in patch), so
    // `validateSectionRequired` can't enforce it. Instead, gate any write that
    // touches a Section F field on the live active connected provider
    // flag — this stops API callers (cURL, scripts, future mobile client)
    // from bypassing the UI's inline check.
    const SECTION_F_PATCH_KEYS = new Set([
      "workingDays", "workingHoursByDay", "workingHoursStart", "workingHoursEnd",
      "hoursPerWeekCap", "zoomLink",
    ]);
    const touchesSectionF = Object.keys(allowedRec).some((k) => SECTION_F_PATCH_KEYS.has(k));
    const activeCalendarReady = (target.activeCalendarProvider === "google" && !!target.googleCalendarConnected)
      || (target.activeCalendarProvider === "outlook" && !!target.outlookCalendarConnected);
    if (requireComplete && touchesSectionF && !activeCalendarReady) {
      return {
        ok: false,
        status: 400,
        error: "Calendar sync is required for Section F (Availability) — connect or choose your active calendar before saving availability or Zoom link changes.",
      };
    }
    // Task #219 — Section C uses a dedicated validator so the conditional
    // "WTA → PPC supervisor block mandatory" rule can read the merged
    // (existing + patch) accreditation status from the loaded profile.
    const beforeForValidation = await mediatorProfileRepository.getProfile(targetUserId);
    const sectionMetas = [
      SECTION_B_FIELD_META,
      SECTION_E_FIELD_META, SECTION_G_FIELD_META,
      SECTION_H_FIELD_META, SECTION_I_FIELD_META,
    ];
    const sectionErrors = [
      ...sectionMetas.flatMap((m) => [
        ...(requireComplete ? validateSectionRequired(m, allowedRec) : []),
        ...validateSectionShape(m, allowedRec),
      ]),
      ...validateSectionC(allowedRec, beforeForValidation as Record<string, unknown> | null, requireComplete),
      ...validateSectionD(allowedRec, requireComplete),
      // Task #226 — Section F has its own per-day working-hours invariant
      // (every working day must have a start/end with optional lunch inside
      // the window), so it needs the merged context to validate correctly.
      ...validateSectionF(allowedRec, beforeForValidation as Record<string, unknown> | null, requireComplete),
    ];
    if (sectionErrors.length > 0) {
      return { ok: false, status: 400, error: sectionErrors.map((e) => e.message).join("; ") };
    }

    // Task #219 — Composite Credentials invariants. Only enforced when the
    // patch actually touches a Section C field, so saves to other tabs (or
    // partial bootstrap by admins still building the record) aren't blocked.
    const sectionCKeys = new Set(SECTION_C_FIELD_META.map((m) => m.key));
    const touchesSectionC = Object.keys(allowedRec).some((k) => sectionCKeys.has(k));
    if (requireComplete && touchesSectionC) {
      const [trainings, cpd, refs] = await Promise.all([
        mediatorProfileRepository.listTrainings(targetUserId),
        mediatorProfileRepository.listCpd(targetUserId),
        mediatorProfileRepository.listReferences(targetUserId),
      ]);
      const composite: string[] = [];
      if (!trainings.some((t) => t.type === "Initial")) {
        composite.push("At least one Initial mediation training record is required");
      }
      if (cpd.length === 0) {
        composite.push("At least one CPD log entry is required");
      }
      if (refs.length < 2) {
        composite.push("Two professional references are required");
      }
      if (composite.length > 0) {
        return { ok: false, status: 400, error: composite.join("; ") };
      }
    }

    // Task #226 — `zoomLink` lives on the `users` table, not mediator_profiles.
    // Validate it as an HTTPS URL, route the write through storage.updateUser,
    // then strip from the profile patch so upsertProfile doesn't try to write
    // a non-existent column. Audit-logged so the change shows up in history.
    if ("zoomLink" in allowed) {
      const rawZoom = (allowed as Record<string, unknown>).zoomLink;
      delete (allowed as Record<string, unknown>).zoomLink;
      const newZoom: string | null =
        typeof rawZoom === "string" && rawZoom.trim() !== "" ? rawZoom.trim() : null;
      if (newZoom !== null) {
        try {
          const u = new URL(newZoom);
          if (u.protocol !== "https:") throw new Error("not https");
        } catch {
          return { ok: false, status: 400, error: "Zoom link must be a valid HTTPS URL" };
        }
      }
      const oldZoom = target.zoomLink ?? null;
      if (newZoom !== oldZoom) {
        await storage.updateUser(targetUserId, { zoomLink: newZoom });
        await logAudit({
          userId: actorUserId,
          action: "update",
          entity: "mediator",
          entityId: targetUserId,
          entityRef: target.email,
          details: JSON.stringify({ field: "zoomLink", old: oldZoom, new: newZoom }),
        });
      }
    }

    // Task #214 — `email` is routed to the users table, not mediator_profiles.
    // Validate uniqueness and apply via storage.updateUser; strip from the
    // profile patch so upsertProfile doesn't try to write a non-existent column.
    if ("email" in allowed) {
      const rawEmail = (allowed as Record<string, unknown>).email;
      delete (allowed as Record<string, unknown>).email;
      if (typeof rawEmail === "string" && rawEmail.trim() !== "" && rawEmail !== target.email) {
        const trimmed = rawEmail.trim();
        const collision = await storage.getUserByEmail(trimmed);
        if (collision && collision.id !== targetUserId) {
          return { ok: false, status: 409, error: "Another user already uses this email address" };
        }
        await storage.updateUser(targetUserId, { email: trimmed });
        await logAudit({
          userId: actorUserId,
          action: "update",
          entity: "mediator",
          entityId: targetUserId,
          entityRef: trimmed,
          details: JSON.stringify({ field: "email", old: target.email, new: trimmed }),
        });
      }
    }

    const before = await mediatorProfileRepository.getProfile(targetUserId);
    // Apply auto-derivation + PI-lapse side-effects so they go through the same
    // audit pass as the user's own edits.
    const beforeRow = before as Record<string, unknown> | null;
    // Task #226 — when the per-day map changes, mirror the first working
    // day's hours back into the legacy `workingHoursStart` / `workingHoursEnd`
    // columns so the booking-engine slot derivation (which still reads the
    // global pair) stays in sync until a follow-up task migrates it.
    const workingHoursMirror: Record<string, unknown> = {};
    if ("workingHoursByDay" in allowed) {
      const map = (allowed as Record<string, unknown>).workingHoursByDay as
        | Record<string, { start?: unknown; end?: unknown }>
        | null
        | undefined;
      const mergedDays = ("workingDays" in allowed
        ? (allowed as Record<string, unknown>).workingDays
        : beforeRow?.workingDays) as string[] | null | undefined;
      const orderedDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
      const firstDay = (mergedDays ?? []).slice().sort(
        (a, b) => orderedDays.indexOf(a) - orderedDays.indexOf(b),
      )[0];
      const firstEntry = firstDay && map ? map[firstDay] : undefined;
      if (firstEntry && typeof firstEntry.start === "string" && typeof firstEntry.end === "string") {
        workingHoursMirror.workingHoursStart = firstEntry.start;
        workingHoursMirror.workingHoursEnd = firstEntry.end;
      }
    }
    const withDerived = {
      ...allowed,
      ...workingHoursMirror,
      ...deriveBioAutoFields(beforeRow, allowed),
      ...derivePiLapseSideEffects(beforeRow, allowed),
    };
    const updated = await mediatorProfileRepository.upsertProfile(targetUserId, withDerived);

    const changes = diffFields(beforeRow, withDerived);
    for (const c of changes) {
      await logAudit({
        userId: actorUserId,
        action: "update",
        entity: "mediator",
        entityId: targetUserId,
        entityRef: target.email,
        details: JSON.stringify({ field: c.field, old: c.old, new: c.new }),
      });
    }
    return { ok: true, profile: updated };
  },

  // ---------- Bio workflow ----------
  async listBioVersions(mediatorId: string) {
    return mediatorProfileRepository.listBioVersions(mediatorId);
  },

  async submitBio(mediatorId: string, actorUserId: string, payload: { bioLong?: string | null; bioShort?: string | null }): Promise<MediatorBioVersion> {
    if (!hasPublishableMediatorBio(payload.bioShort, payload.bioLong)) {
      throw Object.assign(new Error("Short bio and long bio are required for submission"), { status: 400 });
    }
    // Save the draft to a new version row in `pending` state.
    const version = await mediatorProfileRepository.createBioVersion({
      mediatorId,
      bioLong: payload.bioLong ?? null,
      bioShort: payload.bioShort ?? null,
      status: "pending",
      submittedBy: actorUserId,
      submittedAt: new Date(),
    });
    // Mirror onto the live profile copy as a draft preview.
    await mediatorProfileRepository.upsertProfile(mediatorId, {
      bioLong: payload.bioLong ?? null,
      bioShort: payload.bioShort ?? null,
      bioStatus: "pending",
    });
    await logAudit({
      userId: actorUserId, action: "update", entity: "mediator", entityId: mediatorId,
      details: JSON.stringify({ field: "bioStatus", new: "pending", versionId: version.id }),
    });
    return version;
  },

  async reviewBio(mediatorId: string, versionId: string, actorUserId: string, decision: "approved" | "rejected", reviewNotes?: string): Promise<MediatorBioVersion | undefined> {
    // Integrity check: refuse to review a bio version that does not belong to
    // the mediator named in the URL. Without this, a crafted versionId could
    // mutate another mediator's bio history.
    const owned = await mediatorProfileRepository.getBioVersion(versionId);
    if (!owned || owned.mediatorId !== mediatorId) return undefined;
    if (decision === "approved" && !hasPublishableMediatorBio(owned.bioShort, owned.bioLong)) {
      throw Object.assign(new Error("Short bio and long bio are required for approval"), { status: 400 });
    }
    const v = await mediatorProfileRepository.updateBioVersion(versionId, {
      status: decision, reviewedBy: actorUserId, reviewedAt: new Date(), reviewNotes: reviewNotes ?? null,
    });
    if (!v) return undefined;
    if (decision === "approved") {
      await mediatorProfileRepository.upsertProfile(mediatorId, {
        bioLong: v.bioLong, bioShort: v.bioShort,
        bioStatus: "approved", bioApprovedVersionId: v.id, bioApprovedAt: new Date(),
      });
    } else {
      await mediatorProfileRepository.upsertProfile(mediatorId, { bioStatus: "rejected" });
    }
    await logAudit({
      userId: actorUserId, action: "update", entity: "mediator", entityId: mediatorId,
      details: JSON.stringify({ field: "bioStatus", new: decision, versionId, reviewNotes: reviewNotes ?? null }),
    });
    return v;
  },

  // ---------- Child collection passthroughs (server filters by RBAC at the route layer) ----------
  listCpd: (id: string) => mediatorProfileRepository.listCpd(id),
  createCpd: async (id: string, actorId: string, data: Omit<InsertMediatorCpdEntry, "mediatorId">) => {
    const row = await mediatorProfileRepository.createCpd({ ...data, mediatorId: id });
    await logAudit({ userId: actorId, action: "create", entity: "mediator", entityId: id, details: JSON.stringify({ child: "cpd", row }) });
    return row;
  },
  deleteCpd: async (id: string, actorId: string, mediatorId: string) => {
    await mediatorProfileRepository.deleteCpd(id, mediatorId);
    await logAudit({ userId: actorId, action: "delete", entity: "mediator", entityId: mediatorId, details: JSON.stringify({ child: "cpd", id }) });
  },

  listReferences: (id: string) => mediatorProfileRepository.listReferences(id),
  createReference: async (id: string, actorId: string, data: Omit<InsertMediatorReference, "mediatorId">) => {
    const existing = await mediatorProfileRepository.listReferences(id);
    if (existing.length >= 2) {
      const err: Error & { status?: number } = new Error(
        "A mediator can have at most 2 references. Delete an existing reference before adding another.",
      );
      err.status = 400;
      throw err;
    }
    const row = await mediatorProfileRepository.createReference({ ...data, mediatorId: id });
    await logAudit({ userId: actorId, action: "create", entity: "mediator", entityId: id, details: JSON.stringify({ child: "reference", row }) });
    return row;
  },
  updateReference: async (id: string, actorId: string, mediatorId: string, data: Record<string, unknown>) => {
    const patch: Record<string, unknown> = { ...data };
    // Manual subadmin verification: when the status is being flipped to "verified",
    // stamp who verified it and when. Clear the stamps when moving back to any
    // non-verified status (so re-verification is a fresh action).
    if (patch.status === "verified") {
      patch.verifiedBy = actorId;
      patch.verifiedAt = new Date();
    } else if (typeof patch.status === "string" && patch.status !== "verified") {
      patch.verifiedBy = null;
      patch.verifiedAt = null;
    }
    const row = await mediatorProfileRepository.updateReference(id, mediatorId, patch);
    if (!row) return undefined;
    await logAudit({ userId: actorId, action: "update", entity: "mediator", entityId: mediatorId, details: JSON.stringify({ child: "reference", id, data: patch }) });
    return row;
  },
  deleteReference: async (id: string, actorId: string, mediatorId: string) => {
    await mediatorProfileRepository.deleteReference(id, mediatorId);
    await logAudit({ userId: actorId, action: "delete", entity: "mediator", entityId: mediatorId, details: JSON.stringify({ child: "reference", id }) });
  },

  /**
   * List the cases a mediator is currently attached to (case.mediatorId OR
   * either party's miamMediatorId / allocatedMediatorId), excluding cases
   * that are already Closed or Archived. Used by the off-boarding workflow.
   */
  async listOpenCases(mediatorId: string) {
    const [cases, parties] = await Promise.all([storage.listCases(), storage.listAllParties()]);
    const partyByCase = new Map<string, any[]>();
    for (const p of parties) {
      const arr = partyByCase.get(p.caseId) ?? [];
      arr.push(p);
      partyByCase.set(p.caseId, arr);
    }
    const open = cases.filter((c) => c.status !== "Closed" && c.status !== "Archived");
    const result: Array<{ id: string; caseRef: string; status: string; mediatorId: string | null; mediatorRoles: string[] }> = [];
    for (const c of open) {
      const roles: string[] = [];
      if (c.mediatorId === mediatorId) roles.push("primary");
      const ps = partyByCase.get(c.id) ?? [];
      for (const p of ps) {
        if (p.miamMediatorId === mediatorId) roles.push(`MIAM (${p.role || "party"})`);
        if (p.allocatedMediatorId === mediatorId) roles.push(`allocated (${p.role || "party"})`);
      }
      if (roles.length > 0) {
        result.push({ id: c.id, caseRef: c.caseRef, status: c.status, mediatorId: c.mediatorId ?? null, mediatorRoles: roles });
      }
    }
    return result;
  },

  /**
   * Off-board a mediator: validate every open case has a replacement in the
   * reassignment map, reassign cases + parties, flip panel status to
   * "Off-boarded", set users.status = inactive, and write a single audit
   * entry capturing reason + reassignment map.
   */
  async offboardMediator(
    mediatorId: string,
    actorId: string,
    payload: { reason: string; reassignments: Record<string, string>; offboardingDate?: string },
  ): Promise<ServiceResult<{ reassigned: number }>> {
    const target = await storage.getUser(mediatorId);
    if (!target || target.role !== "mediator") return { ok: false, error: "Mediator not found", status: 404 };
    if (!payload.reason?.trim()) return { ok: false, error: "An off-boarding reason is required.", status: 400 };

    const openCases = await this.listOpenCases(mediatorId);
    const map = payload.reassignments ?? {};
    const missing = openCases.filter((c) => !map[c.id] || map[c.id] === mediatorId);
    if (missing.length > 0) {
      return {
        ok: false,
        status: 409,
        error: `Every open case must be reassigned to another mediator before off-boarding. Missing: ${missing.map((c) => c.caseRef).join(", ")}`,
      };
    }

    // Validate every replacement is a real, currently-active mediator other than the target.
    const replacementIds = Array.from(new Set(Object.values(map)));
    for (const rid of replacementIds) {
      const u = await storage.getUser(rid);
      if (!u || u.role !== "mediator" || u.status !== "active") {
        return { ok: false, status: 400, error: "Each replacement must be an active mediator." };
      }
    }

    // Reassign each open case + parties. `c.mediatorId` is captured by listOpenCases
    // so we can detect when this mediator was the case's primary mediator.
    const allParties = await storage.listAllParties();
    for (const c of openCases) {
      const replacement = map[c.id];
      if (c.mediatorId === mediatorId) {
        await storage.updateCaseMediator(c.id, replacement);
      }
      const ps = allParties.filter((p) => p.caseId === c.id);
      for (const p of ps) {
        const updates: Partial<{ miamMediatorId: string; allocatedMediatorId: string }> = {};
        if (p.miamMediatorId === mediatorId) updates.miamMediatorId = replacement;
        if (p.allocatedMediatorId === mediatorId) updates.allocatedMediatorId = replacement;
        if (Object.keys(updates).length > 0) {
          await storage.updateParty(p.id, updates);
        }
      }
    }

    const offboardingDate = payload.offboardingDate || new Date().toISOString().slice(0, 10);
    await mediatorProfileRepository.upsertProfile(mediatorId, {
      panelStatus: "Off-boarded",
      panelStatusReason: payload.reason,
      offboardingDate,
      offboardingReason: payload.reason,
      lifecycleStage: "off_boarded",
    });
    await storage.updateUser(mediatorId, { status: "inactive" });

    await logAudit({
      userId: actorId,
      action: "offboard",
      entity: "mediator",
      entityId: mediatorId,
      entityRef: target.email,
      details: JSON.stringify({ reason: payload.reason, offboardingDate, reassignments: map, openCases: openCases.map((c) => ({ id: c.id, caseRef: c.caseRef, roles: c.mediatorRoles })) }),
    });

    return { ok: true, reassigned: openCases.length };
  },

  listTrainings: (id: string) => mediatorProfileRepository.listTrainings(id),
  createTraining: async (id: string, actorId: string, data: Omit<InsertMediatorTraining, "mediatorId">) => {
    const row = await mediatorProfileRepository.createTraining({ ...data, mediatorId: id });
    await logAudit({ userId: actorId, action: "create", entity: "mediator", entityId: id, details: JSON.stringify({ child: "training", row }) });
    return row;
  },
  deleteTraining: async (id: string, actorId: string, mediatorId: string) => {
    await mediatorProfileRepository.deleteTraining(id, mediatorId);
    await logAudit({ userId: actorId, action: "delete", entity: "mediator", entityId: mediatorId, details: JSON.stringify({ child: "training", id }) });
  },

  listHolidays: (id: string) => mediatorProfileRepository.listHolidays(id),
  createHoliday: async (id: string, actorId: string, data: Omit<InsertMediatorHoliday, "mediatorId">) => {
    const row = await mediatorProfileRepository.createHoliday({ ...data, mediatorId: id });
    await logAudit({ userId: actorId, action: "create", entity: "mediator", entityId: id, details: JSON.stringify({ child: "holiday", row }) });
    return row;
  },
  deleteHoliday: async (id: string, actorId: string, mediatorId: string) => {
    await mediatorProfileRepository.deleteHoliday(id, mediatorId);
    await logAudit({ userId: actorId, action: "delete", entity: "mediator", entityId: mediatorId, details: JSON.stringify({ child: "holiday", id }) });
  },

  listComplaints: (id: string) => mediatorProfileRepository.listComplaints(id),
  createComplaint: async (id: string, actorId: string, data: Omit<InsertMediatorComplaint, "mediatorId">) => {
    const row = await mediatorProfileRepository.createComplaint({ ...data, mediatorId: id });
    await logAudit({ userId: actorId, action: "create", entity: "mediator", entityId: id, details: JSON.stringify({ child: "complaint", row }) });
    return row;
  },
  deleteComplaint: async (id: string, actorId: string, mediatorId: string) => {
    await mediatorProfileRepository.deleteComplaint(id, mediatorId);
    await logAudit({ userId: actorId, action: "delete", entity: "mediator", entityId: mediatorId, details: JSON.stringify({ child: "complaint", id }) });
  },

  listTimebank: (id: string) => mediatorProfileRepository.listTimebank(id),
  createTimebank: async (id: string, actorId: string, data: Omit<InsertMediatorTimebankEntry, "mediatorId">) => {
    const row = await mediatorProfileRepository.createTimebank({ ...data, mediatorId: id });
    await logAudit({ userId: actorId, action: "create", entity: "mediator", entityId: id, details: JSON.stringify({ child: "timebank", row }) });
    return row;
  },
  deleteTimebank: async (id: string, actorId: string, mediatorId: string) => {
    await mediatorProfileRepository.deleteTimebank(id, mediatorId);
    await logAudit({ userId: actorId, action: "delete", entity: "mediator", entityId: mediatorId, details: JSON.stringify({ child: "timebank", id }) });
  },

  listConsents: (id: string) => mediatorProfileRepository.listConsents(id),
  upsertConsent: async (mediatorId: string, actorId: string, consentType: string, granted: boolean) => {
    const row = await mediatorProfileRepository.upsertConsent(mediatorId, consentType, granted);
    await logAudit({ userId: actorId, action: "update", entity: "mediator", entityId: mediatorId, details: JSON.stringify({ child: "consent", consentType, granted }) });
    return row;
  },

  // ---------- Aggregate EDI for subadmin (counts only, no row-level data) ----------
  // Privacy/compliance: ONLY include mediators whose `edi_aggregate` consent is
  // currently granted (and not withdrawn). Mediators who have never granted
  // consent, or have explicitly withdrawn it, are excluded from all counts.
  async ediAggregate(): Promise<Record<string, Record<string, number>>> {
    const { db } = await import("../db");
    const { mediatorProfiles, mediatorConsents } = await import("@shared/schema");
    const { eq, and } = await import("drizzle-orm");
    const consented = await db.select({ mediatorId: mediatorConsents.mediatorId })
      .from(mediatorConsents)
      .where(and(eq(mediatorConsents.consentType, "edi_aggregate"), eq(mediatorConsents.granted, true)));
    const allowed = new Set(consented.map((c) => c.mediatorId));
    const rows = await db.select().from(mediatorProfiles);
    const fields = ["ediSex", "ediGenderIdentity", "ediEthnicity", "ediFirstLanguage", "ediCountryOfBirth", "ediReligion", "ediSexualOrientation"] as const;
    const out: Record<string, Record<string, number>> = {};
    for (const f of fields) {
      const counts: Record<string, number> = {};
      for (const r of rows as Record<string, unknown>[]) {
        const id = r.userId as string | undefined;
        if (!id || !allowed.has(id)) continue;
        const v = (r[f] as string | null) ?? "(unspecified)";
        counts[v] = (counts[v] ?? 0) + 1;
      }
      out[f] = counts;
    }
    return out;
  },
};
