import { CASE_FORM_CATALOGUE, type CaseFormType } from "@shared/court-form-catalog";

// Pure derivation helpers for the per-party MIAM and Forms status grids
// shown on the case-detail Overview tab. They take a pre-computed `stageIdx`
// (the index of the current case stage inside MAIN_WORKFLOW_STAGES, or -1)
// so this module is decoupled from the canonical stage list.

export const MIAM_MILESTONES = ["Invited", "Pending", "Booked", "Completed"] as const;
export type MiamMilestone = typeof MIAM_MILESTONES[number];
export type CellState = "Not reached" | "In progress" | "Done" | "Not tracked";
export type CourtFormState = "Not started" | "Sent" | "Signed" | "Filed" | "Not tracked";

export const COURT_FORMS = CASE_FORM_CATALOGUE.map((form) => ({ id: form.id, name: form.label, description: form.description }));
export type CourtFormId = CaseFormType;

export type PartyLike = {
  id: string;
  role: string;
  firstName?: string;
  lastName?: string;
  email?: string | null;
};

export function deriveMiamCellState(milestone: MiamMilestone, role: string, stageIdx: number): CellState {
  const r = (role || "").toUpperCase();
  if (r !== "A" && r !== "B") return "Not tracked";
  if (stageIdx < 0) return "Not reached";
  // MAIN_WORKFLOW_STAGES indexes — A: 0..3, B: 4..7
  const t: Record<string, Record<MiamMilestone, number>> = {
    A: { Invited: 0, Pending: 1, Booked: 2, Completed: 3 },
    B: { Invited: 4, Pending: 5, Booked: 6, Completed: 7 },
  };
  const at = t[r][milestone];
  if (stageIdx > at) return "Done";
  if (stageIdx === at) return "In progress";
  return "Not reached";
}

// Per-party MIAM status derived from real appointments, used for additional
// parties (C/D+) where the case-stage stepper does not encode their progress.
export type PartyMiamStatus = "Not started" | "Booked" | "Attended" | "Completed";

export type AppointmentLike = {
  id: string;
  partyId: string | null;
  status: string;
  dateTime: string;
  serviceName?: string | null;
};

export function derivePartyMiamStatusFromAppointments(
  partyId: string,
  appointments: AppointmentLike[] | undefined,
): PartyMiamStatus {
  if (!appointments || appointments.length === 0) return "Not started";
  const miam = appointments.filter(
    (a) =>
      a.partyId === partyId &&
      (a.serviceName ?? "").toLowerCase().includes("miam") &&
      a.status !== "cancelled" &&
      a.status !== "expired",
  );
  if (miam.length === 0) return "Not started";
  const latest = [...miam].sort(
    (a, b) => new Date(b.dateTime).getTime() - new Date(a.dateTime).getTime(),
  )[0];
  if (latest.status === "completed") return "Completed";
  if (latest.status === "attended") return "Attended";
  if (latest.status === "confirmed" && new Date(latest.dateTime).getTime() < Date.now()) {
    return "Attended";
  }
  return "Booked";
}

// Per-party MIAM milestone state (Invited / Pending / Booked / Completed)
// derived from that party's actual appointments. Used for additional parties
// (C+) where the canonical case-stage list does not encode their progress, so
// each MIAM block in the Case Progress stepper can show the same 4 sub-status
// pills A and B do.
export function deriveMiamCellStateForParty(
  milestone: MiamMilestone,
  partyId: string,
  appointments: AppointmentLike[] | undefined,
): Exclude<CellState, "Not tracked"> {
  const miam = (appointments ?? []).filter(
    (a) =>
      a.partyId === partyId &&
      (a.serviceName ?? "").toLowerCase().includes("miam") &&
      a.status !== "cancelled" &&
      a.status !== "expired",
  );
  // Default starting position: Invited is the current milestone for a party
  // who has been added but has no MIAM booking yet.
  let currentIdx = 0;
  let allDone = false;
  if (miam.length > 0) {
    const latest = [...miam].sort(
      (a, b) => new Date(b.dateTime).getTime() - new Date(a.dateTime).getTime(),
    )[0];
    const past = new Date(latest.dateTime).getTime() < Date.now();
    if (latest.status === "completed" || latest.status === "attended") {
      currentIdx = 3;
      allDone = true;
    } else if (latest.status === "confirmed" && past) {
      currentIdx = 3; // sat through confirmed slot, awaiting completion stamp
    } else if (latest.status === "confirmed") {
      currentIdx = 2; // future confirmed booking
    } else if (latest.status === "hold" || latest.status === "held") {
      currentIdx = 1; // provisional hold
    }
  }
  const milestoneIdx = MIAM_MILESTONES.indexOf(milestone);
  if (allDone) return "Done";
  if (milestoneIdx < currentIdx) return "Done";
  if (milestoneIdx === currentIdx) return "In progress";
  return "Not reached";
}

export function deriveCourtFormState(form: CourtFormId, role: string, stageIdx: number): CourtFormState {
  const r = (role || "").toUpperCase();
  if (r !== "A" && r !== "B") return "Not tracked";
  if (stageIdx < 0) return "Not started";
  // MAIN_WORKFLOW_STAGES indexes — C100: 8/9, FormA: 10/11, FM1: 12/13
  const t: Partial<Record<CourtFormId, { pending: number; completed: number }>> = {
    C100: { pending: 8, completed: 9 },
    FormA: { pending: 10, completed: 11 },
    FM1: { pending: 12, completed: 13 },
  };
  const timeline = t[form];
  if (!timeline) return "Not started";
  const { pending, completed } = timeline;
  if (stageIdx > completed) return "Filed";
  if (stageIdx === completed) return "Signed";
  if (stageIdx === pending) return "Sent";
  return "Not started";
}

export function partyHeading(p: PartyLike): string {
  const r = (p.role || "").toUpperCase();
  return r === "A" || r === "B" ? `Client ${r}` : `Party ${r}`;
}

export function partyDisplayLabel(p: PartyLike): string {
  const heading = partyHeading(p);
  const name = `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim();
  return name ? `${heading} — ${name}` : heading;
}
