import { and, asc, eq } from "drizzle-orm";
import { db } from "../db";
import { whatsappTemplateCatalog } from "@shared/schema";
import { whatsappMetaService } from "./whatsapp-meta.service";

const TEMPLATE_STALE_AFTER_HOURS = 24;

function parameterDefinitions(components: Array<Record<string, unknown>>) {
  const definitions: Array<Record<string, string>> = [];
  for (const component of components) {
    const text = typeof component.text === "string" ? component.text : "";
    for (const match of Array.from(text.matchAll(/{{\s*([^}]+)\s*}}/g))) definitions.push({ component: String(component.type || "BODY").toLowerCase(), key: match[1].trim() });
  }
  return definitions;
}

class WhatsappTemplateService {
  async listApproved() {
    return db.select().from(whatsappTemplateCatalog).where(eq(whatsappTemplateCatalog.status, "APPROVED")).orderBy(asc(whatsappTemplateCatalog.name), asc(whatsappTemplateCatalog.language));
  }

  async getApprovedTemplate(name: string, language: string) {
    const [template] = await db.select().from(whatsappTemplateCatalog).where(and(eq(whatsappTemplateCatalog.name, name), eq(whatsappTemplateCatalog.language, language), eq(whatsappTemplateCatalog.status, "APPROVED"))).limit(1);
    return template || null;
  }

  async getApprovedStatus(now = new Date()) {
    const approved = await this.listApproved();
    const lastSyncedAt = approved.reduce<Date | null>((latest, template) => {
      const syncedAt = template.lastSyncedAt ? new Date(template.lastSyncedAt) : null;
      if (!syncedAt) return latest;
      return !latest || syncedAt > latest ? syncedAt : latest;
    }, null);
    const stale = !lastSyncedAt || now.getTime() - lastSyncedAt.getTime() > TEMPLATE_STALE_AFTER_HOURS * 60 * 60 * 1000;
    return {
      count: approved.length,
      lastSyncedAt: lastSyncedAt ? lastSyncedAt.toISOString() : null,
      stale,
      staleAfterHours: TEMPLATE_STALE_AFTER_HOURS,
    };
  }

  async syncApproved() {
    const result = await whatsappMetaService.fetchApprovedTemplates();
    if (!result.ok) return result;
    const approved = result.templates.filter((template) => template.status === "APPROVED");
    const syncedAt = new Date();
    for (const template of approved) {
      const components = Array.isArray(template.components) ? template.components as Array<Record<string, unknown>> : [];
      const header = components.find((component) => component.type === "HEADER");
      const values = { metaTemplateId: String(template.id || `${template.name}:${template.language}`), name: String(template.name), language: String(template.language), category: template.category ? String(template.category) : null, status: "APPROVED", components, parameterDefinitions: parameterDefinitions(components), headerMediaType: header?.format && header.format !== "TEXT" ? String(header.format).toLowerCase() : null, lastSyncedAt: syncedAt, updatedAt: syncedAt };
      await db.insert(whatsappTemplateCatalog).values(values).onConflictDoUpdate({ target: [whatsappTemplateCatalog.name, whatsappTemplateCatalog.language], set: values });
    }
    return { ok: true as const, synced: approved.length };
  }
}

export const whatsappTemplateService = new WhatsappTemplateService();
