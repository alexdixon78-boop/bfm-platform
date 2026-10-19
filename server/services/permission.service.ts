import { storage } from "../storage";
import {
  mergeCanonicalPermissions,
  type PermissionEntry,
  type Role,
} from "@shared/permissions";

let cachedPermissions: PermissionEntry[] | null = null;

export class PermissionService {
  async getPermissions(): Promise<PermissionEntry[]> {
    if (cachedPermissions) return cachedPermissions;
    const dbPerms = await storage.listPermissions();
    cachedPermissions = mergeCanonicalPermissions(dbPerms.map(p => ({
      role: p.role as any,
      section: p.section as any,
      canView: p.canView,
      canEdit: p.canEdit,
    })));
    return cachedPermissions;
  }

  invalidateCache() {
    cachedPermissions = null;
  }

  async updatePermissions(entries: PermissionEntry[]) {
    const before = await this.getPermissions();
    const beforeByKey = new Map(before.map((entry) => [`${entry.role}:${entry.section}`, entry]));
    const actualChanges = entries.filter((entry) => {
      const current = beforeByKey.get(`${entry.role}:${entry.section}`);
      return !current || current.canView !== entry.canView || current.canEdit !== entry.canEdit;
    });

    await storage.upsertPermissions(actualChanges);
    this.invalidateCache();
    const permissions = await this.getPermissions();
    const affectedRoles = Array.from(new Set(actualChanges.map((entry) => entry.role))) as Role[];
    const changes = actualChanges.map((entry) => ({
      role: entry.role,
      section: entry.section,
      before: beforeByKey.get(`${entry.role}:${entry.section}`) ?? null,
      after: entry,
    }));
    return { permissions, changes, affectedRoles };
  }
}

export const permissionService = new PermissionService();
