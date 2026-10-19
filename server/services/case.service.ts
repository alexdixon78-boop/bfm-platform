import { storage } from "../storage";
import { stripInviteFields } from "../utils/helpers";
import { compareRoleLetters, getNextRoleLetter } from "../utils/case-ref";
import type { ServiceResult } from "./types";
import { isMojVoucherEligibleCase, type Case, type Party, type MiamRecord, type PaginationParams, type PaginatedResponse, type CaseFilters } from "@shared/schema";
import type { HardDeleteCaseCounts, CaseScope } from "../repositories/case.repository";
import { calculateMiamExpiry, getMiamValiditySourceDate, isMiamValidForCourtAction } from "./appointment-rules";
import { mediationSessionService } from "./mediation-session.service";
import { normalizeFamilyCaseSubtype } from "./booking-onboarding";
import { computeCimEligibilityReadiness, type CimEligibilityReadiness } from "./cim-eligibility.service";
import { classifyCaseAccess, getPrivateNoteScope } from "../security/case-access-policy";
import { buildClientCaseDetail, buildClientCaseSummary, buildMiamMediatorPartyView, buildSessionParticipantCaseDetail, buildSessionParticipantPartyView } from "../security/case-visibility";

type EnrichedParty = Party & { miamMediatorName: string; allocatedMediatorName: string };

function isMiamSuitableForCourtValidity(value: string | null | undefined): boolean {
  const normalized = (value || "").trim().toLowerCase();
  return normalized === "yes" || normalized === "suitable" || normalized === "true";
}

interface CaseWithParties extends Case {
  partyA?: Party;
  partyB?: Party;
  parties: Party[];
  mediatorName: string;
}

export type MiamValidityForCourtAction = {
  valid: boolean;
  sourceDate: Date | null;
  expiresAt: Date | null;
  miamCompletedDate: Date | null;
  latestMediationSessionDate: Date | null;
  renewalBookingAvailable: boolean;
  parties: PartyMiamValidity[];
};

export type PartyMiamValidity = {
  partyId: string;
  role: string;
  partyName: string;
  miamRecordId: string | null;
  valid: boolean;
  expired: boolean;
  sourceDate: Date | null;
  expiresAt: Date | null;
  miamCompletedDate: Date | null;
  latestMediationSessionDate: Date | null;
  renewalBookingAvailable: boolean;
};

export type CaseCimReadiness = CimEligibilityReadiness & {
  cimEligible: boolean;
  consents: Awaited<ReturnType<typeof storage.listCaseCimConsents>>;
};

export class CaseService {
  /**
   * Task #163 — SQL-level filtered listing with permission scope AND-composed
   * at the DB layer so out-of-scope rows can never leak via filter probing.
   */
  async listCasesForUser(
    user: { id: string; role: string },
    params: PaginationParams,
    filters: CaseFilters = {},
  ): Promise<PaginatedResponse<any>> {
    const isAdminUser = user.role === "superadmin" || user.role === "subadmin";
    const hasAllCaseScope = isAdminUser || user.role === "staff";
    const scope: CaseScope = hasAllCaseScope
      ? { kind: "all" }
      : user.role === "mediator"
      ? { kind: "mediator", userId: user.id }
      : { kind: "client", userId: user.id };

    // Search/status from legacy pagination params merge into structured filters
    // for backwards compatibility with any caller still using old shape.
    const mergedFilters: CaseFilters = {
      ...filters,
      ...(params.search && !filters.search ? { search: params.search } : {}),
      ...(params.status && !filters.statuses ? { statuses: [params.status] } : {}),
    };

    const { rows, total, statusCounts } = await storage.listCasesFiltered({
      filters: mergedFilters,
      scope,
      page: params.page,
      limit: params.limit,
      sortBy: params.sortBy,
      sortOrder: params.sortOrder,
      // Non-admins never see Archived (preserves prior behaviour).
      excludeArchivedByDefault: !hasAllCaseScope,
    });

    const userPartiesForRedaction = user.role === "client"
      ? await storage.listPartiesByUserId(user.id)
      : [];

    const enriched = await Promise.all(
      rows.map(async (c) => {
        const caseParties = (await storage.listPartiesByCase(c.id))
          .slice()
          .sort((a, b) => compareRoleLetters(a.role, b.role));
        const mediator = c.mediatorId ? await storage.getUser(c.mediatorId) : null;

        if (user.role === "client") {
          const ownParty = userPartiesForRedaction.find((party) => party.caseId === c.id);
          if (!ownParty) return null;
          return buildClientCaseSummary(c, ownParty, mediator?.name || "Unassigned");
        }

        if (user.role === "mediator") {
          const access = await classifyCaseAccess(c.id, user);
          if (access.tier === "none") return null;
          if (access.tier === "session_observer" || access.tier === "session_co_mediator") {
            const visibleParties = caseParties.map(buildSessionParticipantPartyView);
            const sessionAccess = access.tier === "session_co_mediator" ? "co_mediator" : "observer";
            return {
              id: c.id,
              caseRef: c.caseRef,
              stage: c.stage,
              status: c.status,
              issueType: c.issueType,
              mediationCategory: c.mediationCategory,
              mediatorName: mediator?.name || "Unassigned",
              partyA: visibleParties.find((party) => String(party.role).toUpperCase() === "A"),
              partyB: visibleParties.find((party) => String(party.role).toUpperCase() === "B"),
              parties: visibleParties,
              isSessionObserverOnly: sessionAccess === "observer",
              isSessionCoMediator: sessionAccess === "co_mediator",
              sessionAccess,
            };
          }
          if (access.tier === "miam_only_mediator") {
            const visibleParties = caseParties
              .filter((party) => access.partyIds.includes(party.id))
              .map(buildMiamMediatorPartyView);
            return {
              id: c.id,
              caseRef: c.caseRef,
              stage: c.stage,
              status: c.status,
              issueType: c.issueType,
              mediationCategory: c.mediationCategory,
              createdAt: c.createdAt,
              lastUpdated: c.lastUpdated,
              mediatorName: mediator?.name || "Unassigned",
              partyA: visibleParties.find((party) => String(party.role).toUpperCase() === "A"),
              partyB: visibleParties.find((party) => String(party.role).toUpperCase() === "B"),
              parties: visibleParties,
              isMiamOnlyMediator: true,
            };
          }
        }

        let visibleParties: Party[] = caseParties;
        let userPartyRole: string | undefined;

        const isAdmin = user.role === "superadmin" || user.role === "subadmin";
        if (!isAdmin) {
          visibleParties = visibleParties.map((p) => stripInviteFields(p));
        }

        const partyA = visibleParties.find(p => (p.role || "").toUpperCase() === "A");
        const partyB = visibleParties.find(p => (p.role || "").toUpperCase() === "B");

        return {
          ...c,
          partyA,
          partyB,
          parties: visibleParties,
          mediatorName: mediator?.name || "Unassigned",
          userPartyRole,
        } as CaseWithParties;
      })
    );

    return {
      data: enriched.filter(Boolean),
      total,
      page: params.page,
      limit: params.limit,
      totalPages: Math.ceil(total / params.limit) || 1,
      counts: statusCounts,
    };
  }

  /**
   * Recompute the cases.* filter-cache columns from MIAM records, demographic
   * data, enquiry, and case status. Idempotent. Called from MIAM approval,
   * case-status changes, and case create. Intentionally swallows errors so
   * a cache hiccup never blocks a primary write.
   */
  async refreshCaseFilterCache(caseId: string): Promise<void> {
    try {
      const c = await storage.getCase(caseId);
      if (!c) return;

      const update: Parameters<typeof storage.updateCaseFilterCache>[1] = {};

      // Closure date can represent either full case closure or intake closure.
      if (c.status === "Closed" || c.status === "Archived" || c.intakeStatus === "Closed") {
        if (!c.closureDate) update.closureDate = c.lastUpdated ?? new Date();
      } else if (c.closureDate) {
        update.closureDate = null;
      }

      // Enquiry date — always recompute: prefer the source enquiry's
      // dateReceived (joined via convertedCaseId), fall back to case.createdAt
      // when no enquiry links here, and explicitly null otherwise so the
      // cache always reflects current truth.
      try {
        const { db } = await import("../db");
        const { enquiries } = await import("@shared/schema");
        const { eq, desc } = await import("drizzle-orm");
        const [e] = await db
          .select({ d: enquiries.dateReceived })
          .from(enquiries)
          .where(eq(enquiries.convertedCaseId, c.id))
          .orderBy(desc(enquiries.dateReceived))
          .limit(1);
        update.enquiryDate = e?.d ?? c.createdAt ?? null;
      } catch {
        update.enquiryDate = c.createdAt ?? null;
      }

      // MIAM-derived — use the *latest* approved record (most recent reviewedAt
      // or submittedAt) as the source-of-truth for funding/voucher/MIAM date.
      // Fields are *always* recomputed (set or explicitly nulled) so removing
      // an approval or unsetting a value clears the cache rather than leaving
      // stale rows that mis-match later filters.
      const miamRecs = await storage.listMiamRecordsByCase(c.id);
      const approved = miamRecs
        .filter((r) => r.approvalStatus === "approved")
        .sort((a, b) => {
          const aT = (a.reviewedAt || a.submittedAt || new Date(0)).valueOf();
          const bT = (b.reviewedAt || b.submittedAt || new Date(0)).valueOf();
          return bT - aT;
        });
      const firstApproved = approved[0];
      if (firstApproved) {
        const sd = firstApproved.sessionDate;
        const parsed = sd ? new Date(sd) : null;
        update.miamCompletedDate = parsed && !isNaN(parsed.valueOf())
          ? parsed
          : (firstApproved.reviewedAt ?? firstApproved.submittedAt ?? null);

        const legalAid = (firstApproved.legalAidApplied || "").toLowerCase();
        const moj = (firstApproved.mojVoucherApplied || "").toLowerCase();
        if (legalAid.startsWith("y")) update.fundingSource = "Legal Aid";
        else if (moj.startsWith("y")) update.fundingSource = "MOJ Voucher";
        else if (firstApproved.paymentMethod) update.fundingSource = firstApproved.paymentMethod;
        else update.fundingSource = null;

        update.voucherStatus = firstApproved.mojVoucherApplied ?? null;
      } else {
        update.miamCompletedDate = null;
        update.fundingSource = null;
        update.voucherStatus = null;
      }

      // Demographic-data-derived — explicit-null-on-absence contract for all
      // demographic-sourced fields (family/workplace sub-types, court +
      // cafcass status). Civil/commercial/other sub-types are inferred from
      // case.issueType below since the demographic schema does not yet
      // capture those (Civil/Commercial/Other intake forms).
      const parties = await storage.listPartiesByCase(c.id);
      let famSub: string | null = null;
      let wpSub: string | null = null;
      let courtStatus: string | null = null;
      let cafcassStatus: string | null = null;
      for (const p of parties) {
        const dem = await storage.getDemographicDataByParty(p.id);
        if (!dem) continue;
        const d = dem as unknown as Record<string, string | null | undefined>;
        if (!famSub && d.familyCaseSubtype) famSub = normalizeFamilyCaseSubtype(d.familyCaseSubtype);
        if (!wpSub && d.workplaceCaseSubtype) wpSub = d.workplaceCaseSubtype;
        if (!courtStatus && d.courtProceedingsStatus) courtStatus = d.courtProceedingsStatus;
        if (!cafcassStatus && d.cafcassInvolved) cafcassStatus = d.cafcassInvolved;
      }
      update.familySubType = famSub;
      update.workplaceSubType = wpSub;
      update.inCourtStatus = courtStatus;
      update.cafcassStatus = cafcassStatus;

      // Mediation category + civil/commercial/other sub-types — inferred from
      // issueType keyword mapping when demographic data is absent. All five
      // sub-type columns are written every refresh (set or null) so removing
      // an issueType reliably clears stale sub-type filtering.
      const it = (c.issueType || "").toLowerCase();
      let civilSub: string | null = null;
      let commercialSub: string | null = null;
      let otherSub: string | null = null;
      if (famSub) {
        update.mediationCategory = "Family";
      } else if (wpSub) {
        update.mediationCategory = "Workplace";
      } else if (it) {
        if (it.includes("family") || it.includes("child") || it.includes("divorce") || it.includes("separation")) {
          update.mediationCategory = "Family";
        } else if (it.includes("workplace") || it.includes("employ")) {
          update.mediationCategory = "Workplace";
        } else if (it.includes("commercial") || it.includes("business") || it.includes("contract")) {
          // Strings here MUST exactly match the canonical
          // COMMERCIAL_CASE_SUBTYPES / CIVIL_CASE_SUBTYPES / OTHER_CASE_SUBTYPES
          // constants in shared/schema.ts so the SQL equality predicate
          // matches the UI checkbox value.
          update.mediationCategory = "Commercial";
          if (it.includes("contract")) commercialSub = "Contract dispute";
          else if (it.includes("partner")) commercialSub = "Partnership dispute";
          else if (it.includes("shareholder")) commercialSub = "Shareholder dispute";
          else if (it.includes("supplier") || it.includes("customer")) commercialSub = "Supplier or customer dispute";
          else if (it.includes("intellectual") || it.includes("ip ")) commercialSub = "Intellectual property";
          else commercialSub = "Other";
        } else if (it.includes("neighbour") || it.includes("civil") || it.includes("tenant") || it.includes("landlord") || it.includes("consumer") || it.includes("personal injury")) {
          update.mediationCategory = "Civil";
          if (it.includes("neighbour")) civilSub = "Neighbour dispute";
          else if (it.includes("tenant") || it.includes("landlord")) civilSub = "Landlord & tenant";
          else if (it.includes("consumer")) civilSub = "Consumer dispute";
          else if (it.includes("injury")) civilSub = "Personal injury";
          else civilSub = "Other";
        } else if (it.includes("community")) {
          update.mediationCategory = "Other";
          otherSub = "Community";
        } else if (it.includes("educational") || it.includes("school")) {
          update.mediationCategory = "Other";
          otherSub = "Educational";
        } else {
          update.mediationCategory = "Other";
          otherSub = "Other";
        }
      } else {
        update.mediationCategory = null;
      }
      update.civilSubType = civilSub;
      update.commercialSubType = commercialSub;
      update.otherSubType = otherSub;
      const nextMediationCategory = Object.prototype.hasOwnProperty.call(update, "mediationCategory") ? update.mediationCategory : c.mediationCategory;
      const nextFamilySubType = Object.prototype.hasOwnProperty.call(update, "familySubType") ? update.familySubType : c.familySubType;
      update.mojVoucherEligible = isMojVoucherEligibleCase({
        mediationCategory: nextMediationCategory ?? null,
        familySubType: nextFamilySubType ?? null,
        issueType: c.issueType,
      });

      // MIAM completed date fallback — if no approved MIAM record exists, fall
      // back to the most recent *completed* MIAM appointment. This honours the
      // appointment-status hook contract (cache must reflect a MIAM that
      // genuinely happened, even when admin approval is still pending).
      if (!firstApproved) {
        try {
          const appts = await storage.listAppointmentsByCase(c.id);
          const serviceTypes = await storage.listServiceTypes();
          const serviceCategoryById = new Map(serviceTypes.map((s) => [s.id, s.category]));
          const completedMiam = appts
            .filter((a) => a.status === "completed")
            .filter((a) => a.serviceTypeId && serviceCategoryById.get(a.serviceTypeId) === "MIAM")
            .sort((a, b) => (b.dateTime?.valueOf() ?? 0) - (a.dateTime?.valueOf() ?? 0))[0];
          if (completedMiam?.dateTime) update.miamCompletedDate = completedMiam.dateTime;
        } catch (err) {
          console.warn("[refreshCaseFilterCache] miam appointment fallback failed", err);
        }
      }

      await storage.updateCaseFilterCache(c.id, update);
      if (update.mojVoucherEligible === false) {
        const { db } = await import("../db");
        const { mediationSessionProposals } = await import("@shared/schema");
        const { eq } = await import("drizzle-orm");
        await db
          .update(mediationSessionProposals)
          .set({ voucherFormRequired: false })
          .where(eq(mediationSessionProposals.caseId, c.id));
      }
    } catch (err) {
      console.error("[refreshCaseFilterCache] failed for case", caseId, err);
    }
  }

  async getCaseDetailForUser(caseId: string, user: { id: string; role: string }): Promise<ServiceResult<{ caseDetail: any }>> {
    const c = await storage.getCase(caseId);
    if (!c) return { ok: false, error: "Case not found", status: 404 };
    const access = await classifyCaseAccess(c.id, user);
    if (access.tier === "none") return { ok: false, error: "Access denied", status: 403 };
    const sessionAccess = await mediationSessionService.getCaseAccess(c.id, user);

    const caseParties = (await storage.listPartiesByCase(c.id))
      .slice()
      .sort((a, b) => compareRoleLetters(a.role, b.role));
    const mediator = c.mediatorId ? await storage.getUser(c.mediatorId) : null;

    if (access.tier === "session_observer" || access.tier === "session_co_mediator") {
      const participantAccess = access.tier === "session_co_mediator" ? "co_mediator" : "observer";
      const [miamRecords, miamValidity] = await Promise.all([
        storage.listMiamRecordsByCase(c.id),
        this.getMiamValidityForCourtAction(c.id),
      ]);
      return {
        ok: true,
        caseDetail: {
          ...buildSessionParticipantCaseDetail({
            caseRecord: c,
            parties: caseParties.map((party) => stripInviteFields(party)),
            mediatorName: mediator?.name || "Unassigned",
            access: participantAccess,
            miamRecords,
            miamValidity,
          }),
          privateNotesAccess: getPrivateNoteScope(access),
        },
      };
    }

    const enrichParty = async (party: Party): Promise<EnrichedParty> => {
      const miamMediator = party.miamMediatorId ? await storage.getUser(party.miamMediatorId) : null;
      const allocatedMediator = party.allocatedMediatorId ? await storage.getUser(party.allocatedMediatorId) : null;
      return { ...party, miamMediatorName: miamMediator?.name || "Unassigned", allocatedMediatorName: allocatedMediator?.name || "Unassigned" };
    };

    let enrichedParties: EnrichedParty[] = await Promise.all(caseParties.map(enrichParty));

    let userPartyRole: string | undefined;
    if (access.tier === "client_party") {
      const userPartyInCase = enrichedParties.find(p => p.userId === user.id);
      userPartyRole = userPartyInCase?.role;
      // Generalised redaction: a client only ever sees their own party (any letter).
      enrichedParties = userPartyInCase ? [userPartyInCase] : [];
    }

    if (access.tier === "miam_only_mediator") {
        // MIAM-only mediator: scope visibility to parties where they are the MIAM mediator.
        enrichedParties = enrichedParties.filter(p => access.partyIds.includes(p.id));

        const miamRecords = await storage.listMiamRecordsByCase(c.id);
        const redactContactInfo = (party: EnrichedParty): EnrichedParty => {
          const miamRec = miamRecords.find((r: MiamRecord) => r.partyId === party.id);
          const status = miamRec?.approvalStatus || "draft";
          if (status !== "draft") {
            return { ...party, email: null, phone: null, phoneCode: null };
          }
          return party;
        };
        enrichedParties = enrichedParties.map(redactContactInfo);
    }

    const isAdmin = user.role === "superadmin" || user.role === "subadmin";
    if (!isAdmin) {
      enrichedParties = enrichedParties.map((p) => stripInviteFields(p) as EnrichedParty);
    }

    const isMiamOnlyMediator = access.tier === "miam_only_mediator";

    const partyA = enrichedParties.find(p => (p.role || "").toUpperCase() === "A");
    const partyB = enrichedParties.find(p => (p.role || "").toUpperCase() === "B");
    const claimedByUser = c.claimedBy ? await storage.getUser(c.claimedBy) : null;
    const voucherClaimEligibleSetByUser = c.voucherClaimEligibleSetBy ? await storage.getUser(c.voucherClaimEligibleSetBy) : null;
    const closureRecord = await storage.getCaseClosureRecord(c.id);
    const closedByUser = closureRecord?.closedById ? await storage.getUser(closureRecord.closedById) : null;
    const miamValidity = await this.getMiamValidityForCourtAction(c.id);

    if (access.tier === "client_party") {
      const ownParty = enrichedParties.find((party) => party.id === access.partyId);
      if (!ownParty) return { ok: false, error: "Access denied", status: 403 };
      return {
        ok: true,
        caseDetail: {
          ...buildClientCaseDetail({
            caseRecord: c,
            ownParty,
            mediatorName: mediator?.name || "Unassigned",
            miamValidity,
          }),
          privateNotesAccess: getPrivateNoteScope(access),
        },
      };
    }

    if (access.tier === "miam_only_mediator") {
      const visiblePartyIds = new Set(access.partyIds);
      return {
        ok: true,
        caseDetail: {
          id: c.id,
          caseRef: c.caseRef,
          stage: c.stage,
          status: c.status,
          issueType: c.issueType,
          mediationCategory: c.mediationCategory,
          familySubType: c.familySubType,
          workplaceSubType: c.workplaceSubType,
          civilSubType: c.civilSubType,
          commercialSubType: c.commercialSubType,
          otherSubType: c.otherSubType,
          partyA: partyA ? buildMiamMediatorPartyView(partyA) : undefined,
          partyB: partyB ? buildMiamMediatorPartyView(partyB) : undefined,
          parties: enrichedParties.map(buildMiamMediatorPartyView),
          mediatorName: mediator?.name || "Unassigned",
          isMiamOnlyMediator: true,
          isSessionObserverOnly: false,
          sessionAccess: "none",
          nextRoleLetter: null,
          privateNotesAccess: getPrivateNoteScope(access),
          miamValidity: {
            ...miamValidity,
            parties: miamValidity.parties.filter((party) => visiblePartyIds.has(party.partyId)),
          },
        },
      };
    }
    const cimReadiness = isAdmin || user.role === "staff" || user.role === "mediator"
      ? await this.getCimReadiness(c.id)
      : null;
    let sourceEnquiry: { id: string; enquiryRef: string | null; contactMethod: string | null; addressLine1: string | null; postcode: string | null; dateReceived: Date | null; status: string | null; consentFollowUp: boolean | null; consentFollowUpDate: Date | null } | null = null;
    if (isAdmin) {
      try {
        const { db } = await import("../db");
        const { enquiries } = await import("@shared/schema");
        const { eq, desc } = await import("drizzle-orm");
        const [e] = await db
          .select({
            id: enquiries.id,
            enquiryRef: enquiries.enquiryRef,
            contactMethod: enquiries.contactMethod,
            addressLine1: enquiries.addressLine1,
            postcode: enquiries.postcode,
            dateReceived: enquiries.dateReceived,
            status: enquiries.status,
            consentFollowUp: enquiries.consentFollowUp,
            consentFollowUpDate: enquiries.consentFollowUpDate,
          })
          .from(enquiries)
          .where(eq(enquiries.convertedCaseId, c.id))
          .orderBy(desc(enquiries.dateReceived))
          .limit(1);
        sourceEnquiry = e || null;
      } catch {
        sourceEnquiry = null;
      }
    }

    // Compute next role letter using *all* parties (not the visibility-scoped list)
    // so admins/mediators see the correct next slot regardless of redaction above.
    const nextRoleLetter = isAdmin || user.role === "staff" || user.role === "mediator"
      ? getNextRoleLetter(caseParties.map((p) => p.role))
      : null;
    const savedPartyFollowUps = closureRecord ? await storage.listCaseClosurePartyFollowUps(c.id) : [];
    const savedPartyFollowUpByPartyId = new Map(savedPartyFollowUps.map((row) => [row.partyId, row]));
    const partyFollowUpConsents = isAdmin
      ? caseParties.map((party) => {
          const saved = savedPartyFollowUpByPartyId.get(party.id);
          if (saved) {
            return {
              partyId: party.id,
              clientId: party.clientId,
              role: party.role,
              clientName: `${party.firstName} ${party.lastName}`.trim(),
              consentStatus: saved.consentStatus,
              source: saved.consentSource,
              exclusionReason: saved.exclusionReason,
              followUpTasksScheduled: saved.followUpTasksScheduled,
              consentRecordedAt: saved.consentRecordedAt,
              followUpConsentRequestSentAt: saved.followUpConsentRequestSentAt,
              followUpConsentEmailStatus: saved.followUpConsentEmailStatus,
            };
          }
          const isClientA = (party.role || "").toUpperCase() === "A";
          if (isClientA && sourceEnquiry?.consentFollowUp) {
            return {
              partyId: party.id,
              clientId: party.clientId,
              role: party.role,
              clientName: `${party.firstName} ${party.lastName}`.trim(),
              consentStatus: "granted",
              source: "enquiry_carry_forward",
              exclusionReason: null,
              followUpTasksScheduled: 0,
              consentRecordedAt: sourceEnquiry.consentFollowUpDate,
              followUpConsentRequestSentAt: null,
              followUpConsentEmailStatus: "not_attempted",
            };
          }
          return {
            partyId: party.id,
            clientId: party.clientId,
            role: party.role,
            clientName: `${party.firstName} ${party.lastName}`.trim(),
            consentStatus: "not_captured",
            source: null,
            exclusionReason: null,
            followUpTasksScheduled: 0,
            consentRecordedAt: null,
            followUpConsentRequestSentAt: null,
            followUpConsentEmailStatus: "not_attempted",
          };
        })
      : [];

    const {
      manualRevenuePence,
      manualRevenueUpdatedBy,
      manualRevenueUpdatedAt,
      ...caseWithoutRevenue
    } = c;
    const caseDetail = {
      ...caseWithoutRevenue,
      ...(user.role === "superadmin" ? { manualRevenuePence, manualRevenueUpdatedBy, manualRevenueUpdatedAt } : {}),
      partyA,
      partyB,
      parties: enrichedParties,
      mediatorName: mediator?.name || "Unassigned",
      userPartyRole,
      isMiamOnlyMediator,
      nextRoleLetter,
      ...(isAdmin ? { sourceEnquiry } : {}),
      ...(isAdmin ? { partyFollowUpConsents } : {}),
      claimedByName: claimedByUser?.name ?? null,
      voucherClaimEligibleSetByName: voucherClaimEligibleSetByUser?.name ?? null,
      closureRecord: closureRecord
        ? {
            ...closureRecord,
            closedByName: closedByUser?.name ?? null,
          }
        : null,
      miamValidity,
      cimReadiness,
      sessionAccess,
      privateNotesAccess: getPrivateNoteScope(access),
    };

    return {
      ok: true,
      caseDetail,
    } as ServiceResult<{ caseDetail: typeof caseDetail }>;
  }

  async getMiamValidityForCourtAction(caseId: string, asOf: Date = new Date()): Promise<MiamValidityForCourtAction> {
    return this.getCaseMiamValidity(caseId, asOf);
  }

  async getCaseMiamValidity(caseId: string, asOf: Date = new Date()): Promise<MiamValidityForCourtAction> {
    const c = await storage.getCase(caseId);
    const miamCompletedDate = c?.miamCompletedDate ?? null;
    const latestMediationSessionDate = await this.getLatestCompletedMediationSessionDate(caseId);
    const parties = c ? await this.getPartyMiamValidity(caseId, asOf, latestMediationSessionDate) : [];
    const valid = parties.length > 0
      ? parties.every((party) => party.valid)
      : isMiamValidForCourtAction(miamCompletedDate, latestMediationSessionDate, asOf);
    const blockingOrSoonestParty = parties
      .filter((party) => party.expiresAt)
      .sort((a, b) => (a.expiresAt?.valueOf() ?? 0) - (b.expiresAt?.valueOf() ?? 0))[0];
    const fallbackSourceDate = getMiamValiditySourceDate(miamCompletedDate, latestMediationSessionDate);
    const sourceDate = blockingOrSoonestParty?.sourceDate ?? fallbackSourceDate;
    const expiresAt = blockingOrSoonestParty?.expiresAt ?? calculateMiamExpiry(fallbackSourceDate);

    return {
      valid,
      sourceDate,
      expiresAt,
      miamCompletedDate,
      latestMediationSessionDate,
      renewalBookingAvailable: parties.some((party) => party.renewalBookingAvailable),
      parties,
    };
  }

  async getPartyMiamValidity(
    caseId: string,
    asOf: Date = new Date(),
    latestMediationSessionDate?: Date | null,
  ): Promise<PartyMiamValidity[]> {
    const [parties, records] = await Promise.all([
      storage.listPartiesByCase(caseId),
      storage.listMiamRecordsByCase(caseId),
    ]);
    const latestSessionDate = latestMediationSessionDate === undefined
      ? await this.getLatestCompletedMediationSessionDate(caseId)
      : latestMediationSessionDate;

    return parties.map((party) => {
      const record = records.find((r) => r.partyId === party.id);
      const parsedSessionDate = record?.sessionDate ? new Date(record.sessionDate) : null;
      const miamDate = parsedSessionDate && !isNaN(parsedSessionDate.valueOf())
        ? parsedSessionDate
        : (record?.reviewedAt ?? record?.submittedAt ?? null);
      const approvedAndSuitable = record?.approvalStatus === "approved" && isMiamSuitableForCourtValidity(record.suitableForMediation);
      const sourceDate = approvedAndSuitable ? getMiamValiditySourceDate(miamDate, latestSessionDate) : null;
      const expiresAt = calculateMiamExpiry(sourceDate);
      const valid = Boolean(expiresAt && expiresAt.getTime() >= asOf.getTime());
      return {
        partyId: party.id,
        role: party.role,
        partyName: `${party.firstName || ""} ${party.lastName || ""}`.trim() || `Client ${party.role}`,
        miamRecordId: record?.id ?? null,
        valid,
        expired: Boolean(expiresAt && expiresAt.getTime() < asOf.getTime()),
        sourceDate,
        expiresAt,
        miamCompletedDate: miamDate,
        latestMediationSessionDate: latestSessionDate,
        renewalBookingAvailable: Boolean(record && expiresAt && expiresAt.getTime() < asOf.getTime()),
      };
    });
  }

  private async getLatestCompletedMediationSessionDate(caseId: string): Promise<Date | null> {
    try {
      const appts = await storage.listAppointmentsByCase(caseId);
      const serviceTypes = await storage.listServiceTypes();
      const serviceCategoryById = new Map(serviceTypes.map((s) => [s.id, s.category]));
      return appts
        .filter((a) => a.status === "completed")
        .filter((a) => a.serviceTypeId && serviceCategoryById.get(a.serviceTypeId) === "Mediation")
        .map((a) => new Date(a.dateTime))
        .filter((d) => !isNaN(d.valueOf()))
        .sort((a, b) => b.valueOf() - a.valueOf())[0] ?? null;
    } catch {
      return null;
    }
  }

  async getCimReadiness(caseId: string): Promise<CaseCimReadiness | null> {
    const c = await storage.getCase(caseId);
    if (!c) return null;
    const [parties, miamRecords, consents] = await Promise.all([
      storage.listPartiesByCase(caseId),
      storage.listMiamRecordsByCase(caseId),
      storage.listCaseCimConsents(caseId),
    ]);
    return {
      ...computeCimEligibilityReadiness({ caseRecord: c, parties, miamRecords, consents }),
      cimEligible: c.cimEligible,
      consents,
    };
  }

  async clearCimEligibilityIfNotReady(caseId: string): Promise<Case | undefined | null> {
    const c = await storage.getCase(caseId);
    if (!c?.cimEligible) return c;
    const readiness = await this.getCimReadiness(caseId);
    if (readiness?.ready) return c;
    return storage.updateCaseCimEligibility(caseId, { cimEligible: false, markedBy: null });
  }

  async archiveCase(caseId: string): Promise<ServiceResult<{ caseDetail: Case }>> {
    const existing = await storage.getCase(caseId);
    if (!existing) return { ok: false, error: "Case not found", status: 404 };
    if (existing.status === "Archived") {
      return { ok: false, error: "Case is already archived", status: 400 };
    }
    const updated = await storage.updateCaseStatus(caseId, "Archived");
    if (!updated) return { ok: false, error: "Case not found", status: 404 };
    this.refreshCaseFilterCache(caseId).catch(() => {});
    return { ok: true, caseDetail: updated } as ServiceResult<{ caseDetail: Case }>;
  }

  async restoreCase(caseId: string): Promise<ServiceResult<{ caseDetail: Case }>> {
    const existing = await storage.getCase(caseId);
    if (!existing) return { ok: false, error: "Case not found", status: 404 };
    if (existing.status !== "Archived") {
      return { ok: false, error: "Case is not archived", status: 400 };
    }
    const updated = await storage.updateCaseStatus(caseId, "Active");
    if (!updated) return { ok: false, error: "Case not found", status: 404 };
    this.refreshCaseFilterCache(caseId).catch(() => {});
    return { ok: true, caseDetail: updated } as ServiceResult<{ caseDetail: Case }>;
  }

  async hardDeleteCase(caseId: string): Promise<ServiceResult<{ caseRef: string; removedCounts: HardDeleteCaseCounts }>> {
    const existing = await storage.getCase(caseId);
    if (!existing) return { ok: false, error: "Case not found", status: 404 };
    const removedCounts = await storage.hardDeleteCase(caseId);
    return { ok: true, caseRef: existing.caseRef, removedCounts };
  }
}

export const caseService = new CaseService();
