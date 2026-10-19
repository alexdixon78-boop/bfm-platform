import { storage } from "../storage";
import { hashPassword } from "../utils/helpers";
import { serviceTypeService } from "./service-type.service";
import type { ServiceResult } from "./types";
import type { PaginationParams, PaginatedResponse, User, MediationRoleQualification } from "@shared/schema";
import { attachMediatorQualifications, MEDIATION_ROLE_QUALIFICATIONS, mediatorProfiles, users } from "@shared/schema";
import { db } from "../db";
import { eq } from "drizzle-orm";
import crypto from "crypto";
import { validateAdminRoleMutation } from "../security/singleton-superadmin-policy";
import { mediatorProfileRepository } from "../repositories/mediator-profile.repository";
import { sendTeamUserInviteEmail } from "./email.service";
import { canSendTeamUserInvite } from "@shared/team-user-invitation";
import { getPublicAppUrl } from "../utils/app-url";

function stripSensitiveFields(user: User) {
  const {
    password,
    resetToken,
    resetExpiresAt,
    onboardingToken,
    onboardingTokenExpiresAt,
    googleAccessToken,
    googleRefreshToken,
    googleTokenExpiresAt,
    outlookAccessToken,
    outlookRefreshToken,
    outlookTokenExpiresAt,
    ...safe
  } = user;
  return safe;
}

export class UserService {
  private isAdminRole(role: string) {
    return role === "superadmin" || role === "subadmin" || role === "staff";
  }

  private assertActorCanManageAdminUser(actor: User, targetRole: string): ServiceResult<never> | null {
    if (actor.role === "staff" && targetRole !== "staff") {
      return {
        ok: false,
        error: "Staff users can only create or manage other Staff accounts",
        status: 403,
      };
    }
    return null;
  }

  async listAdminUsers() {
    const usersList = await storage.listUsers();
    return usersList
      .filter(u => this.isAdminRole(u.role))
      .map(stripSensitiveFields);
  }

  private async sendAdminOnboardingInvite(user: User): Promise<boolean> {
    const rawToken = crypto.randomUUID();
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await storage.updateUser(user.id, { onboardingToken: tokenHash, onboardingTokenExpiresAt: expiresAt });
    return sendTeamUserInviteEmail(user.email, user.name, `${getPublicAppUrl()}/onboarding?token=${rawToken}`);
  }

  async createAdminUser(data: { name: string; email: string; role: string; contractorType?: string | null }, actor: User): Promise<ServiceResult<{ user: any; emailSent: boolean }>> {
    if (!data.name || !data.email || !data.role) {
      return { ok: false, error: "name, email, and role are required", status: 400 };
    }
    if (!this.isAdminRole(data.role)) {
      return { ok: false, error: "Users page only manages admin roles. Use Mediators or Clients pages for other roles.", status: 400 };
    }
    const actorError = this.assertActorCanManageAdminUser(actor, data.role);
    if (actorError) return actorError;
    const roleError = validateAdminRoleMutation({ operation: "create", requestedRole: data.role });
    if (roleError) return { ok: false, error: roleError, status: 400 };
    if (data.role === "staff" && !data.contractorType) {
      return { ok: false, error: "Staff type is required for staff users", status: 400 };
    }
    const existing = await storage.getUserByEmail(data.email);
    if (existing) {
      return { ok: false, error: "A user with this email already exists", status: 409 };
    }
    const user = await storage.createUser({
      name: data.name,
      email: data.email,
      password: hashPassword(crypto.randomBytes(32).toString("hex")),
      role: data.role,
      status: "pending",
    });
    if (data.role === "staff" && data.contractorType) {
      await storage.updateUser(user.id, { contractorType: data.contractorType });
    }
    const refreshed = await storage.getUser(user.id);
    const emailSent = await this.sendAdminOnboardingInvite(refreshed!);
    return { ok: true, user: stripSensitiveFields(refreshed!), emailSent };
  }

  async resendAdminUserInvite(id: string, actor: User): Promise<ServiceResult<{ user: any; emailSent: boolean }>> {
    const target = await storage.getUser(id);
    if (!target || !this.isAdminRole(target.role) || target.role === "superadmin") {
      return { ok: false, error: "Admin user not found", status: 404 };
    }
    const actorError = this.assertActorCanManageAdminUser(actor, target.role);
    if (actorError) return actorError;
    if (!canSendTeamUserInvite(target)) {
      return { ok: false, error: "Invitations can only be sent to active or pending team accounts", status: 400 };
    }
    const emailSent = await this.sendAdminOnboardingInvite(target);
    const refreshed = await storage.getUser(id);
    return { ok: true, user: stripSensitiveFields(refreshed!), emailSent };
  }

  async updateAdminUser(id: string, data: { name?: string; email?: string; password?: string; role?: string; contractorType?: string | null }, actor: User): Promise<ServiceResult<{ user: any }>> {
    const target = await storage.getUser(id);
    if (!target || !this.isAdminRole(target.role)) {
      return { ok: false, error: "Admin user not found", status: 404 };
    }
    if (data.role && !this.isAdminRole(data.role)) {
      return { ok: false, error: "Users page only manages admin roles", status: 400 };
    }
    const actorTargetError = this.assertActorCanManageAdminUser(actor, target.role);
    if (actorTargetError) return actorTargetError;
    const actorRequestedRoleError = this.assertActorCanManageAdminUser(actor, data.role ?? target.role);
    if (actorRequestedRoleError) return actorRequestedRoleError;
    const roleError = validateAdminRoleMutation({ operation: "update", currentRole: target.role, requestedRole: data.role });
    if (roleError) return { ok: false, error: roleError, status: 400 };
    const effectiveRole = data.role ?? target.role;
    if (effectiveRole === "staff" && data.contractorType === null) {
      return { ok: false, error: "Staff type is required for staff users", status: 400 };
    }
    const updateData: any = {};
    if (data.name) updateData.name = data.name;
    if (data.email) updateData.email = data.email;
    if (data.role) updateData.role = data.role;
    if (data.password) updateData.password = hashPassword(data.password);
    if (data.contractorType !== undefined) updateData.contractorType = data.contractorType || null;
    if (data.role && data.role !== "staff") updateData.contractorType = null;

    const updated = await storage.updateUser(id, updateData);
    if (!updated) return { ok: false, error: "User not found", status: 404 };
    return { ok: true, user: stripSensitiveFields(updated) };
  }

  async deleteAdminUser(id: string, actor: User): Promise<ServiceResult<{ success: boolean }>> {
    if (actor.id === id) {
      return { ok: false, error: "Cannot delete your own account", status: 400 };
    }
    const target = await storage.getUser(id);
    if (!target || !this.isAdminRole(target.role)) {
      return { ok: false, error: "Admin user not found", status: 404 };
    }
    const actorError = this.assertActorCanManageAdminUser(actor, target.role);
    if (actorError) return actorError;
    const roleError = validateAdminRoleMutation({ operation: "delete", currentRole: target.role });
    if (roleError) return { ok: false, error: roleError, status: 400 };
    const deleted = await storage.deleteUser(id);
    if (!deleted) return { ok: false, error: "User not found", status: 404 };
    return { ok: true, success: true };
  }

  async listMediators(params?: PaginationParams & { includeArchived?: boolean }): Promise<PaginatedResponse<any>> {
    const usersList = await storage.listUsers();
    const includeArchived = params?.includeArchived === true;
    const allMediators = usersList.filter(u =>
      u.role === "mediator" && (includeArchived || u.status !== "archived")
    );
    const [allCases, allParties, mediatorQualifications] = await Promise.all([
      storage.listCases(),
      storage.listAllParties(),
      mediatorProfileRepository.listRoleQualifications(),
    ]);

    const apptCounts = await Promise.all(
      allMediators.map(m => storage.listAppointmentsByMediator(m.id).then(a => [m.id, a.length] as const))
    );
    const apptCountById = new Map<string, number>(apptCounts);

    let enriched = attachMediatorQualifications(allMediators, mediatorQualifications).map(m => {
      const safe = stripSensitiveFields(m);
      const caseIds = new Set<string>();
      allCases.forEach(c => { if (c.mediatorId === m.id) caseIds.add(c.id); });
      allParties.forEach(p => { if (p.miamMediatorId === m.id || p.allocatedMediatorId === m.id) caseIds.add(p.caseId); });
      return {
        ...safe,
        assignedCasesCount: caseIds.size,
        activeCasesCount: allCases.filter(c => caseIds.has(c.id) && c.status === "Active").length,
        appointmentsCount: apptCountById.get(m.id) ?? 0,
      };
    });

    if (params?.search) {
      const q = params.search.toLowerCase();
      enriched = enriched.filter(m =>
        m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q)
      );
    }

    if (params?.sortBy) {
      const dir = params.sortOrder === "asc" ? 1 : -1;
      enriched.sort((a, b) => {
        let valA: string | number = "";
        let valB: string | number = "";
        switch (params.sortBy) {
          case "name": valA = a.name.toLowerCase(); valB = b.name.toLowerCase(); break;
          case "email": valA = a.email.toLowerCase(); valB = b.email.toLowerCase(); break;
          case "assignedCases": valA = a.assignedCasesCount; valB = b.assignedCasesCount; break;
          case "activeCases": valA = a.activeCasesCount; valB = b.activeCasesCount; break;
        }
        if (valA < valB) return -1 * dir;
        if (valA > valB) return 1 * dir;
        return 0;
      });
    }

    const total = enriched.length;
    const page = params?.page ?? 1;
    const limit = params?.limit ?? 20;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const start = (page - 1) * limit;
    const data = enriched.slice(start, start + limit);

    return { data, total, page, limit, totalPages, counts: {} };
  }

  async createMediator(data: { name: string; email: string; password?: string; zoomLink?: string; mediationRoleQualification?: MediationRoleQualification }): Promise<ServiceResult<{ user: any }>> {
    if (!data.name || !data.email) {
      return { ok: false, error: "name and email are required", status: 400 };
    }
    if (!MEDIATION_ROLE_QUALIFICATIONS.includes(data.mediationRoleQualification as MediationRoleQualification)) {
      return { ok: false, error: "Mediation role qualification is required", status: 400 };
    }
    if (data.zoomLink) {
      try { const u = new URL(data.zoomLink); if (u.protocol !== "https:") throw new Error(); } catch { return { ok: false, error: "Zoom link must be a valid HTTPS URL", status: 400 }; }
    }
    const existing = await storage.getUserByEmail(data.email);
    if (existing) {
      return { ok: false, error: "A user with this email already exists", status: 409 };
    }
    const hasPassword = !!data.password;
    const passwordHash = hasPassword ? hashPassword(data.password!) : hashPassword(crypto.randomBytes(32).toString("hex"));
    const status = hasPassword ? "active" : "pending";
    const nameParts = data.name.trim().split(/\s+/);
    const user = await db.transaction(async (tx) => {
      const [created] = await tx.insert(users).values({ name: data.name, email: data.email, password: passwordHash, role: "mediator", status, zoomLink: data.zoomLink || null }).returning();
      await tx.insert(mediatorProfiles).values({
        userId: created.id,
        firstName: nameParts[0] || null,
        lastName: nameParts.slice(1).join(" ") || null,
        mediationRoleQualification: data.mediationRoleQualification!,
      }).returning();
      return created;
    });
    return { ok: true, user: { ...stripSensitiveFields(user), mediationRoleQualification: data.mediationRoleQualification } };
  }

  async updateMediator(id: string, data: { name?: string; email?: string; password?: string; zoomLink?: string | null; availabilityColor?: string | null; mediationRoleQualification?: MediationRoleQualification }): Promise<ServiceResult<{ user: any }>> {
    const target = await storage.getUser(id);
    if (!target || target.role !== "mediator") {
      return { ok: false, error: "Mediator not found", status: 404 };
    }
    if (data.mediationRoleQualification !== undefined && !MEDIATION_ROLE_QUALIFICATIONS.includes(data.mediationRoleQualification)) {
      return { ok: false, error: "Invalid mediation role qualification", status: 400 };
    }
    if (data.zoomLink) {
      try { const u = new URL(data.zoomLink); if (u.protocol !== "https:") throw new Error(); } catch { return { ok: false, error: "Zoom link must be a valid HTTPS URL", status: 400 }; }
    }
    if (data.availabilityColor !== undefined && data.availabilityColor !== null) {
      const hex = String(data.availabilityColor).trim();
      if (!/^#[0-9a-fA-F]{6}$/.test(hex)) {
        return { ok: false, error: "Calendar colour must be a 6-digit hex value (e.g. #5a7d58)", status: 400 };
      }
    }
    const updateData: any = {};
    if (data.name) updateData.name = data.name;
    if (data.email) updateData.email = data.email;
    if (data.password) updateData.password = hashPassword(data.password);
    if (data.zoomLink !== undefined) updateData.zoomLink = data.zoomLink || null;
    if (data.availabilityColor !== undefined) {
      updateData.availabilityColor = data.availabilityColor ? data.availabilityColor.toLowerCase() : null;
    }

    const updated = data.mediationRoleQualification === undefined
      ? await storage.updateUser(id, updateData)
      : await db.transaction(async (tx) => {
        const [saved] = Object.keys(updateData).length > 0
          ? await tx.update(users).set(updateData).where(eq(users.id, id)).returning()
          : await tx.select().from(users).where(eq(users.id, id));
        if (!saved) return undefined;
        await tx.insert(mediatorProfiles).values({ userId: id, mediationRoleQualification: data.mediationRoleQualification! })
          .onConflictDoUpdate({ target: mediatorProfiles.userId, set: { mediationRoleQualification: data.mediationRoleQualification! } });
        return saved;
      });
    if (!updated) return { ok: false, error: "Mediator not found", status: 404 };
    return { ok: true, user: { ...stripSensitiveFields(updated), ...(data.mediationRoleQualification === undefined ? {} : { mediationRoleQualification: data.mediationRoleQualification }) } };
  }

  async changeMediatorPassword(id: string, data: { password?: string; confirmPassword?: string }): Promise<ServiceResult<{ success: true }>> {
    const target = await storage.getUser(id);
    if (!target || target.role !== "mediator") {
      return { ok: false, error: "Mediator not found", status: 404 };
    }
    const password = data.password ?? "";
    const confirmPassword = data.confirmPassword ?? "";
    if (password.length < 8) {
      return { ok: false, error: "Password must be at least 8 characters", status: 400 };
    }
    if (password !== confirmPassword) {
      return { ok: false, error: "Passwords do not match", status: 400 };
    }

    await storage.updateUser(id, {
      password: hashPassword(password),
      ...(target.status === "pending" ? {
        status: "active" as const,
        onboardingToken: null,
        onboardingTokenExpiresAt: null,
      } : {}),
    });
    return { ok: true, success: true };
  }

  async deleteMediator(id: string): Promise<ServiceResult<{ archived: boolean; deleted: boolean; references: { appointments: number; cases: number } }>> {
    const user = await storage.getUser(id);
    if (!user || user.role !== "mediator") {
      return { ok: false, error: "Mediator not found", status: 404 };
    }

    const [appts, allCases, allParties] = await Promise.all([
      storage.listAppointmentsByMediator(id),
      storage.listCases(),
      storage.listAllParties(),
    ]);
    const caseRefs = allCases.filter(c => c.mediatorId === id).length;
    const partyRefs = allParties.filter(p => p.miamMediatorId === id || p.allocatedMediatorId === id).length;
    const blockingRefs = appts.length + caseRefs + partyRefs;

    if (blockingRefs === 0) {
      await serviceTypeService.setMediatorServices(id, []);
      const deleted = await storage.deleteUser(id);
      if (!deleted) return { ok: false, error: "Mediator not found", status: 404 };
      return { ok: true, archived: false, deleted: true, references: { appointments: 0, cases: 0 } };
    }

    await storage.updateUser(id, {
      status: "archived",
      onboardingToken: null,
      onboardingTokenExpiresAt: null,
      googleCalendarConnected: false,
      googleAccessToken: null,
      googleRefreshToken: null,
      googleTokenExpiresAt: null,
      googleCalendarEmail: null,
      lastCalendarSyncError: null,
      lastCalendarSyncAt: null,
      outlookCalendarConnected: false,
      outlookAccessToken: null,
      outlookRefreshToken: null,
      outlookTokenExpiresAt: null,
      outlookCalendarEmail: null,
      outlookScopeGranted: null,
      lastOutlookSyncError: null,
      lastOutlookSyncAt: null,
    });
    return {
      ok: true,
      archived: true,
      deleted: false,
      references: { appointments: appts.length, cases: caseRefs + partyRefs },
    };
  }

  async listContractors(params?: PaginationParams & { includeArchived?: boolean }): Promise<PaginatedResponse<any>> {
    const usersList = await storage.listUsers();
    const includeArchived = params?.includeArchived === true;
    let contractors = usersList
      .filter(u => u.role === "contractor" && (includeArchived || u.status !== "archived"))
      .map(stripSensitiveFields);

    if (params?.search) {
      const q = params.search.toLowerCase();
      contractors = contractors.filter(c =>
        c.name.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        (c.contractorType?.toLowerCase().includes(q) ?? false)
      );
    }

    if (params?.sortBy) {
      const dir = params.sortOrder === "asc" ? 1 : -1;
      contractors.sort((a, b) => {
        let valA: string = "";
        let valB: string = "";
        switch (params.sortBy) {
          case "name": valA = a.name.toLowerCase(); valB = b.name.toLowerCase(); break;
          case "email": valA = a.email.toLowerCase(); valB = b.email.toLowerCase(); break;
          case "contractorType": valA = (a.contractorType || "").toLowerCase(); valB = (b.contractorType || "").toLowerCase(); break;
        }
        if (valA < valB) return -1 * dir;
        if (valA > valB) return 1 * dir;
        return 0;
      });
    }

    const total = contractors.length;
    const page = params?.page ?? 1;
    const limit = params?.limit ?? 20;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const start = (page - 1) * limit;
    const data = contractors.slice(start, start + limit);

    return { data, total, page, limit, totalPages, counts: {} };
  }

  async createContractor(data: { name: string; email: string; password?: string; contractorType?: string | null }): Promise<ServiceResult<{ user: any }>> {
    if (!data.name || !data.email) {
      return { ok: false, error: "name and email are required", status: 400 };
    }
    const existing = await storage.getUserByEmail(data.email);
    if (existing) {
      return { ok: false, error: "A user with this email already exists", status: 409 };
    }
    const hasPassword = !!data.password;
    const passwordHash = hasPassword ? hashPassword(data.password!) : hashPassword(crypto.randomBytes(32).toString("hex"));
    const status = hasPassword ? "active" : "pending";
    const user = await storage.createUser({
      name: data.name,
      email: data.email,
      password: passwordHash,
      role: "contractor",
      status,
    });
    if (data.contractorType !== undefined) {
      await storage.updateUser(user.id, { contractorType: data.contractorType || null });
    }
    const refreshed = await storage.getUser(user.id);
    return { ok: true, user: stripSensitiveFields(refreshed!) };
  }

  async updateContractor(id: string, data: { name?: string; email?: string; password?: string; contractorType?: string | null; status?: string }): Promise<ServiceResult<{ user: any }>> {
    const target = await storage.getUser(id);
    if (!target || target.role !== "contractor") {
      return { ok: false, error: "Contractor not found", status: 404 };
    }
    const updateData: any = {};
    if (data.name) updateData.name = data.name;
    if (data.email) updateData.email = data.email;
    if (data.password) {
      updateData.password = hashPassword(data.password);
      if (target.status === "pending") {
        updateData.status = "active";
        updateData.onboardingToken = null;
        updateData.onboardingTokenExpiresAt = null;
      }
    }
    if (data.contractorType !== undefined) updateData.contractorType = data.contractorType || null;
    if (data.status && ["active", "inactive"].includes(data.status)) {
      updateData.status = data.status;
    }

    const updated = await storage.updateUser(id, updateData);
    if (!updated) return { ok: false, error: "Contractor not found", status: 404 };
    return { ok: true, user: stripSensitiveFields(updated) };
  }

  async deleteContractor(id: string): Promise<ServiceResult<{ deleted: boolean }>> {
    const user = await storage.getUser(id);
    if (!user || user.role !== "contractor") {
      return { ok: false, error: "Contractor not found", status: 404 };
    }
    const deleted = await storage.deleteUser(id);
    if (!deleted) return { ok: false, error: "Contractor not found", status: 404 };
    return { ok: true, deleted: true };
  }
}

export const userService = new UserService();
