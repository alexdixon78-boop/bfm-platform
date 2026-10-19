export type IntakeActor = { id: string; role: string };
export type IntakeClaim = { claimedBy?: string | null };

type IntakeAccessResult =
  | { ok: true }
  | { ok: false; status: 409; message: string };

export function isIntakeAdminRole(role: string): boolean {
  return role === "superadmin" || role === "subadmin";
}

export function validateIntakeWorker(existing: IntakeClaim, actor: IntakeActor): IntakeAccessResult {
  if (isIntakeAdminRole(actor.role)) return { ok: true };
  if (!existing.claimedBy) {
    return { ok: false, status: 409, message: "Please claim this enquiry before working on it" };
  }
  if (existing.claimedBy !== actor.id) {
    return { ok: false, status: 409, message: "This enquiry is claimed by another staff member" };
  }
  return { ok: true };
}

export function validateSafeguardingWorker(existing: IntakeClaim, actor: IntakeActor): IntakeAccessResult {
  if (isIntakeAdminRole(actor.role)) return { ok: true };
  if (existing.claimedBy && existing.claimedBy !== actor.id) {
    return { ok: false, status: 409, message: "This enquiry is claimed by another staff member" };
  }
  return { ok: true };
}

export function intakeStatusAfterSafeguardingClear(existing: {
  firstContactAttemptedAt?: Date | string | null;
  claimedBy?: string | null;
}): "Chasing" | "Claimed" | "New" {
  if (existing.firstContactAttemptedAt) return "Chasing";
  return existing.claimedBy ? "Claimed" : "New";
}
