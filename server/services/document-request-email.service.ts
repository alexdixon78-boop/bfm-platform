type DocumentRequestEmailContent = {
  clientName: string;
  caseRef: string;
  documentName: string;
  instructions?: string | null;
  requestUrl: string;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildDocumentRequestEmail(input: DocumentRequestEmailContent): { subject: string; html: string } {
  const subject = `Document requested — ${input.caseRef}`;
  const instructions = input.instructions?.trim()
    ? `<p><strong>Instructions:</strong> ${escapeHtml(input.instructions.trim())}</p>`
    : "";
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #5a7d58;">Document requested</h2>
      <p>Hello ${escapeHtml(input.clientName)},</p>
      <p>Brighter Future Mediation has requested <strong>${escapeHtml(input.documentName)}</strong> for case ${escapeHtml(input.caseRef)}.</p>
      ${instructions}
      <p><a href="${escapeHtml(input.requestUrl)}" style="display:inline-block;background:#5a7d58;color:#fff;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:700;">Upload document</a></p>
      <p>This link opens the Documents tab in your secure client portal.</p>
    </div>
  `;
  return { subject, html };
}

export async function sendClientDocumentRequestEmail(input: DocumentRequestEmailContent & { to: string }): Promise<boolean> {
  const [{ sendEmailWithAttachments }, { emailTemplateService }] = await Promise.all([
    import("./email.service"),
    import("./email-template.service"),
  ]);
  const fallback = buildDocumentRequestEmail(input);
  let rendered = { subject: fallback.subject, bodyHtml: fallback.html };
  try {
    rendered = await emailTemplateService.systemOverride("SYSTEM_CLIENT_DOCUMENT_REQUEST", {
      subject: fallback.subject,
      bodyHtml: fallback.html,
    }, {
      client_name: input.clientName,
      case_ref: input.caseRef,
      document_name: input.documentName,
      instructions: input.instructions || "",
      request_url: input.requestUrl,
      original_subject: fallback.subject,
    });
  } catch (error) {
    console.error("[Email] Client document request template unavailable; using current wording", error);
  }
  return sendEmailWithAttachments({ to: input.to, subject: rendered.subject, html: rendered.bodyHtml });
}
