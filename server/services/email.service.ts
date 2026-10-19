import { formatCaseEmailSubject } from "../utils/case-communication-format";
import { emailTemplateService } from "./email-template.service";
import { logAudit } from "./audit-log.service";
import { formatAppointmentDate, formatAppointmentDateRange, formatAppointmentTime, type BookingTimeBasis } from "@shared/booking-time";

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
const SENDGRID_REQUEST_TIMEOUT_MS = 10_000;
// SENDGRID_FROM_EMAIL lets you swap the verified SendGrid sender without a code
// deploy — useful when the default domain is awaiting sender verification.
const FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL || "info@brighterfuturemediation.co.uk";
const FROM_NAME = "Brighter Future Mediation";
// ADMIN_NOTIFICATION_EMAIL is the inbox that receives internal CRM alerts
// (e.g. new mediator applications). Decoupled from FROM_EMAIL so that
// swapping a verified sender never re-routes admin notifications.
const ADMIN_NOTIFICATION_EMAIL = process.env.ADMIN_NOTIFICATION_EMAIL || "info@brighterfuturemediation.co.uk";

interface EmailAttachment {
  content: string;
  filename: string;
  type: string;
  disposition: string;
}

interface EmailParams {
  to: string;
  replyTo?: string;
  subject: string;
  html: string;
  attachments?: EmailAttachment[];
  templateCode?: string;
  templateValues?: Record<string, string>;
}

function humanizeSendGridError(status: number, statusText: string, body: string): string {
  const trimmed = body.trim();
  if (!trimmed) {
    return `SendGrid returned ${status} ${statusText}`;
  }

  try {
    const parsed = JSON.parse(trimmed) as {
      errors?: Array<{ message?: string; field?: string; help?: string }>;
      message?: string;
    };
    if (Array.isArray(parsed.errors) && parsed.errors.length > 0) {
      const details = parsed.errors
        .map((error) => {
          const field = error.field ? `${error.field}: ` : "";
          const help = error.help ? ` (${error.help})` : "";
          return `${field}${error.message ?? "Unknown SendGrid error"}${help}`;
        })
        .filter(Boolean)
        .join("; ");
      if (details) {
        return `SendGrid returned ${status} ${statusText}: ${details}`;
      }
    }
    if (parsed.message) {
      return `SendGrid returned ${status} ${statusText}: ${parsed.message}`;
    }
  } catch {
    // Fall back to the raw response text below.
  }

  return `SendGrid returned ${status} ${statusText}: ${trimmed}`;
}

export async function sendEmailWithAttachments(params: EmailParams): Promise<boolean> {
  if (!SENDGRID_API_KEY) {
    console.error("[Email] SENDGRID_API_KEY not configured");
    return false;
  }

  try {
    const payload: Record<string, unknown> = {
      personalizations: [{ to: [{ email: params.to }] }],
      from: { email: FROM_EMAIL, name: FROM_NAME },
      subject: params.subject,
      content: [{ type: "text/html", value: params.html }],
    };
    if (params.replyTo) payload.reply_to = { email: params.replyTo };
    if (params.attachments?.length) {
      payload.attachments = params.attachments;
    }

    const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SENDGRID_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(SENDGRID_REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(`[Email] ${humanizeSendGridError(res.status, res.statusText, body)} while sending "${params.subject}" to ${params.to}`);
      return false;
    }

    console.log(`[Email] Sent "${params.subject}" to ${params.to}`);
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[Email] Failed to send "${params.subject}" to ${params.to}: ${message}`);
    return false;
  }
}

async function sendEmail(params: EmailParams): Promise<boolean> {
  if (!params.templateCode) return sendEmailWithAttachments(params);
  try {
    const rendered = await emailTemplateService.systemOverride(params.templateCode, { subject: params.subject, bodyHtml: params.html }, { ...params.templateValues, original_subject: params.subject });
    const sent = await sendEmailWithAttachments({ ...params, subject: rendered.subject, html: rendered.bodyHtml });
    await logAudit({ action: "send_system_email", entity: "email_template", entityRef: params.templateCode, details: JSON.stringify({ recipient: params.to, sent }) });
    return sent;
  } catch (error) {
    console.error(`[Email] Template ${params.templateCode} could not render:`, error);
    const sent = await sendEmailWithAttachments(params);
    await logAudit({ action: "send_system_email_fallback", entity: "email_template", entityRef: params.templateCode, details: JSON.stringify({ recipient: params.to, sent }) });
    return sent;
  }
}

export async function sendMediatorInviteEmail(to: string, name: string, inviteUrl: string): Promise<boolean> {
  const html = `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 560px; margin: 0 auto; padding: 0;">
      <div style="background: linear-gradient(135deg, #6b6b6b 0%, #4a4a4a 100%); padding: 32px 24px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="color: #ffffff; font-size: 22px; margin: 0; font-weight: 600;">Brighter Future Mediation</h1>
        <p style="color: rgba(255,255,255,0.7); font-size: 13px; margin: 6px 0 0;">Mediator Portal</p>
      </div>
      <div style="background: #ffffff; padding: 32px 24px; border: 1px solid #e5e7eb; border-top: none;">
        <h2 style="color: #333; font-size: 18px; margin: 0 0 16px;">You've been invited to join Brighter Future Mediation</h2>
        <p style="color: #555; font-size: 14px; line-height: 1.6; margin: 0 0 16px;">
          Hello ${name},
        </p>
        <p style="color: #555; font-size: 14px; line-height: 1.6; margin: 0 0 24px;">
          An account has been created for you on the Brighter Future Mediation platform. Click the button below to set up your password and access your mediator account.
        </p>
        <div style="text-align: center; margin: 0 0 24px;">
          <a href="${inviteUrl}" style="display: inline-block; background-color: #5a7d58; color: #ffffff; text-decoration: none; padding: 12px 32px; border-radius: 6px; font-size: 14px; font-weight: 600;">
            Set Up Your Account
          </a>
        </div>
        <p style="color: #888; font-size: 12px; line-height: 1.5; margin: 0 0 8px;">
          This invitation link will expire in 7 days. If it expires, please contact your administrator for a new invitation.
        </p>
        <p style="color: #888; font-size: 12px; line-height: 1.5; margin: 0;">
          If the button doesn't work, copy and paste this link into your browser:<br/>
          <a href="${inviteUrl}" style="color: #5a7d58; word-break: break-all;">${inviteUrl}</a>
        </p>
      </div>
      <div style="padding: 16px 24px; text-align: center; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px; background: #fafafa;">
        <p style="color: #aaa; font-size: 11px; margin: 0;">
          Brighter Future Mediation Ltd &middot; FMC Accredited
        </p>
      </div>
    </div>
  `;

  return sendEmail({ templateCode: "SYSTEM_MEDIATOR_INVITE", templateValues: { "name": String(name), "invite_url": String(inviteUrl) }, to, subject: "You've been invited to join Brighter Future Mediation", html });
}

export async function sendTeamUserInviteEmail(to: string, name: string, inviteUrl: string): Promise<boolean> {
  const html = `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 560px; margin: 0 auto; padding: 0;">
      <div style="background: linear-gradient(135deg, #6b6b6b 0%, #4a4a4a 100%); padding: 32px 24px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="color: #ffffff; font-size: 22px; margin: 0; font-weight: 600;">Brighter Future Mediation</h1>
        <p style="color: rgba(255,255,255,0.7); font-size: 13px; margin: 6px 0 0;">Team account</p>
      </div>
      <div style="background: #ffffff; padding: 32px 24px; border: 1px solid #e5e7eb; border-top: none;">
        <h2 style="color: #333; font-size: 18px; margin: 0 0 16px;">You've been invited to join Brighter Future Mediation</h2>
        <p style="color: #555; font-size: 14px; line-height: 1.6; margin: 0 0 16px;">Hello ${name},</p>
        <p style="color: #555; font-size: 14px; line-height: 1.6; margin: 0 0 24px;">Your team account is ready. Use the secure link below to set your password and activate it.</p>
        <div style="text-align: center; margin: 0 0 24px;"><a href="${inviteUrl}" style="display: inline-block; background-color: #5a7d58; color: #ffffff; text-decoration: none; padding: 12px 32px; border-radius: 6px; font-size: 14px; font-weight: 600;">Set Up Your Account</a></div>
        <p style="color: #888; font-size: 12px; line-height: 1.5; margin: 0;">This invitation link expires in 7 days. If it expires, contact your administrator for a new invitation.</p>
      </div>
    </div>
  `;
  return sendEmail({ templateCode: "SYSTEM_TEAM_USER_INVITE", templateValues: { name: String(name), invite_url: String(inviteUrl) }, to, subject: "You've been invited to join Brighter Future Mediation", html });
}

export async function sendMediatorServiceProofRequestEmail(
  to: string,
  name: string,
  serviceName: string,
  profileUrl: string,
): Promise<boolean> {
  const subject = `Service proof requested — ${serviceName}`;
  const html = `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 560px; margin: 0 auto; padding: 0;">
      <div style="background: linear-gradient(135deg, #6b6b6b 0%, #4a4a4a 100%); padding: 28px 24px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="color: #ffffff; font-size: 21px; margin: 0; font-weight: 600;">Brighter Future Mediation</h1>
        <p style="color: rgba(255,255,255,0.75); font-size: 13px; margin: 6px 0 0;">Service Proof Request</p>
      </div>
      <div style="background: #ffffff; padding: 32px 24px; border: 1px solid #e5e7eb; border-top: none;">
        <p style="color: #333; font-size: 14px; line-height: 1.6; margin: 0 0 16px;">
          Hello ${name},
        </p>
        <p style="color: #555; font-size: 14px; line-height: 1.6; margin: 0 0 16px;">
          An admin has requested service-specific proof for <strong>${serviceName}</strong>.
        </p>
        <p style="color: #555; font-size: 14px; line-height: 1.6; margin: 0 0 24px;">
          Please sign in to your mediator profile and upload a file or supporting link from the Service offering tab.
        </p>
        <div style="text-align: center; margin: 0 0 24px;">
          <a href="${profileUrl}" style="display: inline-block; background-color: #5a7d58; color: #ffffff; text-decoration: none; padding: 12px 30px; border-radius: 6px; font-size: 14px; font-weight: 600;">
            Open Service Offering
          </a>
        </div>
        <p style="color: #777; font-size: 12px; line-height: 1.5; margin: 0;">
          This request is also available in your BFM dashboard tasks.
        </p>
      </div>
      <div style="padding: 16px 24px; text-align: center; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px; background: #fafafa;">
        <p style="color: #aaa; font-size: 11px; margin: 0;">
          Brighter Future Mediation Ltd &middot; FMC Accredited &middot; Supporting you from conflict to resolution
        </p>
      </div>
    </div>
  `;
  return sendEmail({ templateCode: "SYSTEM_MEDIATOR_SERVICE_PROOF_REQUEST", templateValues: { "name": String(name), "service_name": String(serviceName), "profile_url": String(profileUrl) }, to, subject, html });
}

export async function sendMediatorServiceApprovalDecisionEmail(
  to: string,
  name: string,
  serviceName: string,
  decision: "approved" | "rejected" | "revoked",
  profileUrl: string,
  reviewReason?: string | null,
): Promise<boolean> {
  const decisionLabel = decision === "approved" ? "approved" : decision === "revoked" ? "revoked" : "rejected";
  const subject = `Service approval ${decisionLabel} — ${serviceName}`;
  const heading = decision === "approved"
    ? "Service Approval Confirmed"
    : decision === "revoked"
      ? "Service Approval Revoked"
      : "Service Approval Update";
  const body = decision === "approved"
    ? `Your service approval for <strong>${serviceName}</strong> has been approved.`
    : decision === "revoked"
      ? `Your service approval for <strong>${serviceName}</strong> has been revoked. Please review the reason and upload fresh proof from your mediator profile.`
      : `Your service proof for <strong>${serviceName}</strong> was not approved. Please review the reason and upload updated proof from your mediator profile.`;
  const reason = reviewReason?.trim();
  const html = `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 560px; margin: 0 auto; padding: 0;">
      <div style="background: linear-gradient(135deg, #6b6b6b 0%, #4a4a4a 100%); padding: 28px 24px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="color: #ffffff; font-size: 21px; margin: 0; font-weight: 600;">Brighter Future Mediation</h1>
        <p style="color: rgba(255,255,255,0.75); font-size: 13px; margin: 6px 0 0;">${heading}</p>
      </div>
      <div style="background: #ffffff; padding: 32px 24px; border: 1px solid #e5e7eb; border-top: none;">
        <p style="color: #333; font-size: 14px; line-height: 1.6; margin: 0 0 16px;">Hello ${name},</p>
        <p style="color: #555; font-size: 14px; line-height: 1.6; margin: 0 0 16px;">${body}</p>
        ${reason ? `<p style="color: #555; font-size: 14px; line-height: 1.6; margin: 0 0 24px;"><strong>Reason:</strong> ${reason}</p>` : ""}
        <div style="text-align: center; margin: 0 0 24px;">
          <a href="${profileUrl}" style="display: inline-block; background-color: #5a7d58; color: #ffffff; text-decoration: none; padding: 12px 30px; border-radius: 6px; font-size: 14px; font-weight: 600;">
            Open Service Proof
          </a>
        </div>
        <p style="color: #777; font-size: 12px; line-height: 1.5; margin: 0;">
          This update is also available in your BFM dashboard notifications.
        </p>
      </div>
      <div style="padding: 16px 24px; text-align: center; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px; background: #fafafa;">
        <p style="color: #aaa; font-size: 11px; margin: 0;">
          Brighter Future Mediation Ltd &middot; FMC Accredited &middot; Supporting you from conflict to resolution
        </p>
      </div>
    </div>
  `;
  return sendEmail({ templateCode: "SYSTEM_MEDIATOR_SERVICE_APPROVAL_DECISION", templateValues: { "heading": String(heading), "name": String(name), "body": String(body), "value_4": String(reason ? `<p style="color: #555; font-size: 14px; line-height: 1.6; margin: 0 0 24px;"><strong>Reason:</strong> ${reason}</p>` : ""), "profile_url": String(profileUrl) }, to, subject, html });
}

export async function sendMediationSessionParticipantInviteEmail(
  to: string,
  name: string,
  roleLabel: string,
  caseRef: string,
  sessionNumber: number,
  proposedStartAt: Date,
  inviteUrl: string,
  options: { isReschedule?: boolean } = {},
): Promise<boolean> {
  const dateStr = proposedStartAt.toLocaleString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  });

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #5a7d58;">${options.isReschedule ? "Rescheduled mediation session invitation" : "Mediation session invitation"}</h2>
      <p>Hello ${name},</p>
      <p>${options.isReschedule ? "A replacement time has been proposed" : "You have been invited"} as ${roleLabel} for Mediation Session ${sessionNumber} on case ${caseRef}.</p>
      <p><strong>Proposed time:</strong> ${dateStr}</p>
      <p>Please accept or decline this ${options.isReschedule ? "rescheduled " : ""}session invitation using the secure link below.</p>
      <p style="margin: 30px 0;">
        <a href="${inviteUrl}" style="background-color: #5a7d58; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px;">Respond to invitation</a>
      </p>
      <p style="color: #666; font-size: 14px;">If the button doesn't work, copy and paste this link into your browser:</p>
      <p style="word-break: break-all; color: #666; font-size: 14px;">${inviteUrl}</p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
      <p style="color: #999; font-size: 12px;">Brighter Future Mediation</p>
    </div>
  `;

  return sendEmail({ templateCode: "SYSTEM_MEDIATION_SESSION_PARTICIPANT_INVITE", templateValues: { "value_1": String(options.isReschedule ? "Rescheduled mediation session invitation" : "Mediation session invitation"), "name": String(name), "value_3": String(options.isReschedule ? "A replacement time has been proposed" : "You have been invited"), "role_label": String(roleLabel), "session_number": String(sessionNumber), "case_ref": String(caseRef), "date_str": String(dateStr), "value_8": String(options.isReschedule ? "rescheduled " : ""), "invite_url": String(inviteUrl) }, to, subject: formatCaseEmailSubject(`${options.isReschedule ? "Rescheduled " : ""}Mediation Session ${sessionNumber} invitation`, caseRef), html });
}

export async function sendMediationSessionProposalEmail(
  to: string,
  name: string,
  caseRef: string,
  sessionNumber: number,
  proposedStartAt: Date,
  responseUrl: string,
  options: { isReschedule?: boolean; alreadyPaid?: boolean } = {},
): Promise<boolean> {
  const dateStr = proposedStartAt.toLocaleString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  });

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #5a7d58;">${options.isReschedule ? "Mediation session rescheduled" : "Mediation session proposed"}</h2>
      <p>Hello ${name},</p>
      <p>${options.isReschedule ? "A replacement slot has been proposed" : "A slot has been proposed"} for Mediation Session ${sessionNumber} on case ${caseRef}.</p>
      <p><strong>Proposed time:</strong> ${dateStr}</p>
      <p>Please confirm whether you can attend using your secure response link below.</p>
      ${options.isReschedule && options.alreadyPaid ? "<p>Your existing payment for this mediation session has been preserved, so you will not be charged again.</p>" : ""}
      ${options.isReschedule && !options.alreadyPaid ? "<p>If payment is still required, your response link will continue through the existing payment workflow.</p>" : ""}
      <p style="margin: 30px 0;">
        <a href="${responseUrl}" style="background-color: #5a7d58; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px;">Respond to proposed slot</a>
      </p>
      <p style="color: #666; font-size: 14px;">This link is only for ${name}. If the button doesn't work, copy and paste this link into your browser:</p>
      <p style="word-break: break-all; color: #666; font-size: 14px;">${responseUrl}</p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
      <p style="color: #999; font-size: 12px;">Brighter Future Mediation</p>
    </div>
  `;

  return sendEmail({ templateCode: "SYSTEM_MEDIATION_SESSION_PROPOSAL", templateValues: { "value_1": String(options.isReschedule ? "Mediation session rescheduled" : "Mediation session proposed"), "name": String(name), "value_3": String(options.isReschedule ? "A replacement slot has been proposed" : "A slot has been proposed"), "session_number": String(sessionNumber), "case_ref": String(caseRef), "date_str": String(dateStr), "value_7": String(options.isReschedule && options.alreadyPaid ? "<p>Your existing payment for this mediation session has been preserved, so you will not be charged again.</p>" : ""), "value_8": String(options.isReschedule && !options.alreadyPaid ? "<p>If payment is still required, your response link will continue through the existing payment workflow.</p>" : ""), "response_url": String(responseUrl) }, to, subject: formatCaseEmailSubject(options.isReschedule ? `Mediation Session ${sessionNumber} rescheduled` : `Mediation Session ${sessionNumber} proposed`, caseRef), html });
}

export async function sendMediationSessionRequiredFormEmail(
  to: string,
  name: string,
  caseRef: string,
  sessionNumber: number,
  proposedStartAt: Date,
  formNames: string[],
  actionUrl: string,
): Promise<boolean> {
  const dateStr = proposedStartAt.toLocaleString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  });
  const forms = formNames.length > 0 ? formNames.join(", ") : "required mediation forms";

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #5a7d58;">Mediation forms ready to sign</h2>
      <p>Hello ${name},</p>
      <p>Please sign ${forms} for Mediation Session ${sessionNumber} on case ${caseRef}.</p>
      <p><strong>Session time:</strong> ${dateStr}</p>
      <p>You can complete this from your case's Mediation Sessions tab.</p>
      <p style="margin: 30px 0;">
        <a href="${actionUrl}" style="background-color: #5a7d58; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px;">Open mediation session forms</a>
      </p>
      <p style="color: #666; font-size: 14px;">If the button doesn't work, copy and paste this link into your browser:</p>
      <p style="word-break: break-all; color: #666; font-size: 14px;">${actionUrl}</p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
      <p style="color: #999; font-size: 12px;">Brighter Future Mediation</p>
    </div>
  `;

  return sendEmail({ templateCode: "SYSTEM_MEDIATION_SESSION_REQUIRED_FORM", templateValues: { "name": String(name), "forms": String(forms), "session_number": String(sessionNumber), "case_ref": String(caseRef), "date_str": String(dateStr), "action_url": String(actionUrl) }, to, subject: formatCaseEmailSubject(`Sign Mediation Session ${sessionNumber} forms`, caseRef), html });
}

export async function sendContractorInviteEmail(to: string, name: string, inviteUrl: string): Promise<boolean> {
  const html = `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 560px; margin: 0 auto; padding: 0;">
      <div style="background: linear-gradient(135deg, #6b6b6b 0%, #4a4a4a 100%); padding: 32px 24px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="color: #ffffff; font-size: 22px; margin: 0; font-weight: 600;">Brighter Future Mediation</h1>
        <p style="color: rgba(255,255,255,0.7); font-size: 13px; margin: 6px 0 0;">Contractor Portal</p>
      </div>
      <div style="background: #ffffff; padding: 32px 24px; border: 1px solid #e5e7eb; border-top: none;">
        <h2 style="color: #333; font-size: 18px; margin: 0 0 16px;">You've been invited to join Brighter Future Mediation</h2>
        <p style="color: #555; font-size: 14px; line-height: 1.6; margin: 0 0 16px;">
          Hello ${name},
        </p>
        <p style="color: #555; font-size: 14px; line-height: 1.6; margin: 0 0 24px;">
          A contractor account has been created for you on the Brighter Future Mediation platform. Click the button below to set up your password and activate your account.
        </p>
        <div style="text-align: center; margin: 0 0 24px;">
          <a href="${inviteUrl}" style="display: inline-block; background-color: #5a7d58; color: #ffffff; text-decoration: none; padding: 12px 32px; border-radius: 6px; font-size: 14px; font-weight: 600;">
            Set Up Your Account
          </a>
        </div>
        <p style="color: #888; font-size: 12px; line-height: 1.5; margin: 0 0 8px;">
          This invitation link will expire in 7 days. If it expires, please contact your administrator for a new invitation.
        </p>
        <p style="color: #888; font-size: 12px; line-height: 1.5; margin: 0;">
          If the button doesn't work, copy and paste this link into your browser:<br/>
          <a href="${inviteUrl}" style="color: #5a7d58; word-break: break-all;">${inviteUrl}</a>
        </p>
      </div>
      <div style="padding: 16px 24px; text-align: center; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px; background: #fafafa;">
        <p style="color: #aaa; font-size: 11px; margin: 0;">
          Brighter Future Mediation Ltd &middot; FMC Accredited
        </p>
      </div>
    </div>
  `;

  return sendEmail({ templateCode: "SYSTEM_CONTRACTOR_INVITE", templateValues: { "name": String(name), "invite_url": String(inviteUrl) }, to, subject: "You've been invited to join Brighter Future Mediation", html });
}

export async function sendPasswordResetEmail(to: string, name: string, resetUrl: string): Promise<boolean> {
  const html = `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 560px; margin: 0 auto; padding: 0;">
      <div style="background: linear-gradient(135deg, #6b6b6b 0%, #4a4a4a 100%); padding: 32px 24px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="color: #ffffff; font-size: 22px; margin: 0; font-weight: 600;">Brighter Future Mediation</h1>
        <p style="color: rgba(255,255,255,0.7); font-size: 13px; margin: 6px 0 0;">Case Management System</p>
      </div>
      <div style="background: #ffffff; padding: 32px 24px; border: 1px solid #e5e7eb; border-top: none;">
        <h2 style="color: #333; font-size: 18px; margin: 0 0 16px;">Password Reset Request</h2>
        <p style="color: #555; font-size: 14px; line-height: 1.6; margin: 0 0 16px;">
          Hello ${name},
        </p>
        <p style="color: #555; font-size: 14px; line-height: 1.6; margin: 0 0 24px;">
          We received a request to reset your password. Click the button below to set a new password. This link will expire in 1 hour.
        </p>
        <div style="text-align: center; margin: 0 0 24px;">
          <a href="${resetUrl}" style="display: inline-block; background-color: #5a7d58; color: #ffffff; text-decoration: none; padding: 12px 32px; border-radius: 6px; font-size: 14px; font-weight: 600;">
            Reset Password
          </a>
        </div>
        <p style="color: #888; font-size: 12px; line-height: 1.5; margin: 0 0 8px;">
          If you didn't request a password reset, you can safely ignore this email. Your password will remain unchanged.
        </p>
        <p style="color: #888; font-size: 12px; line-height: 1.5; margin: 0;">
          If the button doesn't work, copy and paste this link into your browser:<br/>
          <a href="${resetUrl}" style="color: #5a7d58; word-break: break-all;">${resetUrl}</a>
        </p>
      </div>
      <div style="padding: 16px 24px; text-align: center; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px; background: #fafafa;">
        <p style="color: #aaa; font-size: 11px; margin: 0;">
          Brighter Future Mediation Ltd &middot; FMC Accredited
        </p>
      </div>
    </div>
  `;

  return sendEmail({ templateCode: "SYSTEM_PASSWORD_RESET", templateValues: { "name": String(name), "reset_url": String(resetUrl) }, to, subject: "Reset Your Password — Brighter Future Mediation", html });
}

export async function sendWhatsAppCaseOtpEmail(to: string, name: string, caseRef: string, code: string): Promise<boolean> {
  const html = `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 560px; margin: 0 auto; padding: 0;">
      <div style="background: linear-gradient(135deg, #0f766e 0%, #115e59 100%); padding: 32px 24px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="color: #ffffff; font-size: 22px; margin: 0; font-weight: 600;">Brighter Future Mediation</h1>
        <p style="color: rgba(255,255,255,0.78); font-size: 13px; margin: 6px 0 0;">WhatsApp case verification</p>
      </div>
      <div style="background: #ffffff; padding: 32px 24px; border: 1px solid #e5e7eb; border-top: none;">
        <h2 style="color: #333; font-size: 18px; margin: 0 0 16px;">Your verification code</h2>
        <p style="color: #555; font-size: 14px; line-height: 1.6; margin: 0 0 16px;">Hello ${name},</p>
        <p style="color: #555; font-size: 14px; line-height: 1.6; margin: 0 0 20px;">
          Use this code in WhatsApp to access case ${caseRef}. It expires in 10 minutes.
        </p>
        <div style="font-size: 28px; letter-spacing: 8px; font-weight: 700; color: #111827; background: #f3f4f6; border-radius: 8px; padding: 16px 20px; text-align: center; margin: 0 0 20px;">
          ${code}
        </div>
        <p style="color: #888; font-size: 12px; line-height: 1.5; margin: 0;">
          If you did not request this code, please ignore this email and contact Brighter Future Mediation.
        </p>
      </div>
      <div style="padding: 16px 24px; text-align: center; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px; background: #fafafa;">
        <p style="color: #aaa; font-size: 11px; margin: 0;">Brighter Future Mediation Ltd &middot; Confidential case support</p>
      </div>
    </div>
  `;

  return sendEmail({ templateCode: "SYSTEM_WHATS_APP_CASE_OTP", templateValues: { "name": String(name), "case_ref": String(caseRef), "code": String(code) }, to, subject: formatCaseEmailSubject("Your WhatsApp verification code", caseRef), html });
}

export async function sendPortalInviteEmail(to: string, name: string, inviteUrl: string): Promise<boolean> {
  const html = `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 560px; margin: 0 auto; padding: 0;">
      <div style="background: linear-gradient(135deg, #6b6b6b 0%, #4a4a4a 100%); padding: 32px 24px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="color: #ffffff; font-size: 22px; margin: 0; font-weight: 600;">Brighter Future Mediation</h1>
        <p style="color: rgba(255,255,255,0.7); font-size: 13px; margin: 6px 0 0;">Client Portal</p>
      </div>
      <div style="background: #ffffff; padding: 32px 24px; border: 1px solid #e5e7eb; border-top: none;">
        <h2 style="color: #333; font-size: 18px; margin: 0 0 16px;">You're Invited to the Client Portal</h2>
        <p style="color: #555; font-size: 14px; line-height: 1.6; margin: 0 0 16px;">
          Hello ${name},
        </p>
        <p style="color: #555; font-size: 14px; line-height: 1.6; margin: 0 0 24px;">
          You've been invited to access the Brighter Future Mediation client portal. Click the button below to set up your password and activate your account.
        </p>
        <div style="text-align: center; margin: 0 0 24px;">
          <a href="${inviteUrl}" style="display: inline-block; background-color: #5a7d58; color: #ffffff; text-decoration: none; padding: 12px 32px; border-radius: 6px; font-size: 14px; font-weight: 600;">
            Set Up Your Account
          </a>
        </div>
        <p style="color: #888; font-size: 12px; line-height: 1.5; margin: 0 0 8px;">
          This invitation link will expire in 7 days. If it expires, please contact your mediator for a new invitation.
        </p>
        <p style="color: #888; font-size: 12px; line-height: 1.5; margin: 0;">
          If the button doesn't work, copy and paste this link into your browser:<br/>
          <a href="${inviteUrl}" style="color: #5a7d58; word-break: break-all;">${inviteUrl}</a>
        </p>
      </div>
      <div style="padding: 16px 24px; text-align: center; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px; background: #fafafa;">
        <p style="color: #aaa; font-size: 11px; margin: 0;">
          Brighter Future Mediation Ltd &middot; FMC Accredited
        </p>
      </div>
    </div>
  `;

  return sendEmail({ templateCode: "SYSTEM_PORTAL_INVITE", templateValues: { "name": String(name), "invite_url": String(inviteUrl) }, to, subject: "You're Invited — Brighter Future Mediation Client Portal", html });
}

export async function sendBookingLinkEmail(to: string, name: string, bookingUrl: string, serviceTypeName: string, caseRef?: string): Promise<boolean> {
  const html = `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 560px; margin: 0 auto; padding: 0;">
      <div style="background: linear-gradient(135deg, #6b6b6b 0%, #4a4a4a 100%); padding: 32px 24px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="color: #ffffff; font-size: 22px; margin: 0; font-weight: 600;">Brighter Future Mediation</h1>
        <p style="color: rgba(255,255,255,0.7); font-size: 13px; margin: 6px 0 0;">Appointment Booking</p>
      </div>
      <div style="background: #ffffff; padding: 32px 24px; border: 1px solid #e5e7eb; border-top: none;">
        <h2 style="color: #333; font-size: 18px; margin: 0 0 16px;">Book Your Appointment</h2>
        <p style="color: #555; font-size: 14px; line-height: 1.6; margin: 0 0 16px;">
          Hello ${name},
        </p>
        <p style="color: #555; font-size: 14px; line-height: 1.6; margin: 0 0 8px;">
          You've been invited to book an appointment${caseRef ? ` for your case (${caseRef})` : ""}:
        </p>
        <p style="color: #333; font-size: 15px; font-weight: 600; margin: 0 0 24px; padding: 12px 16px; background: #f8f9fa; border-radius: 6px; border-left: 3px solid #5a7d58;">
          ${serviceTypeName}
        </p>
        <p style="color: #555; font-size: 14px; line-height: 1.6; margin: 0 0 24px;">
          Click the button below to choose a date and time that works for you.
        </p>
        <div style="text-align: center; margin: 0 0 24px;">
          <a href="${bookingUrl}" style="display: inline-block; background-color: #5a7d58; color: #ffffff; text-decoration: none; padding: 12px 32px; border-radius: 6px; font-size: 14px; font-weight: 600;">
            Book Appointment
          </a>
        </div>
        <p style="color: #888; font-size: 12px; line-height: 1.5; margin: 0 0 8px;">
          This booking link will expire in 7 days. If it expires, please contact your mediator for a new link.
        </p>
        <p style="color: #888; font-size: 12px; line-height: 1.5; margin: 0;">
          If the button doesn't work, copy and paste this link into your browser:<br/>
          <a href="${bookingUrl}" style="color: #5a7d58; word-break: break-all;">${bookingUrl}</a>
        </p>
      </div>
      <div style="padding: 16px 24px; text-align: center; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px; background: #fafafa;">
        <p style="color: #aaa; font-size: 11px; margin: 0;">
          Brighter Future Mediation Ltd &middot; FMC Accredited
        </p>
      </div>
    </div>
  `;

  return sendEmail({ templateCode: "SYSTEM_BOOKING_LINK", templateValues: { "name": String(name), "value_2": String(caseRef ? ` for your case (${caseRef})` : ""), "service_type_name": String(serviceTypeName), "booking_url": String(bookingUrl) }, to, subject: formatCaseEmailSubject(`Book Your ${serviceTypeName} — Brighter Future Mediation`, caseRef), html });
}

export async function sendXeroInvoicePaymentEmail(
  to: string,
  name: string,
  serviceTypeName: string,
  caseRef: string,
  invoiceUrl: string,
  amountPence: number,
  currency: string,
  appointmentDate: Date,
  timeBasis: BookingTimeBasis = "wall_clock_utc",
): Promise<boolean> {
  const amount = new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amountPence / 100);
  const dateStr = formatAppointmentDate(appointmentDate, timeBasis);
  const timeStr = formatAppointmentTime(appointmentDate, timeBasis);

  const html = `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 560px; margin: 0 auto; padding: 0;">
      <div style="background: linear-gradient(135deg, #6b6b6b 0%, #4a4a4a 100%); padding: 32px 24px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="color: #ffffff; font-size: 22px; margin: 0; font-weight: 600;">Brighter Future Mediation</h1>
        <p style="color: rgba(255,255,255,0.7); font-size: 13px; margin: 6px 0 0;">Secure invoice payment</p>
      </div>
      <div style="background: #ffffff; padding: 32px 24px; border: 1px solid #e5e7eb; border-top: none;">
        <h2 style="color: #333; font-size: 18px; margin: 0 0 16px;">Your MIAM invoice is ready</h2>
        <p style="color: #555; font-size: 14px; line-height: 1.6; margin: 0 0 16px;">Hello ${name},</p>
        <p style="color: #555; font-size: 14px; line-height: 1.6; margin: 0 0 16px;">
          Your appointment slot is currently reserved pending payment. Please use the secure invoice link below to pay by card.
        </p>
        <div style="background: #faf8f5; border-radius: 8px; padding: 18px; margin: 0 0 24px; border: 1px solid #e5e7eb;">
          <p style="color:#333; font-size:14px; margin:0 0 6px;"><strong>Case:</strong> ${caseRef}</p>
          <p style="color:#333; font-size:14px; margin:0 0 6px;"><strong>Service:</strong> ${serviceTypeName}</p>
          <p style="color:#333; font-size:14px; margin:0 0 6px;"><strong>Appointment:</strong> ${dateStr} at ${timeStr}</p>
          <p style="color:#333; font-size:14px; margin:0;"><strong>Amount:</strong> ${amount}</p>
        </div>
        <div style="text-align: center; margin: 0 0 24px;">
          <a href="${invoiceUrl}" style="display: inline-block; background-color: #5a7d58; color: #ffffff; text-decoration: none; padding: 14px 38px; border-radius: 6px; font-size: 15px; font-weight: 700;">
            Pay invoice
          </a>
        </div>
        <p style="color: #888; font-size: 12px; line-height: 1.5; margin: 0;">
          Payment is processed through Xero's secure online invoice payment service. Your appointment is confirmed only after payment is received.
        </p>
      </div>
      <div style="padding: 16px 24px; text-align: center; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px; background: #fafafa;">
        <p style="color: #aaa; font-size: 11px; margin: 0;">Brighter Future Mediation Ltd &middot; FMC Accredited</p>
      </div>
    </div>
  `;

  return sendEmail({ templateCode: "SYSTEM_XERO_INVOICE_PAYMENT", templateValues: { "name": String(name), "case_ref": String(caseRef), "service_type_name": String(serviceTypeName), "date_str": String(dateStr), "time_str": String(timeStr), "amount": String(amount), "invoice_url": String(invoiceUrl) }, to, subject: formatCaseEmailSubject(`Invoice payment: ${serviceTypeName}`, caseRef), html });
}

export async function sendBookingConfirmationEmail(to: string, name: string, serviceTypeName: string, dateTime: Date, durationMinutes: number, icsContent?: string, bookingMode: "hold" | "held" | "confirmed" = "hold", caseRef?: string): Promise<boolean> {
  const dateStr = dateTime.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const timeStr = dateTime.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
  const endTime = new Date(dateTime.getTime() + durationMinutes * 60000);
  const endTimeStr = endTime.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });

  const html = `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 560px; margin: 0 auto; padding: 0;">
      <div style="background: linear-gradient(135deg, #6b6b6b 0%, #4a4a4a 100%); padding: 32px 24px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="color: #ffffff; font-size: 22px; margin: 0; font-weight: 600;">Brighter Future Mediation</h1>
        <p style="color: rgba(255,255,255,0.7); font-size: 13px; margin: 6px 0 0;">Appointment Confirmation</p>
      </div>
      <div style="background: #ffffff; padding: 32px 24px; border: 1px solid #e5e7eb; border-top: none;">
        <h2 style="color: #333; font-size: 18px; margin: 0 0 16px;">${bookingMode === "confirmed" ? "Your Appointment is Confirmed" : "Your Appointment is Pending Payment"}</h2>
        <p style="color: #555; font-size: 14px; line-height: 1.6; margin: 0 0 16px;">
          Hello ${name},
        </p>
        <p style="color: #555; font-size: 14px; line-height: 1.6; margin: 0 0 24px;">
          ${bookingMode === "confirmed"
            ? "Your appointment has been confirmed. Here are the details:"
            : "Your appointment slot has been reserved in the CRM pending payment or voucher acceptance before the hold deadline. Calendar details will be sent after confirmation:"
          }
        </p>
        <div style="background: #f8f9fa; border-radius: 8px; padding: 20px; margin: 0 0 24px; border: 1px solid #e5e7eb;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 6px 0; color: #888; font-size: 13px; width: 110px;">Service</td>
              <td style="padding: 6px 0; color: #333; font-size: 14px; font-weight: 500;">${serviceTypeName}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #888; font-size: 13px;">Date</td>
              <td style="padding: 6px 0; color: #333; font-size: 14px; font-weight: 500;">${dateStr}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #888; font-size: 13px;">Time</td>
              <td style="padding: 6px 0; color: #333; font-size: 14px; font-weight: 500;">${timeStr} – ${endTimeStr}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #888; font-size: 13px;">Duration</td>
              <td style="padding: 6px 0; color: #333; font-size: 14px; font-weight: 500;">${durationMinutes} minutes</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #888; font-size: 13px;">Format</td>
              <td style="padding: 6px 0; color: #333; font-size: 14px; font-weight: 500;">Online (video call)</td>
            </tr>
          </table>
        </div>
        <p style="color: #555; font-size: 14px; line-height: 1.6; margin: 0 0 8px;">
          ${bookingMode === "confirmed"
            ? "A joining link will be sent to you before your appointment. Please ensure you have a stable internet connection and a quiet space."
            : "Once confirmed, a joining link will be sent to you before your appointment. Please ensure you have a stable internet connection and a quiet space."
          }
        </p>
        <p style="color: #888; font-size: 12px; line-height: 1.5; margin: 16px 0 0;">
          If you need to reschedule or cancel, please contact us as soon as possible at info@brighterfuturemediation.co.uk.
        </p>
      </div>
      <div style="padding: 16px 24px; text-align: center; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px; background: #fafafa;">
        <p style="color: #aaa; font-size: 11px; margin: 0;">
          Brighter Future Mediation Ltd &middot; FMC Accredited
        </p>
      </div>
    </div>
  `;

  const attachments: EmailAttachment[] = [];
  if (icsContent) {
    attachments.push({
      content: Buffer.from(icsContent).toString("base64"),
      filename: "appointment.ics",
      type: "text/calendar",
      disposition: "attachment",
    });
  }

  const subject = bookingMode === "confirmed"
    ? `Appointment Confirmed: ${serviceTypeName} — ${dateStr}`
    : `Payment Pending: ${serviceTypeName} — ${dateStr}`;
  return sendEmail({ templateCode: "SYSTEM_BOOKING_CONFIRMATION", templateValues: { "value_1": String(bookingMode === "confirmed" ? "Your Appointment is Confirmed" : "Your Appointment is Pending Payment"), "name": String(name), "value_3": String(bookingMode === "confirmed"
            ? "Your appointment has been confirmed. Here are the details:"
            : "Your appointment slot has been reserved in the CRM pending payment or voucher acceptance before the hold deadline. Calendar details will be sent after confirmation:"), "service_type_name": String(serviceTypeName), "date_str": String(dateStr), "time_str": String(timeStr), "end_time_str": String(endTimeStr), "duration_minutes": String(durationMinutes), "value_9": String(bookingMode === "confirmed"
            ? "A joining link will be sent to you before your appointment. Please ensure you have a stable internet connection and a quiet space."
            : "Once confirmed, a joining link will be sent to you before your appointment. Please ensure you have a stable internet connection and a quiet space.") }, to, subject: formatCaseEmailSubject(subject, caseRef), html, attachments });
}

export async function sendBookingHoldCountdownEmail(
  to: string,
  name: string,
  serviceTypeName: string,
  dateTime: Date,
  durationMinutes: number,
  caseRef?: string,
  timeBasis: BookingTimeBasis = "wall_clock_utc",
): Promise<boolean> {
  const { date: dateStr, startTime: timeStr, endTime: endTimeStr } = formatAppointmentDateRange(
    dateTime,
    durationMinutes,
    timeBasis,
  );

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #5a7d58;">Appointment hold countdown</h2>
      <p>Hello ${name},</p>
      <p>Your ${serviceTypeName} slot is currently reserved and is now within 72 hours of the appointment time.</p>
      <p><strong>Appointment:</strong> ${dateStr}, ${timeStr} - ${endTimeStr}</p>
      <p>Please contact Brighter Future Mediation if you have any questions about the next steps for this held appointment.</p>
      <p style="color: #666; font-size: 13px;">If this has already been resolved, no further action is needed.</p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
      <p style="color: #999; font-size: 12px;">Brighter Future Mediation</p>
    </div>
  `;

  return sendEmail({ templateCode: "SYSTEM_BOOKING_HOLD_COUNTDOWN", templateValues: { "name": String(name), "service_type_name": String(serviceTypeName), "date_str": String(dateStr), "time_str": String(timeStr), "end_time_str": String(endTimeStr) }, to, subject: formatCaseEmailSubject(`Appointment hold countdown: ${serviceTypeName}`, caseRef), html });
}

export async function sendAppointmentReminderEmail(
  to: string,
  name: string,
  serviceTypeName: string,
  dateTime: Date,
  durationMinutes: number,
  reminderLabel: string,
  caseRef?: string,
  timeBasis: BookingTimeBasis = "wall_clock_utc",
): Promise<boolean> {
  const { date: dateStr, startTime: timeStr, endTime: endTimeStr } = formatAppointmentDateRange(
    dateTime,
    durationMinutes,
    timeBasis,
  );

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #5a7d58;">Appointment reminder</h2>
      <p>Hello ${name},</p>
      <p>This is your ${reminderLabel} reminder for your confirmed ${serviceTypeName} appointment.</p>
      <p><strong>Appointment:</strong> ${dateStr}, ${timeStr} - ${endTimeStr}</p>
      <p>Please make sure you have a quiet private space and a stable internet connection.</p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
      <p style="color: #999; font-size: 12px;">Brighter Future Mediation</p>
    </div>
  `;

  return sendEmail({ templateCode: "SYSTEM_APPOINTMENT_REMINDER", templateValues: { "name": String(name), "reminder_label": String(reminderLabel), "service_type_name": String(serviceTypeName), "date_str": String(dateStr), "time_str": String(timeStr), "end_time_str": String(endTimeStr) }, to, subject: formatCaseEmailSubject(`${reminderLabel} reminder: ${serviceTypeName}`, caseRef), html });
}

export async function sendMediatorBookingNotificationEmail(
  to: string,
  mediatorName: string,
  clientName: string,
  serviceTypeName: string,
  dateTime: Date,
  durationMinutes: number,
  caseRef: string,
  icsContent?: string,
  bookingMode: "hold" | "held" | "confirmed" = "hold"
): Promise<boolean> {
  const dateStr = dateTime.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const timeStr = dateTime.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
  const endTime = new Date(dateTime.getTime() + durationMinutes * 60000);
  const endTimeStr = endTime.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });

  const statusLabel = bookingMode === "confirmed" ? "Confirmed" : "Payment pending";

  const html = `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 560px; margin: 0 auto; padding: 0;">
      <div style="background: linear-gradient(135deg, #6b6b6b 0%, #4a4a4a 100%); padding: 32px 24px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="color: #ffffff; font-size: 22px; margin: 0; font-weight: 600;">Brighter Future Mediation</h1>
        <p style="color: rgba(255,255,255,0.7); font-size: 13px; margin: 6px 0 0;">New Booking Notification</p>
      </div>
      <div style="background: #ffffff; padding: 32px 24px; border: 1px solid #e5e7eb; border-top: none;">
        <h2 style="color: #333; font-size: 18px; margin: 0 0 16px;">${bookingMode === "confirmed" ? "New Appointment Confirmed" : "New Payment Hold"}</h2>
        <p style="color: #555; font-size: 14px; line-height: 1.6; margin: 0 0 24px;">
          Hello ${mediatorName}, a client has ${bookingMode === "confirmed" ? "confirmed" : "requested"} an appointment with you.
        </p>
        <div style="background: #f8f9fa; border-radius: 8px; padding: 20px; margin: 0 0 24px; border: 1px solid #e5e7eb;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 6px 0; color: #888; font-size: 13px; width: 110px;">Client</td>
              <td style="padding: 6px 0; color: #333; font-size: 14px; font-weight: 500;">${clientName}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #888; font-size: 13px;">Case</td>
              <td style="padding: 6px 0; color: #333; font-size: 14px; font-weight: 500;">${caseRef}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #888; font-size: 13px;">Service</td>
              <td style="padding: 6px 0; color: #333; font-size: 14px; font-weight: 500;">${serviceTypeName}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #888; font-size: 13px;">Date</td>
              <td style="padding: 6px 0; color: #333; font-size: 14px; font-weight: 500;">${dateStr}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #888; font-size: 13px;">Time</td>
              <td style="padding: 6px 0; color: #333; font-size: 14px; font-weight: 500;">${timeStr} – ${endTimeStr}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #888; font-size: 13px;">Status</td>
              <td style="padding: 6px 0; color: #333; font-size: 14px; font-weight: 500;">${statusLabel}</td>
            </tr>
          </table>
        </div>
        <p style="color: #555; font-size: 14px; line-height: 1.6; margin: 0 0 8px;">
          ${bookingMode === "confirmed"
            ? "This appointment has been confirmed by the client. Please review in the CRM."
            : "This appointment is reserved in the CRM pending payment or voucher acceptance. Staff receive a 72-hours-before payment alert, and unpaid or unaccepted holds may auto-cancel 55 hours before the appointment."
          }
        </p>
      </div>
      <div style="padding: 16px 24px; text-align: center; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px; background: #fafafa;">
        <p style="color: #aaa; font-size: 11px; margin: 0;">
          Brighter Future Mediation Ltd &middot; FMC Accredited
        </p>
      </div>
    </div>
  `;

  const attachments: EmailAttachment[] = [];
  if (icsContent) {
    attachments.push({
      content: Buffer.from(icsContent).toString("base64"),
      filename: "appointment.ics",
      type: "text/calendar",
      disposition: "attachment",
    });
  }

  const subject = bookingMode === "confirmed"
    ? `Appointment Confirmed: ${clientName} — ${serviceTypeName} on ${dateStr}`
    : `Payment Hold: ${clientName} — ${serviceTypeName} on ${dateStr}`;
  return sendEmail({ templateCode: "SYSTEM_MEDIATOR_BOOKING_NOTIFICATION", templateValues: { "value_1": String(bookingMode === "confirmed" ? "New Appointment Confirmed" : "New Payment Hold"), "mediator_name": String(mediatorName), "value_3": String(bookingMode === "confirmed" ? "confirmed" : "requested"), "client_name": String(clientName), "case_ref": String(caseRef), "service_type_name": String(serviceTypeName), "date_str": String(dateStr), "time_str": String(timeStr), "end_time_str": String(endTimeStr), "status_label": String(statusLabel), "value_11": String(bookingMode === "confirmed"
            ? "This appointment has been confirmed by the client. Please review in the CRM."
            : "This appointment is reserved in the CRM pending payment or voucher acceptance. Staff receive a 72-hours-before payment alert, and unpaid or unaccepted holds may auto-cancel 55 hours before the appointment.") }, to, subject: formatCaseEmailSubject(subject, caseRef), html, attachments });
}

export async function sendAppointmentCancelledEmail(
  to: string,
  name: string,
  serviceTypeName: string,
  dateTime: Date,
  durationMinutes: number,
  reason: "cancelled" | "expired" = "cancelled",
  caseRef?: string,
  icsContent?: string,
  timeBasis: BookingTimeBasis = "wall_clock_utc",
): Promise<boolean> {
  const dateStr = formatAppointmentDate(dateTime, timeBasis);
  const timeStr = formatAppointmentTime(dateTime, timeBasis);
  const endTime = new Date(dateTime.getTime() + durationMinutes * 60000);
  const endTimeStr = formatAppointmentTime(endTime, timeBasis);

  const reasonText = reason === "expired"
    ? "Unfortunately, your payment hold was not confirmed within the required timeframe and has been automatically cancelled."
    : "Your appointment has been cancelled. If you believe this is an error or would like to rebook, please contact us.";

  const html = `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 560px; margin: 0 auto; padding: 0;">
      <div style="background: linear-gradient(135deg, #6b6b6b 0%, #4a4a4a 100%); padding: 32px 24px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="color: #ffffff; font-size: 22px; margin: 0; font-weight: 600;">Brighter Future Mediation</h1>
        <p style="color: rgba(255,255,255,0.7); font-size: 13px; margin: 6px 0 0;">Appointment Update</p>
      </div>
      <div style="background: #ffffff; padding: 32px 24px; border: 1px solid #e5e7eb; border-top: none;">
        <h2 style="color: #c53030; font-size: 18px; margin: 0 0 16px;">Appointment Cancelled</h2>
        <p style="color: #555; font-size: 14px; line-height: 1.6; margin: 0 0 16px;">
          Hello ${name},
        </p>
        <p style="color: #555; font-size: 14px; line-height: 1.6; margin: 0 0 24px;">
          ${reasonText}
        </p>
        <div style="background: #fef2f2; border-radius: 8px; padding: 20px; margin: 0 0 24px; border: 1px solid #fecaca;">
          <table style="width: 100%; border-collapse: collapse;">
            ${caseRef ? `<tr><td style="padding: 6px 0; color: #888; font-size: 13px; width: 110px;">Case</td><td style="padding: 6px 0; color: #333; font-size: 14px; font-weight: 500;">${caseRef}</td></tr>` : ""}
            <tr>
              <td style="padding: 6px 0; color: #888; font-size: 13px; width: 110px;">Service</td>
              <td style="padding: 6px 0; color: #333; font-size: 14px; font-weight: 500;">${serviceTypeName}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #888; font-size: 13px;">Date</td>
              <td style="padding: 6px 0; color: #333; font-size: 14px; font-weight: 500;">${dateStr}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #888; font-size: 13px;">Time</td>
              <td style="padding: 6px 0; color: #333; font-size: 14px; font-weight: 500;">${timeStr} – ${endTimeStr}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #888; font-size: 13px;">Status</td>
              <td style="padding: 6px 0; color: #c53030; font-size: 14px; font-weight: 600;">Cancelled</td>
            </tr>
          </table>
        </div>
        <p style="color: #555; font-size: 14px; line-height: 1.6; margin: 0 0 8px;">
          If you would like to rebook, please contact us at info@brighterfuturemediation.co.uk or speak to your mediator.
        </p>
      </div>
      <div style="padding: 16px 24px; text-align: center; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px; background: #fafafa;">
        <p style="color: #aaa; font-size: 11px; margin: 0;">
          Brighter Future Mediation Ltd &middot; FMC Accredited
        </p>
      </div>
    </div>
  `;

  const attachments: EmailAttachment[] = [];
  if (icsContent) {
    attachments.push({
      content: Buffer.from(icsContent).toString("base64"),
      filename: "appointment.ics",
      type: "text/calendar",
      disposition: "attachment",
    });
  }

  return sendEmail({ templateCode: "SYSTEM_APPOINTMENT_CANCELLED", templateValues: { "name": String(name), "reason_text": String(reasonText), "value_3": String(caseRef ? `<tr><td style="padding: 6px 0; color: #888; font-size: 13px; width: 110px;">Case</td><td style="padding: 6px 0; color: #333; font-size: 14px; font-weight: 500;">${caseRef}</td></tr>` : ""), "service_type_name": String(serviceTypeName), "date_str": String(dateStr), "time_str": String(timeStr), "end_time_str": String(endTimeStr) }, to, subject: formatCaseEmailSubject(`Appointment Cancelled: ${serviceTypeName} — ${dateStr}`, caseRef), html, attachments });
}

export async function sendMediatorAppointmentCancelledEmail(
  to: string,
  mediatorName: string,
  clientName: string,
  serviceTypeName: string,
  dateTime: Date,
  durationMinutes: number,
  caseRef: string,
  reason: "cancelled" | "expired" = "cancelled",
  icsContent?: string,
  timeBasis: BookingTimeBasis = "wall_clock_utc",
): Promise<boolean> {
  const dateStr = formatAppointmentDate(dateTime, timeBasis);
  const timeStr = formatAppointmentTime(dateTime, timeBasis);
  const endTime = new Date(dateTime.getTime() + durationMinutes * 60000);
  const endTimeStr = formatAppointmentTime(endTime, timeBasis);

  const reasonText = reason === "expired"
    ? "The payment hold was not confirmed within 72 hours and has been automatically cancelled."
    : "An appointment has been cancelled by an administrator.";

  const html = `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 560px; margin: 0 auto; padding: 0;">
      <div style="background: linear-gradient(135deg, #6b6b6b 0%, #4a4a4a 100%); padding: 32px 24px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="color: #ffffff; font-size: 22px; margin: 0; font-weight: 600;">Brighter Future Mediation</h1>
        <p style="color: rgba(255,255,255,0.7); font-size: 13px; margin: 6px 0 0;">Appointment Update</p>
      </div>
      <div style="background: #ffffff; padding: 32px 24px; border: 1px solid #e5e7eb; border-top: none;">
        <h2 style="color: #c53030; font-size: 18px; margin: 0 0 16px;">Appointment Cancelled</h2>
        <p style="color: #555; font-size: 14px; line-height: 1.6; margin: 0 0 16px;">
          Hello ${mediatorName},
        </p>
        <p style="color: #555; font-size: 14px; line-height: 1.6; margin: 0 0 24px;">
          ${reasonText}
        </p>
        <div style="background: #fef2f2; border-radius: 8px; padding: 20px; margin: 0 0 24px; border: 1px solid #fecaca;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr><td style="padding: 6px 0; color: #888; font-size: 13px; width: 110px;">Client</td><td style="padding: 6px 0; color: #333; font-size: 14px; font-weight: 500;">${clientName}</td></tr>
            <tr><td style="padding: 6px 0; color: #888; font-size: 13px;">Case</td><td style="padding: 6px 0; color: #333; font-size: 14px; font-weight: 500;">${caseRef}</td></tr>
            <tr><td style="padding: 6px 0; color: #888; font-size: 13px;">Service</td><td style="padding: 6px 0; color: #333; font-size: 14px; font-weight: 500;">${serviceTypeName}</td></tr>
            <tr><td style="padding: 6px 0; color: #888; font-size: 13px;">Date</td><td style="padding: 6px 0; color: #333; font-size: 14px; font-weight: 500;">${dateStr}</td></tr>
            <tr><td style="padding: 6px 0; color: #888; font-size: 13px;">Time</td><td style="padding: 6px 0; color: #333; font-size: 14px; font-weight: 500;">${timeStr} – ${endTimeStr}</td></tr>
            <tr><td style="padding: 6px 0; color: #888; font-size: 13px;">Status</td><td style="padding: 6px 0; color: #c53030; font-size: 14px; font-weight: 600;">Cancelled</td></tr>
          </table>
        </div>
        <p style="color: #555; font-size: 14px; line-height: 1.6; margin: 0;">
          ${reason === "expired" ? "The time slot is now available for other bookings." : "Please review in the CRM for further action."}
        </p>
      </div>
      <div style="padding: 16px 24px; text-align: center; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px; background: #fafafa;">
        <p style="color: #aaa; font-size: 11px; margin: 0;">
          Brighter Future Mediation Ltd &middot; FMC Accredited
        </p>
      </div>
    </div>
  `;

  const attachments: EmailAttachment[] = [];
  if (icsContent) {
    attachments.push({
      content: Buffer.from(icsContent).toString("base64"),
      filename: "appointment.ics",
      type: "text/calendar",
      disposition: "attachment",
    });
  }

  return sendEmail({ templateCode: "SYSTEM_MEDIATOR_APPOINTMENT_CANCELLED", templateValues: { "mediator_name": String(mediatorName), "reason_text": String(reasonText), "client_name": String(clientName), "case_ref": String(caseRef), "service_type_name": String(serviceTypeName), "date_str": String(dateStr), "time_str": String(timeStr), "end_time_str": String(endTimeStr), "value_9": String(reason === "expired" ? "The time slot is now available for other bookings." : "Please review in the CRM for further action.") }, to, subject: formatCaseEmailSubject(`Appointment Cancelled: ${clientName} — ${serviceTypeName} on ${dateStr}`, caseRef), html, attachments });
}

export async function sendAppointmentConfirmedUpdateEmail(
  to: string,
  name: string,
  serviceTypeName: string,
  dateTime: Date,
  durationMinutes: number,
  icsContent?: string,
  caseRef?: string,
  timeBasis: BookingTimeBasis = "wall_clock_utc",
): Promise<boolean> {
  const dateStr = formatAppointmentDate(dateTime, timeBasis);
  const timeStr = formatAppointmentTime(dateTime, timeBasis);
  const endTime = new Date(dateTime.getTime() + durationMinutes * 60000);
  const endTimeStr = formatAppointmentTime(endTime, timeBasis);

  const html = `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 560px; margin: 0 auto; padding: 0;">
      <div style="background: linear-gradient(135deg, #6b6b6b 0%, #4a4a4a 100%); padding: 32px 24px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="color: #ffffff; font-size: 22px; margin: 0; font-weight: 600;">Brighter Future Mediation</h1>
        <p style="color: rgba(255,255,255,0.7); font-size: 13px; margin: 6px 0 0;">Appointment Confirmed</p>
      </div>
      <div style="background: #ffffff; padding: 32px 24px; border: 1px solid #e5e7eb; border-top: none;">
        <h2 style="color: #5a7d58; font-size: 18px; margin: 0 0 16px;">Your Appointment is Confirmed</h2>
        <p style="color: #555; font-size: 14px; line-height: 1.6; margin: 0 0 16px;">
          Hello ${name},
        </p>
        <p style="color: #555; font-size: 14px; line-height: 1.6; margin: 0 0 24px;">
          Great news — your appointment has been confirmed. Here are the details:
        </p>
        <div style="background: #f0fdf4; border-radius: 8px; padding: 20px; margin: 0 0 24px; border: 1px solid #bbf7d0;">
          <table style="width: 100%; border-collapse: collapse;">
            ${caseRef ? `<tr><td style="padding: 6px 0; color: #888; font-size: 13px; width: 110px;">Case</td><td style="padding: 6px 0; color: #333; font-size: 14px; font-weight: 500;">${caseRef}</td></tr>` : ""}
            <tr>
              <td style="padding: 6px 0; color: #888; font-size: 13px; width: 110px;">Service</td>
              <td style="padding: 6px 0; color: #333; font-size: 14px; font-weight: 500;">${serviceTypeName}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #888; font-size: 13px;">Date</td>
              <td style="padding: 6px 0; color: #333; font-size: 14px; font-weight: 500;">${dateStr}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #888; font-size: 13px;">Time</td>
              <td style="padding: 6px 0; color: #333; font-size: 14px; font-weight: 500;">${timeStr} – ${endTimeStr}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #888; font-size: 13px;">Timezone</td>
              <td style="padding: 6px 0; color: #333; font-size: 14px; font-weight: 500;">UK time (Europe/London)</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #888; font-size: 13px;">Duration</td>
              <td style="padding: 6px 0; color: #333; font-size: 14px; font-weight: 500;">${durationMinutes} minutes</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #888; font-size: 13px;">Format</td>
              <td style="padding: 6px 0; color: #333; font-size: 14px; font-weight: 500;">Online (video call)</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #888; font-size: 13px;">Status</td>
              <td style="padding: 6px 0; color: #5a7d58; font-size: 14px; font-weight: 600;">Confirmed ✓</td>
            </tr>
          </table>
        </div>
        <p style="color: #555; font-size: 14px; line-height: 1.6; margin: 0 0 8px;">
          A joining link will be sent to you before your appointment. Please ensure you have a stable internet connection and a quiet space.
        </p>
        <p style="color: #888; font-size: 12px; line-height: 1.5; margin: 16px 0 0;">
          If you need to reschedule or cancel, please contact us as soon as possible at info@brighterfuturemediation.co.uk.
        </p>
      </div>
      <div style="padding: 16px 24px; text-align: center; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px; background: #fafafa;">
        <p style="color: #aaa; font-size: 11px; margin: 0;">
          Brighter Future Mediation Ltd &middot; FMC Accredited
        </p>
      </div>
    </div>
  `;

  const attachments: EmailAttachment[] = [];
  if (icsContent) {
    attachments.push({
      content: Buffer.from(icsContent).toString("base64"),
      filename: "appointment.ics",
      type: "text/calendar",
      disposition: "attachment",
    });
  }

  return sendEmail({ templateCode: "SYSTEM_APPOINTMENT_CONFIRMED_UPDATE", templateValues: { "name": String(name), "value_2": String(caseRef ? `<tr><td style="padding: 6px 0; color: #888; font-size: 13px; width: 110px;">Case</td><td style="padding: 6px 0; color: #333; font-size: 14px; font-weight: 500;">${caseRef}</td></tr>` : ""), "service_type_name": String(serviceTypeName), "date_str": String(dateStr), "time_str": String(timeStr), "end_time_str": String(endTimeStr), "duration_minutes": String(durationMinutes) }, to, subject: formatCaseEmailSubject(`CONFIRMED: Your ${serviceTypeName} — ${dateStr}`, caseRef), html, attachments });
}

export async function sendMediatorAppointmentConfirmedEmail(
  to: string,
  mediatorName: string,
  clientName: string,
  serviceTypeName: string,
  dateTime: Date,
  durationMinutes: number,
  caseRef: string,
  icsContent?: string,
  timeBasis: BookingTimeBasis = "wall_clock_utc",
): Promise<boolean> {
  const dateStr = formatAppointmentDate(dateTime, timeBasis);
  const timeStr = formatAppointmentTime(dateTime, timeBasis);
  const endTime = new Date(dateTime.getTime() + durationMinutes * 60000);
  const endTimeStr = formatAppointmentTime(endTime, timeBasis);

  const html = `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 560px; margin: 0 auto; padding: 0;">
      <div style="background: linear-gradient(135deg, #6b6b6b 0%, #4a4a4a 100%); padding: 32px 24px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="color: #ffffff; font-size: 22px; margin: 0; font-weight: 600;">Brighter Future Mediation</h1>
        <p style="color: rgba(255,255,255,0.7); font-size: 13px; margin: 6px 0 0;">Appointment Confirmed</p>
      </div>
      <div style="background: #ffffff; padding: 32px 24px; border: 1px solid #e5e7eb; border-top: none;">
        <h2 style="color: #5a7d58; font-size: 18px; margin: 0 0 16px;">Appointment Confirmed</h2>
        <p style="color: #555; font-size: 14px; line-height: 1.6; margin: 0 0 24px;">
          Hello ${mediatorName}, an appointment has been confirmed.
        </p>
        <div style="background: #f0fdf4; border-radius: 8px; padding: 20px; margin: 0 0 24px; border: 1px solid #bbf7d0;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr><td style="padding: 6px 0; color: #888; font-size: 13px; width: 110px;">Client</td><td style="padding: 6px 0; color: #333; font-size: 14px; font-weight: 500;">${clientName}</td></tr>
            <tr><td style="padding: 6px 0; color: #888; font-size: 13px;">Case</td><td style="padding: 6px 0; color: #333; font-size: 14px; font-weight: 500;">${caseRef}</td></tr>
            <tr><td style="padding: 6px 0; color: #888; font-size: 13px;">Service</td><td style="padding: 6px 0; color: #333; font-size: 14px; font-weight: 500;">${serviceTypeName}</td></tr>
            <tr><td style="padding: 6px 0; color: #888; font-size: 13px;">Date</td><td style="padding: 6px 0; color: #333; font-size: 14px; font-weight: 500;">${dateStr}</td></tr>
            <tr><td style="padding: 6px 0; color: #888; font-size: 13px;">Time</td><td style="padding: 6px 0; color: #333; font-size: 14px; font-weight: 500;">${timeStr} – ${endTimeStr}</td></tr>
            <tr><td style="padding: 6px 0; color: #888; font-size: 13px;">Timezone</td><td style="padding: 6px 0; color: #333; font-size: 14px; font-weight: 500;">UK time (Europe/London)</td></tr>
            <tr><td style="padding: 6px 0; color: #888; font-size: 13px;">Status</td><td style="padding: 6px 0; color: #5a7d58; font-size: 14px; font-weight: 600;">Confirmed ✓</td></tr>
          </table>
        </div>
      </div>
      <div style="padding: 16px 24px; text-align: center; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px; background: #fafafa;">
        <p style="color: #aaa; font-size: 11px; margin: 0;">
          Brighter Future Mediation Ltd &middot; FMC Accredited
        </p>
      </div>
    </div>
  `;

  const attachments: EmailAttachment[] = [];
  if (icsContent) {
    attachments.push({
      content: Buffer.from(icsContent).toString("base64"),
      filename: "appointment.ics",
      type: "text/calendar",
      disposition: "attachment",
    });
  }

  return sendEmail({ templateCode: "SYSTEM_MEDIATOR_APPOINTMENT_CONFIRMED", templateValues: { "mediator_name": String(mediatorName), "client_name": String(clientName), "case_ref": String(caseRef), "service_type_name": String(serviceTypeName), "date_str": String(dateStr), "time_str": String(timeStr), "end_time_str": String(endTimeStr) }, to, subject: formatCaseEmailSubject(`CONFIRMED: ${clientName} — ${serviceTypeName} on ${dateStr}`, caseRef), html, attachments });
}

export async function sendTaskFollowUpReminderEmail(
  to: string,
  staffName: string,
  taskTitle: string,
  caseRef?: string,
  taskUrl?: string
): Promise<boolean> {
  const html = `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 560px; margin: 0 auto; padding: 0;">
      <div style="background: linear-gradient(135deg, #6b6b6b 0%, #4a4a4a 100%); padding: 32px 24px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="color: #ffffff; font-size: 22px; margin: 0; font-weight: 600;">Brighter Future Mediation</h1>
        <p style="color: rgba(255,255,255,0.7); font-size: 13px; margin: 6px 0 0;">Task Follow-up Reminder</p>
      </div>
      <div style="background: #ffffff; padding: 32px 24px; border: 1px solid #e5e7eb; border-top: none;">
        <h2 style="color: #c53030; font-size: 18px; margin: 0 0 16px;">Follow-up Due</h2>
        <p style="color: #555; font-size: 14px; line-height: 1.6; margin: 0 0 16px;">
          Hello ${staffName},
        </p>
        <p style="color: #555; font-size: 14px; line-height: 1.6; margin: 0 0 24px;">
          A task you are responsible for has reached its follow-up date and requires your attention.
        </p>
        <div style="background: #fef2f2; border-radius: 8px; padding: 20px; margin: 0 0 24px; border: 1px solid #fecaca;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 6px 0; color: #888; font-size: 13px; width: 110px;">Task</td>
              <td style="padding: 6px 0; color: #333; font-size: 14px; font-weight: 500;">${taskTitle}</td>
            </tr>
            ${caseRef ? `<tr><td style="padding: 6px 0; color: #888; font-size: 13px;">Case</td><td style="padding: 6px 0; color: #333; font-size: 14px; font-weight: 500;">${caseRef}</td></tr>` : ""}
            <tr>
              <td style="padding: 6px 0; color: #888; font-size: 13px;">Urgency</td>
              <td style="padding: 6px 0; color: #c53030; font-size: 14px; font-weight: 600;">Overdue — Action required</td>
            </tr>
          </table>
        </div>
        ${taskUrl ? `
        <div style="text-align: center; margin: 0 0 24px;">
          <a href="${taskUrl}" style="display: inline-block; background-color: #5a7d58; color: #ffffff; text-decoration: none; padding: 12px 32px; border-radius: 6px; font-size: 14px; font-weight: 600;">
            View Task
          </a>
        </div>
        ` : ""}
        <p style="color: #888; font-size: 12px; line-height: 1.5; margin: 0;">
          This task has been escalated to active with red urgency. Please log in and take action.
        </p>
      </div>
      <div style="padding: 16px 24px; text-align: center; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px; background: #fafafa;">
        <p style="color: #aaa; font-size: 11px; margin: 0;">
          Brighter Future Mediation Ltd &middot; FMC Accredited
        </p>
      </div>
    </div>
  `;

  return sendEmail({ templateCode: "SYSTEM_TASK_FOLLOW_UP_REMINDER", templateValues: { "staff_name": String(staffName), "task_title": String(taskTitle), "value_3": String(caseRef ? `<tr><td style="padding: 6px 0; color: #888; font-size: 13px;">Case</td><td style="padding: 6px 0; color: #333; font-size: 14px; font-weight: 500;">${caseRef}</td></tr>` : ""), "value_4": String(taskUrl ? `
        <div style="text-align: center; margin: 0 0 24px;">
          <a href="${taskUrl}" style="display: inline-block; background-color: #5a7d58; color: #ffffff; text-decoration: none; padding: 12px 32px; border-radius: 6px; font-size: 14px; font-weight: 600;">
            View Task
          </a>
        </div>
        ` : "") }, to, subject: formatCaseEmailSubject(`Follow-up Due: ${taskTitle} — Brighter Future Mediation`, caseRef), html });
}

export async function sendDocumentsReadyForReviewEmail(
  to: string,
  adminName: string,
  documentTitle: string,
  caseRef: string,
  reviewUrl?: string,
): Promise<boolean> {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #5a7d58;">Documents ready for review</h2>
      <p>Hello ${adminName},</p>
      <p>A document is ready for review in the BFM proofing workflow.</p>
      <p><strong>Case:</strong> ${caseRef}</p>
      <p><strong>Document:</strong> ${documentTitle}</p>
      ${reviewUrl ? `<p><a href="${reviewUrl}" style="color: #5a7d58; font-weight: 700;">Open case documents</a></p>` : ""}
      <p style="color: #666; font-size: 13px;">Client release remains blocked until the item is approved.</p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
      <p style="color: #999; font-size: 12px;">Brighter Future Mediation</p>
    </div>
  `;

  return sendEmail({ templateCode: "SYSTEM_DOCUMENTS_READY_FOR_REVIEW", templateValues: { "admin_name": String(adminName), "case_ref": String(caseRef), "document_title": String(documentTitle), "value_4": String(reviewUrl ? `<p><a href="${reviewUrl}" style="color: #5a7d58; font-weight: 700;">Open case documents</a></p>` : "") }, to, subject: formatCaseEmailSubject("Documents ready for review", caseRef), html });
}

export async function sendDemographicFormEmail(to: string, name: string, formUrl: string, caseRef?: string): Promise<boolean> {
  const html = `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 560px; margin: 0 auto; padding: 0;">
      <div style="background: linear-gradient(135deg, #6b6b6b 0%, #4a4a4a 100%); padding: 32px 24px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="color: #ffffff; font-size: 22px; margin: 0; font-weight: 600;">Brighter Future Mediation</h1>
        <p style="color: rgba(255,255,255,0.7); font-size: 13px; margin: 6px 0 0;">Demographic Information</p>
      </div>
      <div style="background: #ffffff; padding: 32px 24px; border: 1px solid #e5e7eb; border-top: none;">
        <h2 style="color: #333; font-size: 18px; margin: 0 0 16px;">Please Complete Your Information</h2>
        <p style="color: #555; font-size: 14px; line-height: 1.6; margin: 0 0 16px;">
          Hello ${name},
        </p>
        <p style="color: #555; font-size: 14px; line-height: 1.6; margin: 0 0 8px;">
          As part of your mediation process${caseRef ? ` for case ${caseRef}` : ""}, we need to collect some demographic and personal information.
        </p>
        <p style="color: #555; font-size: 14px; line-height: 1.6; margin: 0 0 24px;">
          This information is required for FMC and MOJ reporting purposes and will be kept strictly confidential. Please complete the form by clicking the button below.
        </p>
        <div style="text-align: center; margin: 0 0 24px;">
          <a href="${formUrl}" style="display: inline-block; background-color: #5a7d58; color: #ffffff; text-decoration: none; padding: 12px 32px; border-radius: 6px; font-size: 14px; font-weight: 600;">
            Complete Demographic Form
          </a>
        </div>
        <p style="color: #888; font-size: 12px; line-height: 1.5; margin: 0 0 8px;">
          This link will expire in 7 days. If it expires, please contact your mediator for a new link.
        </p>
        <p style="color: #888; font-size: 12px; line-height: 1.5; margin: 0;">
          If the button doesn't work, copy and paste this link into your browser:<br/>
          <a href="${formUrl}" style="color: #5a7d58; word-break: break-all;">${formUrl}</a>
        </p>
      </div>
      <div style="padding: 16px 24px; text-align: center; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px; background: #fafafa;">
        <p style="color: #aaa; font-size: 11px; margin: 0;">
          Brighter Future Mediation Ltd &middot; FMC Accredited
        </p>
      </div>
    </div>
  `;

  return sendEmail({ templateCode: "SYSTEM_DEMOGRAPHIC_FORM", templateValues: { "name": String(name), "value_2": String(caseRef ? ` for case ${caseRef}` : ""), "form_url": String(formUrl) }, to, subject: formatCaseEmailSubject("Complete Your Demographic Form — Brighter Future Mediation", caseRef), html });
}

export async function sendRepresentativeConsentRequestEmail(to: string, fullName: string, consentUrl: string, caseRef?: string): Promise<boolean> {
  const html = `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 560px; margin: 0 auto; padding: 0;">
      <div style="background: linear-gradient(135deg, #6b6b6b 0%, #4a4a4a 100%); padding: 32px 24px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="color: #ffffff; font-size: 22px; margin: 0; font-weight: 600;">Brighter Future Mediation</h1>
        <p style="color: rgba(255,255,255,0.7); font-size: 13px; margin: 6px 0 0;">Fully accredited online mediation specialists</p>
      </div>
      <div style="background: #ffffff; padding: 32px 24px; border: 1px solid #e5e7eb; border-top: none;">
        <h2 style="color: #333; font-size: 18px; margin: 0 0 16px;">Representative GDPR Consent</h2>
        <p style="color: #555; font-size: 14px; line-height: 1.6;">Dear ${fullName},</p>
        <p style="color: #555; font-size: 14px; line-height: 1.6;">
          You have been listed as a representative on a mediation case with Brighter Future Mediation.
          Before we can communicate with you about this matter, we require your consent to our privacy policy.
        </p>
        <p style="color: #555; font-size: 14px; line-height: 1.6;">
          Please click the button below to record your consent. You may withdraw or refuse at any time by contacting us.
        </p>
        <div style="text-align: center; margin: 24px 0;">
          <a href="${consentUrl}" style="display: inline-block; background-color: #5a7d58; color: #ffffff; text-decoration: none; padding: 14px 40px; border-radius: 6px; font-size: 15px; font-weight: 700;">
            Review &amp; respond
          </a>
        </div>
        <p style="color: #888; font-size: 12px; line-height: 1.5;">
          This link will expire in 30 days. Questions? Contact us at
          <a href="mailto:info@brighterfuturemediation.co.uk" style="color: #5a7d58;">info@brighterfuturemediation.co.uk</a>.
        </p>
      </div>
      <div style="padding: 16px 24px; text-align: center; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px; background: #fafafa;">
        <p style="color: #aaa; font-size: 11px; margin: 0;">Brighter Future Mediation Ltd &middot; FMC Accredited</p>
      </div>
    </div>
  `;
  return sendEmail({ templateCode: "SYSTEM_REPRESENTATIVE_CONSENT_REQUEST", templateValues: { "full_name": String(fullName), "consent_url": String(consentUrl) }, to, subject: formatCaseEmailSubject("Representative GDPR consent — Brighter Future Mediation", caseRef), html });
}

export async function sendConsentRequestEmail(to: string, firstName: string, consentUrl: string, caseRef?: string): Promise<boolean> {
  const html = `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 560px; margin: 0 auto; padding: 0;">
      <div style="background: linear-gradient(135deg, #6b6b6b 0%, #4a4a4a 100%); padding: 32px 24px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="color: #ffffff; font-size: 22px; margin: 0; font-weight: 600;">Brighter Future Mediation</h1>
        <p style="color: rgba(255,255,255,0.7); font-size: 13px; margin: 6px 0 0;">Fully accredited online mediation specialists</p>
      </div>
      <div style="background: #ffffff; padding: 32px 24px; border: 1px solid #e5e7eb; border-top: none;">
        <h2 style="color: #333; font-size: 18px; margin: 0 0 16px;">Privacy Policy Consent</h2>
        <p style="color: #555; font-size: 14px; line-height: 1.6; margin: 0 0 16px;">
          Dear ${firstName},
        </p>
        <p style="color: #555; font-size: 14px; line-height: 1.6; margin: 0 0 16px;">
          We are writing to let you know that your details have been registered with Brighter Future Mediation. Before we can proceed with your enquiry, we require your consent to our privacy policy.
        </p>
        <p style="color: #555; font-size: 14px; line-height: 1.6; margin: 0 0 8px;">
          Please read our privacy policy and click the button below to confirm your consent:
        </p>
        <p style="color: #888; font-size: 12px; line-height: 1.5; margin: 0 0 24px;">
          By clicking "I give my consent" you agree to Brighter Future Mediation's privacy policy.
        </p>
        <div style="text-align: center; margin: 0 0 16px;">
          <a href="${consentUrl}" style="display: inline-block; background-color: #5a7d58; color: #ffffff; text-decoration: none; padding: 14px 40px; border-radius: 6px; font-size: 15px; font-weight: 700; letter-spacing: 0.01em;">
            I give my consent
          </a>
        </div>
        <div style="text-align: center; margin: 0 0 24px;">
          <a href="https://www.brighterfuturemediation.co.uk/terms-of-use/" style="display: inline-block; background-color: #f3f4f6; color: #555555; text-decoration: none; padding: 10px 28px; border-radius: 6px; font-size: 13px; font-weight: 500; border: 1px solid #e5e7eb;">
            View Privacy Policy
          </a>
        </div>
        <p style="color: #888; font-size: 12px; line-height: 1.5; margin: 0 0 8px;">
          This consent link will expire in 30 days. If you have any questions, please contact us at <a href="mailto:info@brighterfuturemediation.co.uk" style="color: #5a7d58;">info@brighterfuturemediation.co.uk</a>.
        </p>
      </div>
      <div style="padding: 16px 24px; text-align: center; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px; background: #fafafa;">
        <p style="color: #aaa; font-size: 11px; margin: 0;">
          Brighter Future Mediation Ltd &middot; FMC Accredited &middot; Supporting you from conflict to resolution
        </p>
      </div>
    </div>
  `;

  return sendEmail({ templateCode: "SYSTEM_CONSENT_REQUEST", templateValues: { "first_name": String(firstName), "consent_url": String(consentUrl) }, to, subject: formatCaseEmailSubject("Your privacy consent — Brighter Future Mediation", caseRef), html });
}

export async function sendCaseFollowUpConsentRequestEmail(to: string, firstName: string, consentUrl: string, caseRef?: string): Promise<boolean> {
  const html = `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 560px; margin: 0 auto; padding: 0;">
      <div style="background: linear-gradient(135deg, #6b6b6b 0%, #4a4a4a 100%); padding: 32px 24px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="color: #ffffff; font-size: 22px; margin: 0; font-weight: 600;">Brighter Future Mediation</h1>
        <p style="color: rgba(255,255,255,0.7); font-size: 13px; margin: 6px 0 0;">Fully accredited online mediation specialists</p>
      </div>
      <div style="background: #ffffff; padding: 32px 24px; border: 1px solid #e5e7eb; border-top: none;">
        <h2 style="color: #333; font-size: 18px; margin: 0 0 16px;">Follow-up contact consent</h2>
        <p style="color: #555; font-size: 14px; line-height: 1.6; margin: 0 0 16px;">
          Dear ${firstName},
        </p>
        <p style="color: #555; font-size: 14px; line-height: 1.6; margin: 0 0 16px;">
          As your mediation case is being closed, we would like to ask whether you consent to Brighter Future Mediation contacting you for short post-closure follow-up checks.
        </p>
        <p style="color: #555; font-size: 14px; line-height: 1.6; margin: 0 0 24px;">
          Please click the button below if you consent to follow-up contact. If you do not consent, you do not need to take any action.
        </p>
        <div style="text-align: center; margin: 0 0 24px;">
          <a href="${consentUrl}" style="display: inline-block; background-color: #5a7d58; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 6px; font-size: 15px; font-weight: 700;">
            I consent to follow-up contact
          </a>
        </div>
        <p style="color: #888; font-size: 12px; line-height: 1.5; margin: 0;">
          This consent link will expire in 30 days. If you have any questions, please contact us at <a href="mailto:info@brighterfuturemediation.co.uk" style="color: #5a7d58;">info@brighterfuturemediation.co.uk</a>.
        </p>
      </div>
      <div style="padding: 16px 24px; text-align: center; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px; background: #fafafa;">
        <p style="color: #aaa; font-size: 11px; margin: 0;">
          Brighter Future Mediation Ltd &middot; FMC Accredited &middot; Supporting you from conflict to resolution
        </p>
      </div>
    </div>
  `;

  return sendEmail({ templateCode: "SYSTEM_CASE_FOLLOW_UP_CONSENT_REQUEST", templateValues: { "first_name": String(firstName), "consent_url": String(consentUrl) }, to, subject: formatCaseEmailSubject("Follow-up contact consent — Brighter Future Mediation", caseRef), html });
}

export async function sendCaseClosureThankYouEmail(
  to: string,
  firstName: string,
  caseRef: string,
  closureReason: string,
): Promise<boolean> {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #5a7d58;">Your mediation case has been closed</h2>
      <p>Hello ${firstName},</p>
      <p>We are writing to confirm that your mediation case ${caseRef} has now been closed.</p>
      <p><strong>Closure reason:</strong> ${closureReason}</p>
      <p>Thank you for working with Brighter Future Mediation. We wish you well with your next steps.</p>
      <p>If you have any questions, please contact us at info@brighterfuturemediation.co.uk.</p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
      <p style="color: #999; font-size: 12px;">Brighter Future Mediation</p>
    </div>
  `;

  return sendEmail({ templateCode: "SYSTEM_CASE_CLOSURE_THANK_YOU", templateValues: { "first_name": String(firstName), "case_ref": String(caseRef), "closure_reason": String(closureReason) }, to, subject: formatCaseEmailSubject("Case closed — thank you from Brighter Future Mediation", caseRef), html });
}

export async function sendSafeguardingRebeccaNotificationEmail(input: {
  to: string;
  caseRef: string;
  actorName: string;
  notifiedAt: Date;
}): Promise<boolean> {
  const { to, caseRef, actorName, notifiedAt } = input;
  const subject = formatCaseEmailSubject("Safeguarding pathway action", caseRef);
  const notifiedAtText = notifiedAt.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const html = `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 560px; margin: 0 auto; padding: 0;">
      <div style="background: linear-gradient(135deg, #6b6b6b 0%, #4a4a4a 100%); padding: 28px 24px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="color: #ffffff; font-size: 22px; margin: 0; font-weight: 600;">Brighter Future Mediation</h1>
        <p style="color: rgba(255,255,255,0.75); font-size: 13px; margin: 6px 0 0;">Safeguarding pathway action</p>
      </div>
      <div style="background: #ffffff; padding: 28px 24px; border: 1px solid #e5e7eb; border-top: none;">
        <h2 style="color: #333; font-size: 18px; margin: 0 0 16px;">Notify Rebecca action recorded</h2>
        <p style="color: #555; font-size: 14px; line-height: 1.6; margin: 0 0 16px;">
          ${actorName} clicked <strong>Notify Rebecca</strong> for case <strong>${caseRef}</strong>.
        </p>
        <table style="width: 100%; border-collapse: collapse; margin: 0 0 18px;">
          <tr>
            <td style="padding: 8px 12px; background: #f9fafb; border: 1px solid #e5e7eb; font-size: 13px; color: #555; font-weight: 600;">Case</td>
            <td style="padding: 8px 12px; background: #fff; border: 1px solid #e5e7eb; font-size: 13px; color: #333;">${caseRef}</td>
          </tr>
          <tr>
            <td style="padding: 8px 12px; background: #f9fafb; border: 1px solid #e5e7eb; font-size: 13px; color: #555; font-weight: 600;">Recorded by</td>
            <td style="padding: 8px 12px; background: #fff; border: 1px solid #e5e7eb; font-size: 13px; color: #333;">${actorName}</td>
          </tr>
          <tr>
            <td style="padding: 8px 12px; background: #f9fafb; border: 1px solid #e5e7eb; font-size: 13px; color: #555; font-weight: 600;">Time</td>
            <td style="padding: 8px 12px; background: #fff; border: 1px solid #e5e7eb; font-size: 13px; color: #333;">${notifiedAtText}</td>
          </tr>
        </table>
        <p style="color: #555; font-size: 13px; line-height: 1.6; margin: 0;">
          Please log in to the CRM and review the safeguarding pathway for this case.
        </p>
      </div>
      <div style="padding: 14px 24px; text-align: center; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px; background: #fafafa;">
        <p style="color: #aaa; font-size: 11px; margin: 0;">Automated notification — Brighter Future Mediation CRM</p>
      </div>
    </div>
  `;

  return sendEmail({ templateCode: "SYSTEM_SAFEGUARDING_REBECCA_NOTIFICATION", templateValues: { "actor_name": String(actorName), "case_ref": String(caseRef), "notified_at_text": String(notifiedAtText) }, to, subject, html });
}

export type EnquiryAcknowledgementAvailabilityRow = {
  displayDate: string;
  times: string[];
  url: string;
};

export async function sendEnquiryAcknowledgementEmail(input: {
  to: string;
  firstName: string;
  caseRef: string;
  bookingUrl: string;
  availabilityPreview?: EnquiryAcknowledgementAvailabilityRow[];
}): Promise<boolean> {
  const { to, firstName, caseRef, bookingUrl } = input;
  const availabilityPreview = input.availabilityPreview || [];
  const availabilityHtml = availabilityPreview.length
    ? `
        <div style="margin: 0 0 24px;">
          ${availabilityPreview.map((row) => `
            <p style="color: #555; font-size: 14px; line-height: 1.6; margin: 0 0 8px;">
              <a href="${row.url}" style="color: #5a7d58; font-weight: 700;">${row.displayDate}</a>: ${row.times.join(", ")}
            </p>
          `).join("")}
        </div>
      `
    : "";
  const subject = formatCaseEmailSubject("Your mediation enquiry, Brighter Future Mediation", caseRef);
  const html = `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 560px; margin: 0 auto; padding: 0;">
      <div style="background: linear-gradient(135deg, #6b6b6b 0%, #4a4a4a 100%); padding: 32px 24px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="color: #ffffff; font-size: 22px; margin: 0; font-weight: 600;">Brighter Future Mediation</h1>
        <p style="color: rgba(255,255,255,0.7); font-size: 13px; margin: 6px 0 0;">Fully accredited online mediation specialists</p>
      </div>
      <div style="background: #ffffff; padding: 32px 24px; border: 1px solid #e5e7eb; border-top: none;">
        <p style="color: #555; font-size: 14px; line-height: 1.6; margin: 0 0 16px;">
          Hello ${firstName},
        </p>
        <p style="color: #555; font-size: 14px; line-height: 1.6; margin: 0 0 16px;">
          Many thanks for reaching out. We appreciate you contacting Brighter Future Mediation and will support you with clear information about the next steps.
        </p>
        <p style="color: #555; font-size: 14px; line-height: 1.6; margin: 0 0 24px;">
          The first step, in all instances, is to attend a Mediation Information and Assessment Meeting (MIAM). This is a confidential one-to-one online session lasting up to one hour with an FMC-registered mediator. It is your chance to:
        </p>
        <ul style="color: #555; font-size: 14px; line-height: 1.6; margin: 0 0 24px; padding-left: 22px;">
          <li>discuss your situation and concerns in a safe, neutral space</li>
          <li>understand all the options available to you</li>
          <li>learn how mediation could help you reach arrangements that work for your family</li>
          <li>ask questions and make an informed decision about next steps</li>
        </ul>
        <p style="color: #555; font-size: 14px; line-height: 1.6; margin: 0 0 16px;">
          In most instances a MIAM is a legal requirement before applying to the family court, and it is mandatory to attempt negotiation before court proceedings. There are limited exemptions. You can find out more about MIAMs and mediation <a href="https://drive.google.com/drive/folders/1tXnvuT4WNlbdtlC2IpwV-mclqx0Arnd4" style="color: #5a7d58; font-weight: 700;">here</a>.
        </p>
        <p style="color: #555; font-size: 14px; line-height: 1.6; margin: 0 0 16px;">
          We do not provide legally aided mediation. If you receive certain benefits or are on a low income you may qualify for free mediation with a legal aid provider; you can check eligibility at gov.uk.
        </p>
        <p style="color: #555; font-size: 14px; line-height: 1.6; margin: 0 0 16px;">
          There is no obligation to proceed after your MIAM if mediation does not feel suitable. If you choose to try mediation, we would then contact your ex-partner to invite them to attend their own MIAM. If you both continue, and you are discussing child arrangements, the government provides a £500 voucher towards the cost of sessions, split equally between both clients.
        </p>
        <p style="color: #555; font-size: 14px; line-height: 1.6; margin: 0 0 24px;">
          If either of you does not wish to mediate, or mediation is assessed as unsuitable after the MIAM, we can provide the mediator-signed court form enabling a court application.
        </p>
        <h2 style="color: #333; font-size: 18px; margin: 0 0 12px;">Payment terms</h2>
        <ul style="color: #555; font-size: 14px; line-height: 1.6; margin: 0 0 24px; padding-left: 22px;">
          <li>Fees are payable in advance. Your appointment is confirmed only once payment has been received.</li>
          <li>Payment must reach us at least <strong>72 hours</strong> before the appointment, or the held slot is released.</li>
          <li>Cancellations need at least <strong>48 hours</strong> notice in writing. With less notice the full fee remains payable, as per our <a href="https://brighterfuturemediation.co.uk/terms-of-use/" style="color: #5a7d58;">terms of use</a>. Government vouchers do not cover missed or late-cancelled sessions.</li>
          <li>No refund is issued where a session cannot go ahead because of problems with your equipment or internet connection, or for non-attendance.</li>
          <li>Our current fees are always on our <a href="https://www.brighterfuturemediation.co.uk/fees" style="color: #5a7d58;">fees page</a>.</li>
        </ul>
        <h2 style="color: #333; font-size: 18px; margin: 0 0 12px;">Next steps</h2>
        <p style="color: #555; font-size: 14px; line-height: 1.6; margin: 0 0 20px;">
          Click on the MIAM booking button to choose from the available date and time slots. Your invoice/payment link will be provided after you choose your MIAM slot.
        </p>
        <div style="text-align: center; margin: 0 0 24px;">
          <a href="${bookingUrl}" style="display: inline-block; background-color: #5a7d58; color: #ffffff; text-decoration: none; padding: 14px 34px; border-radius: 6px; font-size: 15px; font-weight: 700;">
            Book MIAM Appointment
          </a>
        </div>
        ${availabilityHtml}
        <p style="color: #555; font-size: 14px; line-height: 1.6; margin: 0 0 16px;">
          Simply use the booking link above, reply with your availability, or call us on 0333 240 8038 if you would like more information.
        </p>
        <p style="color: #555; font-size: 14px; line-height: 1.6; margin: 16px 0 0;">
          Kind regards,<br/>
          <strong>The Brighter Future Mediation Team</strong>
        </p>
      </div>
      <div style="padding: 16px 24px; text-align: center; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px; background: #fafafa;">
        <p style="color: #aaa; font-size: 11px; margin: 0;">
          Brighter Future Mediation Ltd &middot; FMC Accredited &middot; Supporting you from conflict to resolution
        </p>
      </div>
    </div>
  `;

  return sendEmail({ templateCode: "SYSTEM_ENQUIRY_ACKNOWLEDGEMENT", templateValues: { "first_name": String(firstName), "booking_url": String(bookingUrl), "availability_html": String(availabilityHtml) }, to, subject, html });
}

export async function sendMediatorCalendarReauthEmail(to: string, name: string, settingsUrl: string): Promise<boolean> {
  const subject = "Action required: reconnect your Google Calendar — Brighter Future Mediation";
  const html = `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
      <h2 style="color: #b8825a; margin: 0 0 12px;">Reconnect your Google Calendar</h2>
      <p style="color: #333; font-size: 14px; line-height: 1.6;">Hi ${name},</p>
      <p style="color: #333; font-size: 14px; line-height: 1.6;">
        Google has revoked the access we use to read your calendar and write client bookings to it. Until you reconnect, your availability won't show on the booking pages and new appointments can't be added to your Google Calendar.
      </p>
      <p style="color: #333; font-size: 14px; line-height: 1.6;">
        This usually happens because Google's testing-app refresh tokens expire after about 7 days, your Google account password was changed, or access was revoked from your Google account settings.
      </p>
      <p style="margin: 24px 0;">
        <a href="${settingsUrl}"
           style="display: inline-block; background-color: #5a7d58; color: #fff; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-size: 14px; font-weight: 600;">
          Reconnect Google Calendar
        </a>
      </p>
      <p style="color: #888; font-size: 12px; line-height: 1.5;">
        If you weren't expecting this email, please contact <a href="mailto:info@brighterfuturemediation.co.uk" style="color:#5a7d58;">info@brighterfuturemediation.co.uk</a>.
      </p>
    </div>
  `;
  return sendEmail({ templateCode: "SYSTEM_MEDIATOR_CALENDAR_REAUTH", templateValues: { "name": String(name), "settings_url": String(settingsUrl) }, to, subject, html });
}

export async function sendNewMediatorApplicationAdminEmail(
  applicantName: string,
  applicantEmail: string,
): Promise<boolean> {
  const subject = "New mediator application received — Brighter Future Mediation";
  const submittedAt = new Date().toLocaleString("en-GB", {
    timeZone: "Europe/London",
    dateStyle: "full",
    timeStyle: "short",
  });
  const html = `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 560px; margin: 0 auto; padding: 0;">
      <div style="background: linear-gradient(135deg, #5a7d58 0%, #3d5c3c 100%); padding: 24px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="color: #ffffff; font-size: 20px; margin: 0; font-weight: 600;">New Mediator Application</h1>
        <p style="color: rgba(255,255,255,0.75); font-size: 12px; margin: 4px 0 0;">Brighter Future Mediation — Internal Notification</p>
      </div>
      <div style="background: #ffffff; padding: 28px 24px; border: 1px solid #e5e7eb; border-top: none;">
        <p style="color: #333; font-size: 14px; line-height: 1.6; margin: 0 0 16px;">
          A new mediator application has been submitted via the public application form.
        </p>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
          <tr>
            <td style="padding: 8px 12px; background: #f9fafb; border: 1px solid #e5e7eb; font-size: 13px; color: #555; width: 40%; font-weight: 600;">Name</td>
            <td style="padding: 8px 12px; background: #fff; border: 1px solid #e5e7eb; font-size: 13px; color: #333;">${applicantName}</td>
          </tr>
          <tr>
            <td style="padding: 8px 12px; background: #f9fafb; border: 1px solid #e5e7eb; font-size: 13px; color: #555; font-weight: 600;">Email</td>
            <td style="padding: 8px 12px; background: #fff; border: 1px solid #e5e7eb; font-size: 13px; color: #333;">${applicantEmail}</td>
          </tr>
          <tr>
            <td style="padding: 8px 12px; background: #f9fafb; border: 1px solid #e5e7eb; font-size: 13px; color: #555; font-weight: 600;">Submitted</td>
            <td style="padding: 8px 12px; background: #fff; border: 1px solid #e5e7eb; font-size: 13px; color: #333;">${submittedAt}</td>
          </tr>
        </table>
        <p style="color: #555; font-size: 13px; line-height: 1.6; margin: 0;">
          Please log in to the CRM to review this application under <strong>Mediator Applicants</strong>.
        </p>
      </div>
      <div style="padding: 14px 24px; text-align: center; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px; background: #fafafa;">
        <p style="color: #aaa; font-size: 11px; margin: 0;">Automated notification — Brighter Future Mediation CRM</p>
      </div>
    </div>
  `;
  return sendEmail({ templateCode: "SYSTEM_NEW_MEDIATOR_APPLICATION_ADMIN", templateValues: { "applicant_name": String(applicantName), "applicant_email": String(applicantEmail), "submitted_at": String(submittedAt) }, to: ADMIN_NOTIFICATION_EMAIL, subject, html });
}

export async function sendMediatorApplicationConfirmationEmail(
  to: string,
  name: string,
): Promise<boolean> {
  const subject = "Application received — Brighter Future Mediation";
  const html = `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 560px; margin: 0 auto; padding: 0;">
      <div style="background: linear-gradient(135deg, #6b6b6b 0%, #4a4a4a 100%); padding: 32px 24px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="color: #ffffff; font-size: 22px; margin: 0; font-weight: 600;">Brighter Future Mediation</h1>
        <p style="color: rgba(255,255,255,0.7); font-size: 13px; margin: 6px 0 0;">Mediator Applications</p>
      </div>
      <div style="background: #ffffff; padding: 32px 24px; border: 1px solid #e5e7eb; border-top: none;">
        <h2 style="color: #333; font-size: 18px; margin: 0 0 16px;">Thank you for your application</h2>
        <p style="color: #555; font-size: 14px; line-height: 1.6; margin: 0 0 16px;">
          Hi ${name},
        </p>
        <p style="color: #555; font-size: 14px; line-height: 1.6; margin: 0 0 16px;">
          We've received your application to join the Brighter Future Mediation panel. Our team will review your details and be in touch shortly to discuss next steps.
        </p>
        <p style="color: #555; font-size: 14px; line-height: 1.6; margin: 0 0 24px;">
          In the meantime, if you have any questions please don't hesitate to contact us at
          <a href="mailto:info@brighterfuturemediation.co.uk" style="color: #5a7d58;">info@brighterfuturemediation.co.uk</a>.
        </p>
        <p style="color: #555; font-size: 14px; line-height: 1.6; margin: 0;">
          Kind regards,<br/>
          <strong>The Brighter Future Mediation Team</strong>
        </p>
      </div>
      <div style="padding: 16px 24px; text-align: center; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px; background: #fafafa;">
        <p style="color: #aaa; font-size: 11px; margin: 0;">
          Brighter Future Mediation Ltd &middot; FMC Accredited &middot; Supporting you from conflict to resolution
        </p>
      </div>
    </div>
  `;
  return sendEmail({ templateCode: "SYSTEM_MEDIATOR_APPLICATION_CONFIRMATION", templateValues: { "name": String(name) }, to, subject, html });
}

export async function sendApplicantFormResendEmail(
  to: string,
  name: string,
  updateUrl: string,
  serviceName?: string,
): Promise<boolean> {
  const subject = serviceName
    ? `Please upload your ${serviceName} proof`
    : "Your application — please review and update your details";
  const intro = serviceName
    ? `We've asked you to provide supporting proof for <strong>${serviceName}</strong>. Your current details are pre-filled in the form — please upload the required certificate file or link, then resubmit.`
    : "We'd like to give you the opportunity to review and update the information you submitted as part of your application to join the Brighter Future Mediation panel. Your current details are pre-filled in the form — simply make any corrections or additions and resubmit.";
  const html = `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 560px; margin: 0 auto; padding: 0;">
      <div style="background: linear-gradient(135deg, #6b6b6b 0%, #4a4a4a 100%); padding: 32px 24px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="color: #ffffff; font-size: 22px; margin: 0; font-weight: 600;">Brighter Future Mediation</h1>
        <p style="color: rgba(255,255,255,0.7); font-size: 13px; margin: 6px 0 0;">Mediator Applications</p>
      </div>
      <div style="background: #ffffff; padding: 32px 24px; border: 1px solid #e5e7eb; border-top: none;">
        <h2 style="color: #333; font-size: 18px; margin: 0 0 16px;">
          ${serviceName ? `Please upload your ${serviceName} proof` : "Please review your application"}
        </h2>
        <p style="color: #555; font-size: 14px; line-height: 1.6; margin: 0 0 16px;">
          Hi ${name},
        </p>
        <p style="color: #555; font-size: 14px; line-height: 1.6; margin: 0 0 16px;">
          ${intro}
        </p>
        <p style="color: #555; font-size: 14px; line-height: 1.6; margin: 0 0 24px;">
          This link is personal to you and can only be used once. It will expire in 7 days.
        </p>
        <div style="text-align: center; margin: 28px 0;">
          <a href="${updateUrl}"
             style="display: inline-block; background-color: #5a7d58; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 6px; font-size: 15px; font-weight: 600;">
            ${serviceName ? "Upload proof &rarr;" : "Review &amp; update my application &rarr;"}
          </a>
        </div>
        <p style="color: #888; font-size: 12px; line-height: 1.6; margin: 0 0 16px;">
          If the button above doesn't work, copy and paste this link into your browser:<br/>
          <a href="${updateUrl}" style="color: #5a7d58; word-break: break-all;">${updateUrl}</a>
        </p>
        <p style="color: #555; font-size: 14px; line-height: 1.6; margin: 0;">
          If you have any questions please contact us at
          <a href="mailto:info@brighterfuturemediation.co.uk" style="color: #5a7d58;">info@brighterfuturemediation.co.uk</a>.
        </p>
        <p style="color: #555; font-size: 14px; line-height: 1.6; margin: 16px 0 0;">
          Kind regards,<br/>
          <strong>The Brighter Future Mediation Team</strong>
        </p>
      </div>
      <div style="padding: 16px 24px; text-align: center; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px; background: #fafafa;">
        <p style="color: #aaa; font-size: 11px; margin: 0;">
          Brighter Future Mediation Ltd &middot; FMC Accredited &middot; Supporting you from conflict to resolution
        </p>
      </div>
    </div>
  `;
  return sendEmail({ templateCode: "SYSTEM_APPLICANT_FORM_RESEND", templateValues: { "value_1": String(serviceName ? `Please upload your ${serviceName} proof` : "Please review your application"), "name": String(name), "intro": String(intro), "update_url": String(updateUrl), "value_5": String(serviceName ? "Upload proof &rarr;" : "Review &amp; update my application &rarr;") }, to, subject, html });
}

// ── Task #249 — Applicant accept / reject emails ─────────────────────────────
// The caller supplies the full subject and plain-text body (pre-composed and
// edited by the staff member in the frontend dialog). We wrap them in the
// standard branded HTML shell — newlines become <br> tags.

function plainToHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br/>");
}

export async function sendApplicantInterviewInviteEmail(
  to: string,
  customSubject: string,
  customBody: string,
): Promise<boolean> {
  const html = `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 560px; margin: 0 auto; padding: 0;">
      <div style="background: linear-gradient(135deg, #6b6b6b 0%, #4a4a4a 100%); padding: 32px 24px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="color: #ffffff; font-size: 22px; margin: 0; font-weight: 600;">Brighter Future Mediation</h1>
        <p style="color: rgba(255,255,255,0.7); font-size: 13px; margin: 6px 0 0;">Mediator Recruitment</p>
      </div>
      <div style="background: #ffffff; padding: 32px 24px; border: 1px solid #e5e7eb; border-top: none;">
        <p style="color: #333; font-size: 14px; line-height: 1.8; margin: 0;">${plainToHtml(customBody)}</p>
      </div>
      <div style="padding: 16px 24px; text-align: center; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px; background: #fafafa;">
        <p style="color: #aaa; font-size: 11px; margin: 0;">
          Brighter Future Mediation Ltd &middot; FMC Accredited &middot; Supporting you from conflict to resolution
        </p>
      </div>
    </div>
  `;
  return sendEmail({ templateCode: "SYSTEM_APPLICANT_INTERVIEW_INVITE", templateValues: { "value_1": String(plainToHtml(customBody)) }, to, subject: customSubject, html });
}

export async function sendApplicantRejectionEmail(
  to: string,
  customSubject: string,
  customBody: string,
): Promise<boolean> {
  const html = `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 560px; margin: 0 auto; padding: 0;">
      <div style="background: linear-gradient(135deg, #6b6b6b 0%, #4a4a4a 100%); padding: 32px 24px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="color: #ffffff; font-size: 22px; margin: 0; font-weight: 600;">Brighter Future Mediation</h1>
        <p style="color: rgba(255,255,255,0.7); font-size: 13px; margin: 6px 0 0;">Mediator Recruitment</p>
      </div>
      <div style="background: #ffffff; padding: 32px 24px; border: 1px solid #e5e7eb; border-top: none;">
        <p style="color: #333; font-size: 14px; line-height: 1.8; margin: 0;">${plainToHtml(customBody)}</p>
      </div>
      <div style="padding: 16px 24px; text-align: center; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px; background: #fafafa;">
        <p style="color: #aaa; font-size: 11px; margin: 0;">
          Brighter Future Mediation Ltd &middot; FMC Accredited &middot; Supporting you from conflict to resolution
        </p>
      </div>
    </div>
  `;
  return sendEmail({ templateCode: "SYSTEM_APPLICANT_REJECTION", templateValues: { "value_1": String(plainToHtml(customBody)) }, to, subject: customSubject, html });
}

// ── Contractor applicant acceptance email ─────────────────────────────────────

export async function sendContractorApplicantAcceptEmail(
  to: string,
  customSubject: string,
  customBody: string,
): Promise<boolean> {
  const html = `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 560px; margin: 0 auto; padding: 0;">
      <div style="background: linear-gradient(135deg, #6b6b6b 0%, #4a4a4a 100%); padding: 32px 24px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="color: #ffffff; font-size: 22px; margin: 0; font-weight: 600;">Brighter Future Mediation</h1>
        <p style="color: rgba(255,255,255,0.7); font-size: 13px; margin: 6px 0 0;">Contractor Applications</p>
      </div>
      <div style="background: #ffffff; padding: 32px 24px; border: 1px solid #e5e7eb; border-top: none;">
        <p style="color: #333; font-size: 14px; line-height: 1.8; margin: 0;">${plainToHtml(customBody)}</p>
      </div>
      <div style="padding: 16px 24px; text-align: center; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px; background: #fafafa;">
        <p style="color: #aaa; font-size: 11px; margin: 0;">
          Brighter Future Mediation Ltd &middot; FMC Accredited &middot; Supporting you from conflict to resolution
        </p>
      </div>
    </div>
  `;
  return sendEmail({ templateCode: "SYSTEM_CONTRACTOR_APPLICANT_ACCEPT", templateValues: { "value_1": String(plainToHtml(customBody)) }, to, subject: customSubject, html });
}

// ── Task #255 — Contractor application emails ─────────────────────────────────

export async function sendContractorApplicationConfirmationEmail(
  to: string,
  name: string,
  contractorType: string,
): Promise<boolean> {
  const subject = "Application received — Brighter Future Mediation";
  const html = `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 560px; margin: 0 auto; padding: 0;">
      <div style="background: linear-gradient(135deg, #6b6b6b 0%, #4a4a4a 100%); padding: 32px 24px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="color: #ffffff; font-size: 22px; margin: 0; font-weight: 600;">Brighter Future Mediation</h1>
        <p style="color: rgba(255,255,255,0.7); font-size: 13px; margin: 6px 0 0;">Contractor Application</p>
      </div>
      <div style="background: #ffffff; padding: 32px 24px; border: 1px solid #e5e7eb; border-top: none;">
        <h2 style="color: #333; font-size: 18px; margin: 0 0 16px;">Application received</h2>
        <p style="color: #555; font-size: 14px; line-height: 1.6; margin: 0 0 16px;">Dear ${name},</p>
        <p style="color: #555; font-size: 14px; line-height: 1.6; margin: 0 0 16px;">
          Thank you for your interest in working with Brighter Future Mediation as a <strong>${contractorType}</strong> contractor.
        </p>
        <p style="color: #555; font-size: 14px; line-height: 1.6; margin: 0 0 24px;">
          We have received your application and will review your details shortly. A member of our team will be in touch to discuss the next steps.
        </p>
        <p style="color: #555; font-size: 14px; line-height: 1.6; margin: 0 0 16px;">
          If you have any questions in the meantime, please contact us at:<br/>
          <a href="mailto:info@brighterfuturemediation.co.uk" style="color: #5a7d58;">info@brighterfuturemediation.co.uk</a>
        </p>
        <p style="color: #555; font-size: 14px; line-height: 1.6; margin: 16px 0 0;">
          Kind regards,<br/>
          <strong>The Brighter Future Mediation Team</strong>
        </p>
      </div>
      <div style="padding: 16px 24px; text-align: center; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px; background: #fafafa;">
        <p style="color: #aaa; font-size: 11px; margin: 0;">
          Brighter Future Mediation Ltd &middot; FMC Accredited &middot; Supporting you from conflict to resolution
        </p>
      </div>
    </div>
  `;
  return sendEmail({ templateCode: "SYSTEM_CONTRACTOR_APPLICATION_CONFIRMATION", templateValues: { "name": String(name), "contractor_type": String(contractorType) }, to, subject, html });
}

export async function sendNewContractorApplicationAdminEmail(
  applicantName: string,
  applicantEmail: string,
  contractorType: string,
): Promise<boolean> {
  const subject = "New contractor application received — Brighter Future Mediation";
  const submittedAt = new Date().toLocaleString("en-GB", { timeZone: "Europe/London", dateStyle: "full", timeStyle: "short" });
  const html = `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 560px; margin: 0 auto; padding: 0;">
      <div style="background: linear-gradient(135deg, #b8825a 0%, #8a5e3a 100%); padding: 24px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="color: #ffffff; font-size: 20px; margin: 0; font-weight: 600;">New Contractor Application</h1>
        <p style="color: rgba(255,255,255,0.75); font-size: 12px; margin: 4px 0 0;">Brighter Future Mediation — Internal Notification</p>
      </div>
      <div style="background: #ffffff; padding: 28px 24px; border: 1px solid #e5e7eb; border-top: none;">
        <p style="color: #333; font-size: 14px; line-height: 1.6; margin: 0 0 16px;">
          A new contractor application has been submitted via the public application form.
        </p>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
          <tr>
            <td style="padding: 8px 12px; background: #f9fafb; border: 1px solid #e5e7eb; font-size: 13px; color: #555; width: 40%; font-weight: 600;">Name</td>
            <td style="padding: 8px 12px; background: #fff; border: 1px solid #e5e7eb; font-size: 13px; color: #333;">${applicantName}</td>
          </tr>
          <tr>
            <td style="padding: 8px 12px; background: #f9fafb; border: 1px solid #e5e7eb; font-size: 13px; color: #555; font-weight: 600;">Email</td>
            <td style="padding: 8px 12px; background: #fff; border: 1px solid #e5e7eb; font-size: 13px; color: #333;">${applicantEmail}</td>
          </tr>
          <tr>
            <td style="padding: 8px 12px; background: #f9fafb; border: 1px solid #e5e7eb; font-size: 13px; color: #555; font-weight: 600;">Type</td>
            <td style="padding: 8px 12px; background: #fff; border: 1px solid #e5e7eb; font-size: 13px; color: #333;">${contractorType}</td>
          </tr>
          <tr>
            <td style="padding: 8px 12px; background: #f9fafb; border: 1px solid #e5e7eb; font-size: 13px; color: #555; font-weight: 600;">Submitted</td>
            <td style="padding: 8px 12px; background: #fff; border: 1px solid #e5e7eb; font-size: 13px; color: #333;">${submittedAt}</td>
          </tr>
        </table>
        <p style="color: #555; font-size: 13px; line-height: 1.6; margin: 0;">
          Log in to the CRM and navigate to <strong>Contractor Pipeline</strong> to review this application.
        </p>
      </div>
      <div style="padding: 16px 24px; text-align: center; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px; background: #fafafa;">
        <p style="color: #aaa; font-size: 11px; margin: 0;">
          Brighter Future Mediation Ltd &middot; Internal system notification
        </p>
      </div>
    </div>
  `;
  return sendEmail({ templateCode: "SYSTEM_NEW_CONTRACTOR_APPLICATION_ADMIN", templateValues: { "applicant_name": String(applicantName), "applicant_email": String(applicantEmail), "contractor_type": String(contractorType), "submitted_at": String(submittedAt) }, to: ADMIN_NOTIFICATION_EMAIL, subject, html });
}

export async function sendBfmCalendarHealthAlert(errorCode: string, needsReauth: boolean): Promise<boolean> {
  const subject = needsReauth
    ? "ACTION REQUIRED — BFM info@ calendar disconnected — bookings blocked"
    : `BFM info@ calendar health check failed (${errorCode})`;
  const html = `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
      <h2 style="color: #b8825a; margin: 0 0 12px;">BFM Organisation Calendar — Health Check Failed</h2>
      <p style="color: #333; font-size: 14px; line-height: 1.6;">
        The daily health check for the <strong>info@brighterfuturemediation.co.uk</strong> Google Calendar failed with error: <code style="background:#f3f4f6;padding:2px 6px;border-radius:4px;">${errorCode}</code>
      </p>
      <p style="color: #333; font-size: 14px; line-height: 1.6;">
        ${needsReauth
          ? "Google rejected the saved access token. <strong>All new bookings are hard-blocked</strong> until a superadmin reconnects the calendar."
          : "All new bookings are <strong>hard-blocked</strong> until the calendar is reachable again."}
      </p>
      <p style="margin: 24px 0;">
        <a href="${process.env.APP_URL ?? "https://brighterfuturemediation.co.uk"}/settings"
           style="display: inline-block; background-color: #5a7d58; color: #fff; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-size: 14px; font-weight: 600;">
          Open Settings &rarr; BFM Calendar
        </a>
      </p>
      <p style="color: #888; font-size: 12px; line-height: 1.5;">
        This is an automated alert from the BFM CRM. The check runs once every 24 hours.
      </p>
    </div>
  `;
  return sendEmail({ templateCode: "SYSTEM_BFM_CALENDAR_HEALTH_ALERT", templateValues: { "error_code": String(errorCode), "value_2": String(needsReauth
          ? "Google rejected the saved access token. <strong>All new bookings are hard-blocked</strong> until a superadmin reconnects the calendar."
          : "All new bookings are <strong>hard-blocked</strong> until the calendar is reachable again."), "value_3": String(process.env.APP_URL ?? "https://brighterfuturemediation.co.uk") }, to: FROM_EMAIL, subject, html });
}

function escapeComplaintEmailValue(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!));
}

export async function sendComplaintReceiptEmail(
  to: string,
  complaintRef: string,
  caseRef: string,
  receivedAt: Date,
  secureUrl: string,
): Promise<boolean> {
  const ref = escapeComplaintEmailValue(complaintRef);
  const safeCaseRef = escapeComplaintEmailValue(caseRef);
  const url = escapeComplaintEmailValue(secureUrl);
  const date = receivedAt.toLocaleDateString("en-GB", { timeZone: "Europe/London", dateStyle: "long" });
  return sendEmail({ templateCode: "SYSTEM_COMPLAINT_RECEIPT", templateValues: { "ref": String(ref), "safe_case_ref": String(safeCaseRef), "date": String(date), "url": String(url) },
    to,
    subject: `Complaint received — ${ref}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto"><h2>We have received your complaint</h2><p>Complaint reference: <strong>${ref}</strong></p><p>Case reference: <strong>${safeCaseRef}</strong></p><p>Received: ${date}</p><p><a href="${url}">View your secure complaint status</a></p><p>For your privacy, complaint details are not included in this email.</p></div>`,
  });
}

export async function sendComplaintAdminAlertEmail(to: string, complaintRef: string, secureUrl: string): Promise<boolean> {
  const ref = escapeComplaintEmailValue(complaintRef);
  const url = escapeComplaintEmailValue(secureUrl);
  return sendEmail({ templateCode: "SYSTEM_COMPLAINT_ADMIN_ALERT", templateValues: { "ref": String(ref), "url": String(url) },
    to,
    subject: `Confidential complaint requires review — ${ref}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto"><h2>Confidential complaint received</h2><p>Reference: <strong>${ref}</strong></p><p><a href="${url}">Open the secure complaint workspace</a></p><p>No complaint content is included in this notification.</p></div>`,
  });
}

export async function sendComplaintStatusEmail(to: string, complaintRef: string, secureUrl: string): Promise<boolean> {
  const ref = escapeComplaintEmailValue(complaintRef);
  const url = escapeComplaintEmailValue(secureUrl);
  return sendEmail({ templateCode: "SYSTEM_COMPLAINT_STATUS", templateValues: { "ref": String(ref), "url": String(url) },
    to,
    subject: `Complaint status updated — ${ref}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto"><h2>Your complaint has an update</h2><p>Reference: <strong>${ref}</strong></p><p><a href="${url}">View the update securely</a></p><p>For your privacy, the update is not included in this email.</p></div>`,
  });
}
