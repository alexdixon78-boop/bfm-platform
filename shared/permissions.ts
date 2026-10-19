export const ROLES = [
  "superadmin",
  "subadmin",
  "staff",
  "mediator",
  "client",
  "contractor",
] as const;

export type Role = (typeof ROLES)[number];

export const SECTIONS = [
  "dashboard",
  "enquiries",
  "cases",
  "appointments",
  "clients",
  "mediators",
  "contractors",
  "documents",
  "contacts",
  "finance",
  "court_forms",
  "reports",
  "settings",
  "users",
  "audit_log",
  "services",
  "whatsapp",
] as const;

export type Section = (typeof SECTIONS)[number];

export type Action = "view" | "edit";

export type PermissionEntry = {
  role: Role;
  section: Section;
  canView: boolean;
  canEdit: boolean;
};

export const CONFIGURABLE_ROLES = [
  "subadmin",
  "staff",
  "mediator",
  "contractor",
] as const satisfies readonly Role[];

export type AccessArea = {
  section: Section;
  label: string;
  description: string;
  supportsEdit: boolean;
};

export const ACCESS_AREAS: readonly AccessArea[] = [
  { section: "dashboard", label: "Overview", description: "Dashboard", supportsEdit: false },
  { section: "enquiries", label: "Enquiry Management", description: "Enquiries (Mail Inbox remains admin-only)", supportsEdit: true },
  { section: "cases", label: "Case Management", description: "Cases, Tasks, and case-level Documents", supportsEdit: true },
  { section: "appointments", label: "Appointment Management", description: "Appointments", supportsEdit: true },
  { section: "clients", label: "Client Records", description: "Clients", supportsEdit: true },
  { section: "mediators", label: "Mediator Management", description: "Mediators and Mediator Applicants", supportsEdit: true },
  { section: "contractors", label: "Contractor Management", description: "Contractors and Contractor Pipeline", supportsEdit: true },
  { section: "finance", label: "Finance", description: "Finance", supportsEdit: true },
  { section: "court_forms", label: "Court Forms", description: "Court Forms", supportsEdit: true },
  { section: "reports", label: "Reporting", description: "Reports", supportsEdit: false },
  { section: "users", label: "Team Management", description: "Users", supportsEdit: true },
  { section: "audit_log", label: "Audit & Compliance", description: "Audit Log", supportsEdit: false },
  { section: "services", label: "Service Catalogue", description: "Services", supportsEdit: true },
  { section: "whatsapp", label: "WhatsApp Communications", description: "WhatsApp", supportsEdit: true },
] as const;

export const CLIENT_PORTAL_ACCESS = [
  { label: "Dashboard", description: "A summary of the client's mediation activity" },
  { label: "Mediation", description: "Mediation cases, including Documents within each case" },
  { label: "Appointments", description: "The client's upcoming and past appointments" },
  { label: "My Contacts", description: "The client's saved professional contacts" },
] as const;

const FIXED_CLIENT_ACCESS: Partial<Record<Section, { canView: boolean; canEdit: boolean }>> = {
  dashboard: { canView: true, canEdit: false },
  cases: { canView: true, canEdit: false },
  appointments: { canView: true, canEdit: false },
  documents: { canView: true, canEdit: false },
  contacts: { canView: true, canEdit: true },
};

const CONFIGURABLE_AREA_BY_SECTION = new Map(
  ACCESS_AREAS.map((area) => [area.section, area] as const),
);

export const DEFAULT_PERMISSIONS: PermissionEntry[] = [
  { role: "superadmin", section: "dashboard", canView: true, canEdit: true },
  { role: "superadmin", section: "enquiries", canView: true, canEdit: true },
  { role: "superadmin", section: "cases", canView: true, canEdit: true },
  { role: "superadmin", section: "appointments", canView: true, canEdit: true },
  { role: "superadmin", section: "clients", canView: true, canEdit: true },
  { role: "superadmin", section: "mediators", canView: true, canEdit: true },
  { role: "superadmin", section: "contractors", canView: true, canEdit: true },
  { role: "superadmin", section: "documents", canView: true, canEdit: true },
  // "contacts" is the client-portal "My Contacts" page only. Staff have their
  // own per-case representatives view inside /cases/:id and must NOT have a
  // top-level Contacts entry — leave canView false for every non-client role.
  // The /contacts route is additionally hard-gated to role==="client" at the
  // route layer (clientOnly) so this default cannot be flipped on by accident.
  { role: "superadmin", section: "contacts", canView: false, canEdit: false },
  { role: "superadmin", section: "finance", canView: true, canEdit: true },
  { role: "superadmin", section: "court_forms", canView: true, canEdit: true },
  { role: "superadmin", section: "reports", canView: true, canEdit: true },
  { role: "superadmin", section: "settings", canView: true, canEdit: true },
  { role: "superadmin", section: "users", canView: true, canEdit: true },
  { role: "superadmin", section: "audit_log", canView: true, canEdit: true },
  { role: "superadmin", section: "services", canView: true, canEdit: true },
  { role: "superadmin", section: "whatsapp", canView: true, canEdit: true },

  { role: "subadmin", section: "dashboard", canView: true, canEdit: true },
  { role: "subadmin", section: "enquiries", canView: true, canEdit: true },
  { role: "subadmin", section: "cases", canView: true, canEdit: true },
  { role: "subadmin", section: "appointments", canView: true, canEdit: true },
  { role: "subadmin", section: "clients", canView: true, canEdit: true },
  { role: "subadmin", section: "mediators", canView: true, canEdit: false },
  { role: "subadmin", section: "contractors", canView: true, canEdit: true },
  { role: "subadmin", section: "documents", canView: true, canEdit: true },
  { role: "subadmin", section: "contacts", canView: false, canEdit: false },
  { role: "subadmin", section: "finance", canView: true, canEdit: true },
  { role: "subadmin", section: "court_forms", canView: true, canEdit: true },
  { role: "subadmin", section: "reports", canView: true, canEdit: false },
  { role: "subadmin", section: "settings", canView: false, canEdit: false },
  { role: "subadmin", section: "users", canView: false, canEdit: false },
  { role: "subadmin", section: "audit_log", canView: true, canEdit: false },
  { role: "subadmin", section: "services", canView: true, canEdit: true },
  { role: "subadmin", section: "whatsapp", canView: true, canEdit: true },

  { role: "mediator", section: "dashboard", canView: true, canEdit: false },
  { role: "mediator", section: "enquiries", canView: false, canEdit: false },
  { role: "mediator", section: "cases", canView: true, canEdit: true },
  { role: "mediator", section: "appointments", canView: true, canEdit: true },
  { role: "mediator", section: "clients", canView: true, canEdit: false },
  { role: "mediator", section: "mediators", canView: false, canEdit: false },
  { role: "mediator", section: "contractors", canView: false, canEdit: false },
  { role: "mediator", section: "documents", canView: true, canEdit: true },
  { role: "mediator", section: "contacts", canView: false, canEdit: false },
  { role: "mediator", section: "finance", canView: false, canEdit: false },
  { role: "mediator", section: "court_forms", canView: true, canEdit: true },
  { role: "mediator", section: "reports", canView: false, canEdit: false },
  { role: "mediator", section: "settings", canView: false, canEdit: false },
  { role: "mediator", section: "users", canView: false, canEdit: false },
  { role: "mediator", section: "audit_log", canView: false, canEdit: false },
  { role: "mediator", section: "services", canView: true, canEdit: false },
  { role: "mediator", section: "whatsapp", canView: false, canEdit: false },

  { role: "client", section: "dashboard", canView: true, canEdit: false },
  { role: "client", section: "enquiries", canView: false, canEdit: false },
  { role: "client", section: "cases", canView: true, canEdit: false },
  { role: "client", section: "appointments", canView: true, canEdit: false },
  { role: "client", section: "clients", canView: false, canEdit: false },
  { role: "client", section: "mediators", canView: false, canEdit: false },
  { role: "client", section: "contractors", canView: false, canEdit: false },
  { role: "client", section: "documents", canView: true, canEdit: false },
  { role: "client", section: "contacts", canView: true, canEdit: true },
  { role: "client", section: "finance", canView: false, canEdit: false },
  { role: "client", section: "court_forms", canView: false, canEdit: false },
  { role: "client", section: "reports", canView: false, canEdit: false },
  { role: "client", section: "settings", canView: false, canEdit: false },
  { role: "client", section: "users", canView: false, canEdit: false },
  { role: "client", section: "audit_log", canView: false, canEdit: false },
  { role: "client", section: "services", canView: false, canEdit: false },
  { role: "client", section: "whatsapp", canView: false, canEdit: false },

  { role: "staff", section: "dashboard", canView: false, canEdit: false },
  { role: "staff", section: "enquiries", canView: false, canEdit: false },
  { role: "staff", section: "cases", canView: false, canEdit: false },
  { role: "staff", section: "appointments", canView: false, canEdit: false },
  { role: "staff", section: "clients", canView: false, canEdit: false },
  { role: "staff", section: "mediators", canView: false, canEdit: false },
  { role: "staff", section: "contractors", canView: false, canEdit: false },
  { role: "staff", section: "documents", canView: false, canEdit: false },
  { role: "staff", section: "contacts", canView: false, canEdit: false },
  { role: "staff", section: "finance", canView: false, canEdit: false },
  { role: "staff", section: "court_forms", canView: false, canEdit: false },
  { role: "staff", section: "reports", canView: false, canEdit: false },
  { role: "staff", section: "settings", canView: false, canEdit: false },
  { role: "staff", section: "users", canView: false, canEdit: false },
  { role: "staff", section: "audit_log", canView: false, canEdit: false },
  { role: "staff", section: "services", canView: false, canEdit: false },
  { role: "staff", section: "whatsapp", canView: false, canEdit: false },

  { role: "contractor", section: "dashboard", canView: false, canEdit: false },
  { role: "contractor", section: "enquiries", canView: false, canEdit: false },
  { role: "contractor", section: "cases", canView: false, canEdit: false },
  { role: "contractor", section: "appointments", canView: false, canEdit: false },
  { role: "contractor", section: "clients", canView: false, canEdit: false },
  { role: "contractor", section: "mediators", canView: false, canEdit: false },
  { role: "contractor", section: "contractors", canView: false, canEdit: false },
  { role: "contractor", section: "documents", canView: false, canEdit: false },
  { role: "contractor", section: "contacts", canView: false, canEdit: false },
  { role: "contractor", section: "finance", canView: false, canEdit: false },
  { role: "contractor", section: "court_forms", canView: false, canEdit: false },
  { role: "contractor", section: "reports", canView: false, canEdit: false },
  { role: "contractor", section: "settings", canView: false, canEdit: false },
  { role: "contractor", section: "users", canView: false, canEdit: false },
  { role: "contractor", section: "audit_log", canView: false, canEdit: false },
  { role: "contractor", section: "services", canView: false, canEdit: false },
  { role: "contractor", section: "whatsapp", canView: false, canEdit: false },
];

export function mergeCanonicalPermissions(stored: readonly PermissionEntry[]): PermissionEntry[] {
  const storedByKey = new Map<string, PermissionEntry>();
  for (const entry of stored) {
    if (ROLES.includes(entry.role) && SECTIONS.includes(entry.section)) {
      storedByKey.set(`${entry.role}:${entry.section}`, entry);
    }
  }

  return DEFAULT_PERMISSIONS.map((fallback) => {
    const storedEntry = storedByKey.get(`${fallback.role}:${fallback.section}`);
    const area = CONFIGURABLE_AREA_BY_SECTION.get(fallback.section);
    const editSupported = !area || area.supportsEdit;
    if (!storedEntry) return { ...fallback, canEdit: editSupported ? fallback.canEdit : false };
    return {
      role: fallback.role,
      section: fallback.section,
      canView: storedEntry.canView,
      canEdit: editSupported && storedEntry.canView ? storedEntry.canEdit : false,
    };
  });
}

export function validatePermissionUpdates(input: unknown): PermissionEntry[] {
  if (!Array.isArray(input)) throw new Error("Permissions must be an array");

  const seen = new Set<string>();
  return input.map((value) => {
    if (!value || typeof value !== "object") throw new Error("Invalid permission entry");
    const entry = value as Record<string, unknown>;
    const { role, section, canView, canEdit } = entry;
    if (typeof role !== "string" || !CONFIGURABLE_ROLES.includes(role as (typeof CONFIGURABLE_ROLES)[number])) {
      throw new Error("Role is not configurable");
    }
    if (typeof section !== "string" || !CONFIGURABLE_AREA_BY_SECTION.has(section as Section)) {
      throw new Error("Section is not configurable");
    }
    if (typeof canView !== "boolean" || typeof canEdit !== "boolean") {
      throw new Error("Permission values must be booleans");
    }
    const key = `${role}:${section}`;
    if (seen.has(key)) throw new Error("Duplicate role and section combination");
    seen.add(key);

    const area = CONFIGURABLE_AREA_BY_SECTION.get(section as Section)!;
    if (!area.supportsEdit && canEdit) throw new Error("Edit is not supported for this section");
    if (canEdit && !canView) throw new Error("Edit permission requires view permission");

    return { role: role as Role, section: section as Section, canView, canEdit };
  });
}

export const ROLE_LABELS: Record<Role, string> = {
  superadmin: "Superadmin",
  subadmin: "Subadmin",
  staff: "Staff",
  mediator: "Mediator",
  client: "Client",
  contractor: "Contractor",
};

export const SECTION_LABELS: Record<Section, string> = {
  dashboard: "Dashboard",
  enquiries: "Enquiries",
  cases: "Cases",
  appointments: "Appointments",
  clients: "Clients",
  mediators: "Mediators",
  contractors: "Contractors",
  documents: "Documents",
  contacts: "Contacts",
  finance: "Finance",
  court_forms: "Court Forms",
  reports: "Reports",
  settings: "Settings",
  users: "Users",
  audit_log: "Audit Log",
  services: "Services",
  whatsapp: "WhatsApp",
};

export function canViewSection(
  permissions: PermissionEntry[],
  role: string,
  section: string
): boolean {
  if (role === "superadmin") return true;
  if (role === "client") return FIXED_CLIENT_ACCESS[section as Section]?.canView ?? false;
  const entry = permissions.find(
    (p) => p.role === role && p.section === section
  );
  return entry?.canView ?? false;
}

export function canEditSection(
  permissions: PermissionEntry[],
  role: string,
  section: string
): boolean {
  if (role === "superadmin") return true;
  if (role === "client") return FIXED_CLIENT_ACCESS[section as Section]?.canEdit ?? false;
  const entry = permissions.find(
    (p) => p.role === role && p.section === section
  );
  return entry?.canEdit ?? false;
}
