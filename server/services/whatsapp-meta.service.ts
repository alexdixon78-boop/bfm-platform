import crypto from "crypto";
import { Readable } from "node:stream";
import { MAX_WHATSAPP_MEDIA_BYTES, readAndValidateWhatsappMedia, WhatsappMediaValidationError } from "./whatsapp-media-validation";

const META_GRAPH_VERSION = process.env.META_WHATSAPP_GRAPH_VERSION || "v20.0";
const SIGNATURE_HEADER = "X-Hub-Signature-256";
const META_REQUEST_TIMEOUT_MS = 15_000;

export type MetaSendResult =
  | { ok: true; messageId?: string; payload: unknown }
  | { ok: false; status: number; providerCode: number | null; error: string };

export type WhatsappReplyButton = {
  id: string;
  title: string;
};

export type WhatsappFlowParams = {
  flowId: string;
  flowToken: string;
  body: string;
  cta: string;
  screen?: string;
  header?: string;
  footer?: string;
  data?: Record<string, unknown>;
};

class WhatsappMetaService {
  isConfigured(): boolean {
    return Boolean(process.env.META_WHATSAPP_ACCESS_TOKEN && process.env.META_WHATSAPP_PHONE_NUMBER_ID);
  }

  getSettingsStatus() {
    return {
      verifyTokenConfigured: Boolean(process.env.META_WHATSAPP_VERIFY_TOKEN),
      appSecretConfigured: Boolean(process.env.META_WHATSAPP_APP_SECRET),
      accessTokenConfigured: Boolean(process.env.META_WHATSAPP_ACCESS_TOKEN),
      phoneNumberIdConfigured: Boolean(process.env.META_WHATSAPP_PHONE_NUMBER_ID),
      businessAccountIdConfigured: Boolean(process.env.META_WHATSAPP_BUSINESS_ACCOUNT_ID),
      defaultTemplate: process.env.META_WHATSAPP_DEFAULT_TEMPLATE || null,
    };
  }

  verifyChallenge(mode: unknown, token: unknown, challenge: unknown): string | null {
    if (mode !== "subscribe" || typeof token !== "string" || typeof challenge !== "string") return null;
    const expected = process.env.META_WHATSAPP_VERIFY_TOKEN;
    if (!expected || token !== expected) return null;
    return challenge;
  }

  verifySignature(rawBody: unknown, signatureHeader: string | undefined): boolean {
    const appSecret = process.env.META_WHATSAPP_APP_SECRET;
    if (!appSecret || !signatureHeader || !Buffer.isBuffer(rawBody)) return false;
    const prefix = "sha256=";
    if (!signatureHeader.startsWith(prefix)) return false;

    const provided = signatureHeader.slice(prefix.length);
    const expected = crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
    try {
      const providedBuffer = Buffer.from(provided, "hex");
      const expectedBuffer = Buffer.from(expected, "hex");
      return providedBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(providedBuffer, expectedBuffer);
    } catch {
      return false;
    }
  }

  async sendText(to: string, body: string): Promise<MetaSendResult> {
    return this.sendPayload({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { preview_url: false, body },
    });
  }

  async sendTemplate(to: string, templateName: string, languageCode = "en_GB"): Promise<MetaSendResult> {
    return this.sendPayload({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "template",
      template: {
        name: templateName,
        language: { code: languageCode },
      },
    });
  }

  async sendParameterizedTemplate(to: string, templateName: string, languageCode = "en_GB", parameters: Record<string, string> = {}, headerMediaId?: string | null, headerMediaType: "image" | "document" = "document"): Promise<MetaSendResult> {
    const bodyParameters = Object.entries(parameters).sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true })).map(([parameter_name, text]) => ({ type: "text", parameter_name, text }));
    const components: Array<Record<string, unknown>> = [];
    if (headerMediaId) components.push({ type: "header", parameters: [{ type: headerMediaType, [headerMediaType]: { id: headerMediaId } }] });
    if (bodyParameters.length) components.push({ type: "body", parameters: bodyParameters });
    return this.sendPayload({ messaging_product: "whatsapp", recipient_type: "individual", to, type: "template", template: { name: templateName, language: { code: languageCode }, components } });
  }

  async sendMedia(to: string, mediaId: string, mimeType: string, fileName?: string | null, caption?: string | null): Promise<MetaSendResult> {
    const mediaType = mimeType.startsWith("image/") ? "image" : "document";
    return this.sendPayload({ messaging_product: "whatsapp", recipient_type: "individual", to, type: mediaType, [mediaType]: { id: mediaId, ...(caption ? { caption } : {}), ...(mediaType === "document" && fileName ? { filename: fileName } : {}) } });
  }

  async uploadMedia(buffer: Buffer, mimeType: string, fileName: string): Promise<{ ok: true; mediaId: string } | { ok: false; status: number; error: string }> {
    if (!this.isConfigured()) return { ok: false, status: 503, error: "WhatsApp is not configured" };
    const form = new FormData();
    form.set("messaging_product", "whatsapp");
    form.set("type", mimeType);
    form.set("file", new Blob([new Uint8Array(buffer)], { type: mimeType }), fileName);
    try {
      const response = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/${process.env.META_WHATSAPP_PHONE_NUMBER_ID}/media`, { method: "POST", headers: { Authorization: `Bearer ${process.env.META_WHATSAPP_ACCESS_TOKEN}` }, body: form, signal: AbortSignal.timeout(META_REQUEST_TIMEOUT_MS) });
      const payload = await response.json().catch(() => ({})) as { id?: string; error?: { message?: string } };
      return response.ok && payload.id ? { ok: true, mediaId: payload.id } : { ok: false, status: response.status, error: payload.error?.message || "WhatsApp media upload failed" };
    } catch (error) { return { ok: false, status: 503, error: error instanceof Error ? error.message : String(error) }; }
  }

  async downloadMedia(metaMediaId: string): Promise<{ buffer: Buffer; mimeType: string | null }> {
    const token = process.env.META_WHATSAPP_ACCESS_TOKEN;
    if (!token) throw new Error("WhatsApp access token is not configured");
    const metadataResponse = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/${encodeURIComponent(metaMediaId)}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(META_REQUEST_TIMEOUT_MS) });
    const metadata = await metadataResponse.json().catch(() => ({})) as { url?: string; mime_type?: string; file_size?: number; error?: { message?: string } };
    if (!metadataResponse.ok || !metadata.url) throw new Error(metadata.error?.message || "WhatsApp media metadata download failed");
    if ((metadata.file_size || 0) > MAX_WHATSAPP_MEDIA_BYTES) throw new WhatsappMediaValidationError("file_too_large", "File exceeds the 10 MB limit");
    const contentResponse = await fetch(metadata.url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(META_REQUEST_TIMEOUT_MS) });
    if (!contentResponse.ok) throw new Error("WhatsApp media download failed");
    if (!contentResponse.body) throw new Error("WhatsApp media download returned no content");
    const validated = await readAndValidateWhatsappMedia(
      Readable.fromWeb(contentResponse.body as Parameters<typeof Readable.fromWeb>[0]),
      metadata.file_size,
    );
    return { buffer: validated.buffer, mimeType: validated.mimeType };
  }

  async fetchApprovedTemplates(): Promise<{ ok: true; templates: Array<Record<string, unknown>> } | { ok: false; status: number; error: string }> {
    const businessId = process.env.META_WHATSAPP_BUSINESS_ACCOUNT_ID;
    const token = process.env.META_WHATSAPP_ACCESS_TOKEN;
    if (!businessId || !token) return { ok: false, status: 503, error: "WhatsApp Business Account is not configured" };
    try {
      const response = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/${businessId}/message_templates?limit=250`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(META_REQUEST_TIMEOUT_MS) });
      const payload = await response.json().catch(() => ({})) as { data?: Array<Record<string, unknown>>; error?: { message?: string } };
      return response.ok ? { ok: true, templates: payload.data || [] } : { ok: false, status: response.status, error: payload.error?.message || "Template synchronization failed" };
    } catch (error) { return { ok: false, status: 503, error: error instanceof Error ? error.message : String(error) }; }
  }

  async sendInteractiveButtons(to: string, body: string, buttons: WhatsappReplyButton[]): Promise<MetaSendResult> {
    if (buttons.length < 1 || buttons.length > 3) {
      return { ok: false, status: 400, providerCode: null, error: "WhatsApp interactive button messages require 1 to 3 buttons" };
    }

    return this.sendPayload({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: body },
        action: {
          buttons: buttons.map((button) => ({
            type: "reply",
            reply: {
              id: button.id,
              title: button.title,
            },
          })),
        },
      },
    });
  }

  async sendFlow(to: string, params: WhatsappFlowParams): Promise<MetaSendResult> {
    return this.sendPayload({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "interactive",
      interactive: {
        type: "flow",
        ...(params.header ? { header: { type: "text", text: params.header } } : {}),
        body: { text: params.body },
        ...(params.footer ? { footer: { text: params.footer } } : {}),
        action: {
          name: "flow",
          parameters: {
            flow_message_version: "3",
            flow_action: "navigate",
            flow_token: params.flowToken,
            flow_id: params.flowId,
            flow_cta: params.cta,
            flow_action_payload: {
              screen: params.screen || "ENQUIRY_FORM",
              data: params.data || {},
            },
          },
        },
      },
    });
  }

  private async sendPayload(payload: Record<string, unknown>): Promise<MetaSendResult> {
    if (!this.isConfigured()) {
      return { ok: false, status: 503, providerCode: null, error: "WhatsApp is not configured" };
    }

    const phoneNumberId = process.env.META_WHATSAPP_PHONE_NUMBER_ID;
    const accessToken = process.env.META_WHATSAPP_ACCESS_TOKEN;
    let res: Response;
    try {
      res = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/${phoneNumberId}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(META_REQUEST_TIMEOUT_MS),
        body: JSON.stringify(payload),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        status: 503,
        providerCode: null,
        error: `WhatsApp network request failed: ${message}`,
      };
    }

    const responsePayload = await res.json().catch(() => ({})) as {
      error?: { code?: number; message?: string };
      messages?: Array<{ id?: string }>;
    };
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        providerCode: typeof responsePayload.error?.code === "number" ? responsePayload.error.code : null,
        error: responsePayload.error?.message || `WhatsApp API request failed with status ${res.status}`,
      };
    }

    const messages = responsePayload.messages;
    return { ok: true, messageId: messages?.[0]?.id, payload: responsePayload };
  }
}

export const whatsappMetaService = new WhatsappMetaService();
export { SIGNATURE_HEADER as WHATSAPP_SIGNATURE_HEADER };
