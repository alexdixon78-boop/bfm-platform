import { type Permission, permissions } from "@shared/schema";
import { db } from "../db";
import { sql } from "drizzle-orm";

export class PermissionRepository {
  async listPermissions(): Promise<Permission[]> {
    return db.select().from(permissions);
  }

  async upsertPermissions(entries: { role: string; section: string; canView: boolean; canEdit: boolean }[]): Promise<void> {
    if (entries.length === 0) return;
    await db.insert(permissions).values(entries).onConflictDoUpdate({
      target: [permissions.role, permissions.section],
      set: {
        canView: sql`excluded.can_view`,
        canEdit: sql`excluded.can_edit`,
      },
    });
  }
}
