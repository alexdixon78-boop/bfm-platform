import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import {
  buildCaseLeadMediatorOptions,
  mediatorServiceApprovals,
  mediatorServiceTypes,
  normalizeMediationRoleQualification,
  users,
  type CaseLeadMediatorOption,
  type User,
} from "@shared/schema";
import { getEffectiveApprovalStatus } from "./mediator-service-approval.service";
import type { ServiceResult } from "./types";

class CaseLeadMediatorService {
  async listOptions(): Promise<CaseLeadMediatorOption[]> {
    const rows = await db
      .select({
        id: users.id,
        name: users.name,
        role: users.role,
        status: users.status,
        serviceTypeId: mediatorServiceTypes.serviceTypeId,
        mediationRoleQualification: mediatorServiceTypes.mediationRoleQualification,
        approvalStatus: mediatorServiceApprovals.status,
        expiryDate: mediatorServiceApprovals.expiryDate,
        expiredAt: mediatorServiceApprovals.expiredAt,
      })
      .from(mediatorServiceTypes)
      .innerJoin(users, eq(users.id, mediatorServiceTypes.mediatorId))
      .innerJoin(mediatorServiceApprovals, and(
        eq(mediatorServiceApprovals.mediatorId, mediatorServiceTypes.mediatorId),
        eq(mediatorServiceApprovals.serviceTypeId, mediatorServiceTypes.serviceTypeId),
      ));

    return buildCaseLeadMediatorOptions(rows.map((row) => ({
      id: row.id,
      name: row.name,
      role: row.role,
      status: row.status,
      serviceTypeId: row.serviceTypeId,
      mediationRoleQualification: normalizeMediationRoleQualification(row.mediationRoleQualification),
      serviceApproved: !row.expiredAt && getEffectiveApprovalStatus({
        status: row.approvalStatus,
        expiryDate: row.expiryDate,
        expiredAt: row.expiredAt,
      }) === "approved",
    })));
  }

  async validateAssignment(userId: string): Promise<ServiceResult<{ user: User }>> {
    const user = await storage.getUser(userId);
    if (!user || user.role !== "mediator" || user.status !== "active") {
      return { ok: false, error: "Case lead mediator must be an active mediator", status: 400 };
    }
    const options = await this.listOptions();
    if (!options.some((option) => option.id === userId)) {
      return {
        ok: false,
        error: "Case lead mediator must have an approved, non-expired service marked Lead mediator",
        status: 400,
      };
    }
    return { ok: true, user };
  }
}

export const caseLeadMediatorService = new CaseLeadMediatorService();
