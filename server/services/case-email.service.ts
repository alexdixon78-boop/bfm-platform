import { and, eq, inArray } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { db } from "../db";
import { bfmCalendarConnection, caseCommunicationLogs, caseEmailAttachments, caseEmailMessages, emailTemplates, mediationSessions, users } from "@shared/schema";
import { storage } from "../storage";
import { authService } from "./auth.service";
import { bookingService } from "./booking.service";
import { sendEmailWithAttachments } from "./email.service";
import { fileStorageService } from "./file-storage.service";
import { caseCommunicationLogService } from "./case-communication-log.service";
import { caseActivityService, staffActor } from "./case-activity.service";
import { emailTemplateService } from "./email-template.service";
import { validateTemplate } from "@shared/email-template-core";
import { BFM_EMAIL } from "./google-calendar.service";
import { buildCaseReplyAddress, hashCaseReplyToken, redactCaseReplyAddress } from "./gmail-case-reply-utils";
import { ensureBookingCta } from "./case-email-booking-cta";

export const PORTAL_INVITE_TEMPLATE_CODE = "PORTAL_INVITE";
export const MIAM_INVITE_TEMPLATE_CODE = "SYSTEM_MIAM_INVITE";
const portalBody = `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:auto"><h1>Brighter Future Mediation</h1><h2>You're Invited to the Client Portal</h2><p>Hello {{client_first_name}},</p><p>You've been invited to access the Brighter Future Mediation client portal. Click the button below to set up your password and activate your account.</p><p><a href="{{portal_link}}">Set Up Your Account</a></p><p>This invitation link will expire in 7 days. If it expires, please contact your mediator for a new invitation.</p></div>`;
const miamBody = `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:640px;margin:auto"><h1>Invitation to attend a MIAM</h1><p>Hello {{client_first_name}},</p><p>I am writing from Brighter Future Mediation because your ex-partner, {{other_party_first_name}}, recently attended a Mediation Information and Assessment Meeting (MIAM) with us. They have expressed their willingness to work together through mediation to reach agreement on {{mediation_scope}}.</p><h2>Your opportunity to participate</h2><p>We would like to invite you to attend your own MIAM, a confidential one-to-one online session lasting up to one hour with an FMC-registered mediator.</p><ul><li>discuss your situation and concerns in a safe, neutral space</li><li>understand all the options available to you</li><li>learn how mediation could help you reach arrangements that work for your family</li><li>ask questions and make an informed decision about next steps.</li></ul><p>You can find out more about MIAMs and mediation on our website.</p><p><a href="{{booking_link}}">Book your MIAM appointment</a></p><p>We understand this is a difficult time, and we are here to help.</p></div>`;

export type EmailActor = { id: string; name: string; role: string };
export type EmailRecipient = { kind: "client" | "staff"; partyId?: string; userId?: string; name: string; email: string; phone?: string | null };

function baseUrl() { if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, ""); if (process.env.BASE_URL) return process.env.BASE_URL.replace(/\/$/, ""); if (process.env.REPLIT_DEV_DOMAIN) return `https://${process.env.REPLIT_DEV_DOMAIN}`; if (process.env.REPL_SLUG) return `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`; return "http://localhost:5000"; }

class CaseEmailService {
  async ensureDefaults() {
    await db.insert(emailTemplates).values([
      { code: PORTAL_INVITE_TEMPLATE_CODE, name: "Portal invitation", subject: "You're Invited — Brighter Future Mediation Client Portal", bodyHtml: portalBody, kind: "system", status: "published", requiredVariables: ["client_first_name", "portal_link"] },
      { code: MIAM_INVITE_TEMPLATE_CODE, name: "MIAM invitation (current system)", subject: "An invitation to attend a MIAM, Brighter Future Mediation [{{case_ref}}]", bodyHtml: miamBody, kind: "system", status: "published", requiredVariables: ["client_first_name", "booking_link"] },
    ]).onConflictDoNothing();
    await emailTemplateService.ensureCatalog();
  }

  async listTemplates(includeArchived = false) { await this.ensureDefaults(); return emailTemplateService.list(includeArchived); }
  async getTemplate(id: string) { await this.ensureDefaults(); return (await db.select().from(emailTemplates).where(eq(emailTemplates.id, id)).limit(1))[0]; }
  async createTemplate(input: { code: string; name: string; subject: string; bodyHtml: string }, actor: EmailActor) {
    return emailTemplateService.create(input, actor.id);
  }
  async updateTemplate(id: string, input: Partial<{ code: string; name: string; subject: string; bodyHtml: string; isArchived: boolean }>, actor: EmailActor) {
    return emailTemplateService.update(id, input, actor);
  }

  async recipients(caseId: string, actor: EmailActor): Promise<EmailRecipient[]> {
    const parties = await storage.listPartiesByCase(caseId);
    const clientRecipients = parties.filter(p => p.email).map(p => ({ kind: "client" as const, partyId: p.id, name: `${p.firstName} ${p.lastName}`.trim(), email: p.email!, phone: p.phone }));
    if (actor.role !== "superadmin") return clientRecipients;
    const sessions = await storage.listMediationSessionsByCase(caseId);
    const leadIds = Array.from(new Set(sessions.map(s => s.leadMediatorId).filter((id): id is string => !!id)));
    const staff = (await storage.listUsers()).filter(u => u.status === "active" && (u.role === "subadmin" || (u.role === "mediator" && leadIds.includes(u.id))) && !!u.email);
    return [...clientRecipients, ...staff.map(u => ({ kind: "staff" as const, userId: u.id, name: u.name, email: u.email, phone: null }))];
  }

  async composeContext(caseId: string, actor: EmailActor) {
    const caseRow = await storage.getCase(caseId);
    if (!caseRow) throw new Error("Case not found");
    const [templates, recipients, mediator] = await Promise.all([
      emailTemplateService.availableForCompose(),
      this.recipients(caseId, actor),
      caseRow.mediatorId ? storage.getUser(caseRow.mediatorId) : Promise.resolve(undefined),
    ]);
    const availabilityPreview = await bookingService.buildMiamAvailabilityPreviewForAcknowledgement("", { mediatorId: caseRow.mediatorId || undefined });
    const availabilityLabel = availabilityPreview.source === "lead_mediator" && mediator
      ? `Suggested availability from lead mediator ${mediator.name}`
      : "Suggested general MIAM availability";
    return { templates, recipients, availabilityPreview: { ...availabilityPreview, label: availabilityLabel } };
  }

  async send(caseId: string, actor: EmailActor, input: { recipient: EmailRecipient; templateId?: string | null; subject: string; bodyHtml: string; purpose?: "portal_invite" | "miam_booking" | "manual"; includeBookingLink?: boolean; mediationScope?: string; documentIds?: string[]; variables?: Record<string, string> }) {
    const selectedTemplate = input.templateId ? await this.getTemplate(input.templateId) : undefined;
    if (input.templateId && (!selectedTemplate || selectedTemplate.isArchived || selectedTemplate.status !== "published" || selectedTemplate.kind === "calendar")) throw new Error("Selected template is unavailable");
    if (selectedTemplate?.kind === "system" && validateTemplate(input.bodyHtml, selectedTemplate.requiredVariables).length) throw new Error("Required security variables cannot be removed");
    const allowed = (await this.recipients(caseId, actor)).find(r => (r.partyId && r.partyId === input.recipient.partyId) || (r.userId && r.userId === input.recipient.userId));
    if (!allowed || allowed.email !== input.recipient.email) throw new Error("Recipient is not available for this case");
    if (input.includeBookingLink && allowed.kind !== "client") throw new Error("Booking links can only be sent to case clients");
    const caseRow = await storage.getCase(caseId); if (!caseRow) throw new Error("Case not found");
    const party = allowed.partyId ? await storage.getParty(allowed.partyId) : undefined;
    const other = party ? (await storage.listPartiesByCase(caseId)).find(p => p.id !== party.id) : undefined;
    let portalLink = ""; let bookingLink = "";
    if (input.purpose === "portal_invite") { if (!party) throw new Error("Portal invites require a client"); const result = await authService.generateInviteToken(party.id, { sendEmail: false }); if (!result.ok) throw new Error(result.error); portalLink = `${baseUrl()}${result.inviteUrl}`; }
    if (input.includeBookingLink || input.purpose === "miam_booking") { if (!party) throw new Error("Booking links require a client"); const result = await bookingService.generateBookingLink(party.id, staffActor(actor), { sendEmail: false }); if (!result.ok) throw new Error(result.error); bookingLink = `${baseUrl()}${result.bookingUrl}`; }
    const values = { ...(input.variables || {}), client_first_name: party?.firstName || allowed.name, other_party_first_name: other?.firstName || input.variables?.other_party_first_name || "", case_ref: caseRow.caseRef, mediation_scope: input.mediationScope || input.variables?.mediation_scope || "", portal_link: portalLink, booking_link: bookingLink };
    const rendered = await emailTemplateService.render(input.subject, input.bodyHtml, values, selectedTemplate?.requiredVariables || [], false, { allowBlankOptionalVariables: true });
    if (rendered.missing.length) throw new Error(`Fill template variables before sending: ${rendered.missing.join(", ")}`);
    const subject = rendered.subject;
    const bodyHtml = bookingLink ? ensureBookingCta(rendered.bodyHtml, bookingLink) : rendered.bodyHtml;
    const docs = await Promise.all((input.documentIds || []).map(id => storage.getCaseDocument(id)));
    if (docs.some(d => !d || d.caseId !== caseId)) throw new Error("An attachment does not belong to this case");
    const attachments = await Promise.all(docs.filter(Boolean).map(async d => { const opened = await fileStorageService.openCaseDocumentByStorageKey(d!.storageKey!); const chunks: Buffer[] = []; for await (const chunk of opened.body) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)); return { content: Buffer.concat(chunks).toString("base64"), filename: d!.fileName, type: d!.mimeType || "application/octet-stream", disposition: "attachment" }; }));
    const [gmailConnection] = await db
      .select({ email: bfmCalendarConnection.googleCalendarEmail })
      .from(bfmCalendarConnection)
      .where(eq(bfmCalendarConnection.id, "bfm"))
      .limit(1);
    const replyToken = randomBytes(24).toString("hex");
    const replyToEmail = buildCaseReplyAddress(gmailConnection?.email || BFM_EMAIL, replyToken);
    const log = await caseCommunicationLogService.record({ caseId, caseRef: caseRow.caseRef, partyId: allowed.partyId || null, recipientType: allowed.kind, recipientName: allowed.name, recipientEmail: allowed.email, recipientPhone: allowed.phone, channel: "email", direction: "outbound", trigger: input.purpose || "manual", templateName: selectedTemplate?.name || null, subject, deliveryStatus: "queued", actorType: "staff", actorId: actor.id, actorName: actor.name, preview: bodyHtml, metadata: { includeBookingLink: Boolean(bookingLink), portalLink: Boolean(portalLink) } });
    if (!log) throw new Error("Email dispatch was recorded incompletely");
    const [message] = await db.insert(caseEmailMessages).values({ communicationLogId: log.id, templateId: input.templateId || null, templateCode: selectedTemplate?.code || null, subject, bodyHtml, recipientKind: allowed.kind, recipientUserId: allowed.userId || null, includedBookingLink: Boolean(bookingLink), replyTokenHash: hashCaseReplyToken(replyToken), replyToEmail: redactCaseReplyAddress(replyToEmail) }).returning();
    if (message && docs.length) await db.insert(caseEmailAttachments).values(docs.filter(Boolean).map(d => ({ emailMessageId: message.id, documentId: d!.id, fileName: d!.fileName })));
    const sent = await sendEmailWithAttachments({ to: allowed.email, replyTo: replyToEmail, subject, html: bodyHtml, attachments });
    await db.update(caseCommunicationLogs).set({ deliveryStatus: sent ? "sent" : "failed", updatedAt: new Date() }).where(eq(caseCommunicationLogs.id, log.id));
    if (sent) {
      await caseActivityService.log({
        caseId,
        type: "email_sent",
        title: "Email sent",
        description: `Email sent to ${allowed.name || allowed.email}: ${subject}`,
        direction: "outbound",
        relatedEntityId: log.id,
        relatedEntityType: "case_communication",
        metadata: JSON.stringify({ recipientName: allowed.name, recipientEmail: allowed.email, subject, deliveryStatus: "sent", communicationLogId: log.id }),
        actor: staffActor(actor),
      });
    }
    return { sent, message, communicationLogId: log.id, inviteUrl: portalLink || bookingLink || null };
  }
}
export const caseEmailService = new CaseEmailService();
