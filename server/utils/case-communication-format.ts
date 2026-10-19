const CASE_REF_RE = /\b(BFM-\d{4}-\d{4})(?:-[A-Z])?\b/i;

export function canonicalCaseRef(caseRef?: string | null): string {
  const match = String(caseRef || "").trim().match(CASE_REF_RE);
  return match ? match[1].toUpperCase() : "";
}

export function formatCaseEmailSubject(subject: string, caseRef?: string | null): string {
  const canonical = canonicalCaseRef(caseRef);
  if (!canonical) return subject;

  let clean = subject.trim();
  const trailingSameRef = new RegExp(
    String.raw`(?:\s*(?:-|\u2013|\u2014)?\s*\[?${canonical}(?:-[A-Z])?\]?\s*)+$`,
    "i",
  );
  clean = clean.replace(trailingSameRef, "").trim();
  return `${clean} [${canonical}]`;
}

function firstName(name?: string | null, fallback = ""): string {
  const first = String(name || "").trim().split(/\s+/).filter(Boolean)[0];
  return first || fallback;
}

export function formatMiamCalendarTitle(input: {
  mediatorName?: string | null;
  clientFirstName?: string | null;
  caseRef?: string | null;
}): string {
  const mediator = firstName(input.mediatorName, "Mediator");
  const client = firstName(input.clientFirstName, "Client");
  const ref = canonicalCaseRef(input.caseRef);
  return `MIAM - ${mediator} - ${client}${ref ? ` [${ref}]` : ""}`;
}

export function formatSessionCalendarTitle(input: {
  mediatorName?: string | null;
  clientAFirstName?: string | null;
  clientBFirstName?: string | null;
  caseRef?: string | null;
}): string {
  const mediator = firstName(input.mediatorName, "Mediator");
  const clientA = firstName(input.clientAFirstName, "Client A");
  const clientB = firstName(input.clientBFirstName, "Client B");
  const ref = canonicalCaseRef(input.caseRef);
  return `Session - ${mediator} - ${clientA} and ${clientB}${ref ? ` [${ref}]` : ""}`;
}
