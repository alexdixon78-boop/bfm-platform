import type {
  ClientRepresentative,
  InsertClientRepresentative,
  UpdateClientRepresentative,
  User,
} from "@shared/schema";
import { clientRepresentativeRepository } from "../repositories/client-representative.repository";
import { representativeRepository } from "../repositories/representative.repository";
import { storage } from "../storage";
import { logAudit } from "./audit-log.service";

const STAFF_ROLES = new Set(["superadmin", "subadmin"]);

/**
 * Authorise a master-record action: staff can act on any client's master list;
 * a portal-client may only act on records belonging to their own `clients.id`;
 * mediators are rejected (they never gain access to the master list).
 */
async function assertCanAccessClientList(clientId: string, user: User) {
  if (STAFF_ROLES.has(user.role)) return { ok: true as const };
  if (user.role === "client") {
    const own = await storage.getClientByUserId(user.id);
    if (!own) return { ok: false as const, status: 403, error: "No client record linked to this account" };
    if (own.id !== clientId) return { ok: false as const, status: 403, error: "Not your contact list" };
    return { ok: true as const };
  }
  return { ok: false as const, status: 403, error: "Not permitted" };
}

/** Person-level fields that should mirror back to the master record on edit. */
type MirrorableFields = Pick<
  UpdateClientRepresentative,
  "type" | "fullName" | "roleTitle" | "organisation" | "email" | "phone" | "phoneCode"
  | "addressLine1" | "addressLine2" | "city" | "postcode" | "country"
>;
const MIRRORABLE_KEYS = [
  "type", "fullName", "roleTitle", "organisation", "email", "phone", "phoneCode",
  "addressLine1", "addressLine2", "city", "postcode", "country",
] as const satisfies readonly (keyof MirrorableFields)[];

/** Loose shape for comparison — DB row has `type: string`, not the enum. */
type MirrorableLoose = Partial<Record<keyof MirrorableFields, string | null>>;

/** Upsert "fold-in": only non-empty, changed fields. Blanks never clobber. */
function pickMirrorableNonEmpty(
  source: MirrorableLoose,
  existing?: MirrorableLoose,
): UpdateClientRepresentative {
  const patch: UpdateClientRepresentative = {};
  for (const key of MIRRORABLE_KEYS) {
    const v = source[key];
    if (v === undefined || v === null || v === "") continue;
    if (existing && existing[key] === v) continue;
    Object.assign(patch, { [key]: v });
  }
  return patch;
}

/** Master-edit propagation: include explicit nulls so clears propagate. */
function pickMirrorablePresent(
  source: MirrorableLoose,
): UpdateClientRepresentative {
  const patch: UpdateClientRepresentative = {};
  for (const key of MIRRORABLE_KEYS) {
    const v = source[key];
    if (v === undefined) continue;
    Object.assign(patch, { [key]: v ?? null });
  }
  return patch;
}

export const clientRepresentativeService = {
  /**
   * Idempotent upsert by `(clientId, lower(email), lower(fullName))`. Used by
   * the case-attach flow so a fresh "Add representative" on case 2 reuses the
   * master row created on case 1 instead of duplicating it.
   */
  async upsertForClient(
    clientId: string,
    payload: Omit<InsertClientRepresentative, "clientId">,
    actor: User,
  ): Promise<{ master: ClientRepresentative; created: boolean }> {
    const existing = await clientRepresentativeRepository.findByClientAndKey(
      clientId,
      payload.fullName,
      payload.email ?? null,
    );
    if (existing) {
      // Fold in any newer non-null fields from the payload — but never overwrite
      // an existing value with NULL (the user adding the rep on a new case may
      // have left optional fields blank).
      const patch = pickMirrorableNonEmpty(payload, existing);
      if (Object.keys(patch).length > 0) {
        const updated = await clientRepresentativeRepository.update(existing.id, patch);
        await logAudit({
          userId: actor.id,
          action: "update_client_representative",
          entity: "client_representative",
          entityId: existing.id,
          entityRef: clientId,
          details: JSON.stringify({ source: "upsert_fold_in", patch }),
        });
        return { master: updated ?? existing, created: false };
      }
      return { master: existing, created: false };
    }
    const master = await clientRepresentativeRepository.create({
      ...payload,
      clientId,
      createdBy: actor.id,
    });
    await logAudit({
      userId: actor.id,
      action: "create_client_representative",
      entity: "client_representative",
      entityId: master.id,
      entityRef: clientId,
      details: JSON.stringify({ fullName: master.fullName, email: master.email, type: master.type }),
    });
    return { master, created: true };
  },

  async listForClient(clientId: string, user: User) {
    const auth = await assertCanAccessClientList(clientId, user);
    if (!auth.ok) return auth;
    const rows = await clientRepresentativeRepository.listByClient(clientId);
    return { ok: true as const, reps: rows };
  },

  /**
   * Create an unattached master record (used by `/contacts` + the staff client
   * detail panel to add a Rolodex entry without picking a case yet).
   */
  async createForClient(
    clientId: string,
    payload: Omit<InsertClientRepresentative, "clientId">,
    user: User,
  ) {
    const auth = await assertCanAccessClientList(clientId, user);
    if (!auth.ok) return auth;
    const result = await this.upsertForClient(clientId, payload, user);
    return { ok: true as const, rep: result.master, created: result.created };
  },

  async update(
    id: string,
    patch: UpdateClientRepresentative,
    user: User,
  ) {
    const existing = await clientRepresentativeRepository.getById(id);
    if (!existing) return { ok: false as const, status: 404, error: "Representative not found" };
    const auth = await assertCanAccessClientList(existing.clientId, user);
    if (!auth.ok) return auth;
    const updated = await clientRepresentativeRepository.update(id, patch);
    // Task #202: mirror person-level edits OUT to every attached
    // `case_representatives` row so case-detail cards reflect the change
    // without manual per-attachment edits. We use `pickMirrorablePresent`
    // (NOT `pickMirrorableNonEmpty`) so that explicitly clearing a field on
    // the master — e.g. removing a stale email — also clears it on every
    // attachment instead of leaving stale per-case data behind. Only
    // attachment-local metadata (consent state, notes, preferredChannel) is
    // intentionally skipped.
    const propagation = pickMirrorablePresent(patch);
    let propagatedAttachmentIds: string[] = [];
    if (Object.keys(propagation).length > 0) {
      propagatedAttachmentIds = await representativeRepository
        .updateByClientRepresentativeId(id, propagation);
    }
    await logAudit({
      userId: user.id,
      action: "update_client_representative",
      entity: "client_representative",
      entityId: id,
      entityRef: existing.clientId,
      details: JSON.stringify({ patch, propagatedAttachments: propagatedAttachmentIds.length }),
    });
    return { ok: true as const, rep: updated! };
  },

  /**
   * Delete a master record entirely. Rejects with a friendly message if any
   * `case_representatives` attachment still points at it — the caller has to
   * detach from each case first (or pass `force=true`, staff-only).
   */
  async delete(id: string, user: User, force: boolean) {
    const existing = await clientRepresentativeRepository.getById(id);
    if (!existing) return { ok: false as const, status: 404, error: "Representative not found" };
    const auth = await assertCanAccessClientList(existing.clientId, user);
    if (!auth.ok) return auth;
    const attachments = await clientRepresentativeRepository.countAttachments(id);
    if (attachments > 0 && !(force && STAFF_ROLES.has(user.role))) {
      return {
        ok: false as const,
        status: 409,
        error: `Cannot delete: this representative is still attached to ${attachments} case${attachments === 1 ? "" : "s"}. Detach them from each case first.`,
        attachments,
      };
    }
    await clientRepresentativeRepository.deleteById(id);
    await logAudit({
      userId: user.id,
      action: "delete_client_representative",
      entity: "client_representative",
      entityId: id,
      entityRef: existing.clientId,
      details: JSON.stringify({ fullName: existing.fullName, force, attachments }),
    });
    return { ok: true as const };
  },

  /**
   * Internal helper used by `representativeService.update` to mirror
   * person-level edits made on a case attachment back to the master record so
   * the data stays canonical across every case the rep is attached to.
   */
  async mirrorFromAttachmentEdit(
    masterId: string,
    fields: MirrorableLoose,
    actor: User,
  ): Promise<void> {
    const patch: UpdateClientRepresentative = {};
    for (const key of MIRRORABLE_KEYS) {
      const v = fields[key];
      if (v !== undefined) Object.assign(patch, { [key]: v });
    }
    if (Object.keys(patch).length === 0) return;
    const existing = await clientRepresentativeRepository.getById(masterId);
    if (!existing) return;
    await clientRepresentativeRepository.update(masterId, patch);
    await logAudit({
      userId: actor.id,
      action: "update_client_representative",
      entity: "client_representative",
      entityId: masterId,
      entityRef: existing.clientId,
      details: JSON.stringify({ source: "attachment_edit", patch }),
    });
  },
};
