const suffixByFirstName: Record<string, string> = {
  davina: "D", greig: "G", jo: "J", kate: "K", milly: "Mi", manpreet: "Ma",
};

export function calendarTemplateCode(serviceName: string | null | undefined, mediatorName: string | null | undefined): string | null {
  const suffix = suffixByFirstName[(mediatorName || "").trim().split(/\s+/)[0].toLowerCase()];
  if (!suffix) return null;
  if (/\bMIAM\b/i.test(serviceName || "")) return `M4-${suffix}`;
  if (serviceName === "Mediation Sessions") return `F4-${suffix}`;
  return null;
}
