const tokenPattern = /\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/gi;

export function miamAvailabilityVariables(rows: Array<{ displayDate: string; times: string[] }>): Record<string, string> {
  return Object.fromEntries([0, 1, 2].flatMap(index => {
    const row = rows[index];
    return [[`date_${index + 1}`, row?.displayDate || ""], [`times_${index + 1}`, row?.times.join(", ") || ""]];
  }));
}

export function findTemplateVariables(value: string): string[] {
  const names = new Set<string>();
  for (const match of value.match(/\{\{\s*[a-z][a-z0-9_]*\s*\}\}/gi) || []) names.add(match.slice(2, -2).trim().toLowerCase());
  return Array.from(names);
}

export function validateTemplate(value: string, required: string[]): string[] {
  const present = new Set(findTemplateVariables(value));
  return required.filter(name => !present.has(name));
}

export function validatePublication(template: { code: string; subject: string; bodyHtml: string; requiredVariables: string[] }): string | null {
  if (!template.subject.trim()) return "A subject is required before publishing";
  if (!template.bodyHtml.replace(/<[^>]+>/g, "").trim()) return "A body is required before publishing";
  if (template.code === "N2" && template.bodyHtml.includes("Source wording is missing from the review document")) return "Replace the missing N2 source wording before publishing";
  if (/\{\{|\}\}/.test((template.subject + template.bodyHtml).replace(/\{\{\s*[a-z][a-z0-9_]*\s*\}\}/gi, ""))) return "Resolve incomplete or unsupported placeholders before publishing";
  const missing = validateTemplate(template.subject + template.bodyHtml, template.requiredVariables);
  return missing.length ? `Required variables are missing: ${missing.join(", ")}` : null;
}

export function renderTemplate(value: string, values: Record<string, string | null | undefined>, escapeHtml = true, options: { allowBlankOptionalVariables?: boolean; requiredVariables?: string[] } = {}): { output: string; missing: string[] } {
  const missing = new Set<string>();
  const required = new Set(options.requiredVariables || []);
  const output = value.replace(tokenPattern, (match, rawName: string) => {
    const name = rawName.toLowerCase();
    const item = values[name];
    if (item === undefined || item === null || item === "") {
      if (options.allowBlankOptionalVariables && !required.has(name)) return "";
      missing.add(name);
      return match;
    }
    return escapeHtml ? String(item).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;") : String(item);
  });
  return { output, missing: Array.from(missing) };
}
