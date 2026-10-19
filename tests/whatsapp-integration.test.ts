/**
 * Static integration coverage for the WhatsApp communication system.
 *
 * Run with: npx tsx tests/whatsapp-integration.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WhatsAppIntegrationCard } from "../client/src/components/whatsapp-integration-card";
import {
  getWhatsAppConnectionState,
  type WhatsAppSettingsStatus,
} from "../client/src/lib/whatsapp-integration-status";

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const schemaSource = read("../shared/schema.ts");
const permissionsSource = read("../shared/permissions.ts");
const routeIndexSource = read("../server/routes/index.ts");
const bootstrapSource = read("../server/db-bootstrap.ts");
const envExample = read("../.env.example");
const apiIntegrationsPageSource = read("../client/src/pages/api-integrations.tsx");
const whatsappIntegrationCardSource = read("../client/src/components/whatsapp-integration-card.tsx");

const configuredWhatsAppSettings: WhatsAppSettingsStatus = {
  verifyTokenConfigured: true,
  appSecretConfigured: true,
  accessTokenConfigured: true,
  phoneNumberIdConfigured: true,
  businessAccountIdConfigured: true,
  defaultTemplate: "bfm_case_update",
};

function renderWhatsAppCard(overrides: Partial<Parameters<typeof WhatsAppIntegrationCard>[0]> = {}) {
  return WhatsAppIntegrationCard({
    webhookEndpointUrl: "https://crm.example/api/public/whatsapp/webhook",
    status: configuredWhatsAppSettings,
    isPending: false,
    isError: false,
    isFetching: false,
    onRetry: () => undefined,
    onCopy: () => undefined,
    ...overrides,
  });
}

function findByTestId(node: ReactNode, testId: string): ReactElement | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const match = findByTestId(child, testId);
      if (match) return match;
    }
    return undefined;
  }
  if (!isValidElement(node)) return undefined;

  const props = node.props as { children?: ReactNode; "data-testid"?: string };
  if (props["data-testid"] === testId) return node;
  return findByTestId(props.children, testId);
}

test("WhatsApp schema defines required tables and indexes", () => {
  for (const name of [
    "whatsappContacts",
    "whatsappConversations",
    "whatsappMessages",
    "whatsappOtps",
    "whatsappAttachments",
    "whatsappOutbox",
  ]) {
    assert.match(schemaSource, new RegExp(`export const ${name}`));
  }
  assert.match(schemaSource, /whatsapp_messages_meta_message_id_idx/);
  assert.match(schemaSource, /whatsapp_conversations_window_idx/);
  assert.match(bootstrapSource, /CREATE TABLE IF NOT EXISTS whatsapp_contacts/);
});

test("WhatsApp permission section and navigation are wired", () => {
  const sidebarSource = read("../client/src/components/layout/app-sidebar.tsx");
  const layoutSource = read("../client/src/components/layout/dashboard-layout.tsx");
  assert.match(permissionsSource, /"whatsapp"/);
  assert.match(sidebarSource, /WhatsApp/);
  assert.match(sidebarSource, /section:\s*"whatsapp"/);
  assert.match(layoutSource, /WhatsAppPage/);
  assert.match(layoutSource, /\/whatsapp/);
});

test("WhatsApp services and routes exist", () => {
  const routesSource = read("../server/routes/whatsapp.routes.ts");
  for (const path of [
    "/api/public/whatsapp/webhook",
    "/api/whatsapp/conversations",
    "/api/whatsapp/settings",
  ]) {
    assert.match(routesSource, new RegExp(path.replace(/\//g, "\\/")));
  }
  for (const file of [
    "../server/services/whatsapp-meta.service.ts",
    "../server/services/whatsapp-webhook.service.ts",
    "../server/services/whatsapp-conversation.service.ts",
    "../server/services/whatsapp-automation.service.ts",
    "../server/services/whatsapp-otp.service.ts",
    "../server/services/whatsapp-outbox.service.ts",
  ]) {
    assert.doesNotThrow(() => read(file));
  }
  assert.match(routeIndexSource, /whatsappRoutes/);
});

test("WhatsApp security and Meta env configuration are documented", () => {
  for (const key of [
    "META_WHATSAPP_VERIFY_TOKEN",
    "META_WHATSAPP_APP_SECRET",
    "META_WHATSAPP_ACCESS_TOKEN",
    "META_WHATSAPP_PHONE_NUMBER_ID",
    "META_WHATSAPP_BUSINESS_ACCOUNT_ID",
  ]) {
    assert.match(envExample, new RegExp(key));
  }
  const metaSource = read("../server/services/whatsapp-meta.service.ts");
  assert.match(metaSource, /X-Hub-Signature-256/);
  assert.match(metaSource, /timingSafeEqual/);
});

test("WhatsApp staff inbox page exists", () => {
  const pageSource = read("../client/src/pages/whatsapp.tsx");
  assert.match(pageSource, /Automation/);
  assert.match(pageSource, /24-hour/);
  assert.match(pageSource, /Send/);
});

test("WhatsApp staff inbox uses shared chat composer with approved templates", () => {
  const pageSource = read("../client/src/pages/whatsapp.tsx");
  const routeSource = read("../server/routes/whatsapp.routes.ts");
  const workspaceSource = read("../client/src/components/whatsapp/whatsapp-chat-workspace.tsx");

  assert.match(pageSource, /WhatsappChatWorkspace/);
  assert.match(pageSource, /templateSyncStatus/);
  assert.match(workspaceSource, /selectedMode/);
  assert.match(workspaceSource, /Free text/);
  assert.match(workspaceSource, /Approved template/);
  assert.match(workspaceSource, /data-testid="whatsapp-template-preview"/);
  assert.match(workspaceSource, /components: Array<Record<string, unknown>>/);
  assert.doesNotMatch(workspaceSource, /selectedMode === "template" && templateId === "none"[\s\S]*setSelectedMode\("text"\)/);
  assert.match(routeSource, /template: z\.object/);
  assert.match(routeSource, /whatsappTemplateService\.getApprovedTemplate/);
  assert.doesNotMatch(pageSource, /placeholder="Type a manual WhatsApp reply"/);
});

test("WhatsApp connection state distinguishes loading, errors, complete, and incomplete setup", () => {
  assert.equal(getWhatsAppConnectionState(undefined, true, false), "loading");
  assert.equal(getWhatsAppConnectionState(undefined, false, true), "unavailable");
  assert.equal(getWhatsAppConnectionState(configuredWhatsAppSettings, false, false), "configured");
  assert.equal(
    getWhatsAppConnectionState(
      { ...configuredWhatsAppSettings, businessAccountIdConfigured: false },
      false,
      false,
    ),
    "incomplete",
  );
});

test("API integrations page exposes WhatsApp setup status without secret values", () => {
  assert.match(apiIntegrationsPageSource, /queryKey:\s*\["\/api\/whatsapp\/settings"\]/);
  assert.match(apiIntegrationsPageSource, /\/api\/public\/whatsapp\/webhook/);
  assert.match(apiIntegrationsPageSource, /<WhatsAppIntegrationCard/);
  assert.match(whatsappIntegrationCardSource, /data-testid="whatsapp-integration-card"/);
  assert.match(whatsappIntegrationCardSource, /data-testid={`whatsapp-setting-\$\{setting\.key\}`}/);
  assert.doesNotMatch(
    `${apiIntegrationsPageSource}\n${whatsappIntegrationCardSource}`,
    /META_WHATSAPP_(?:VERIFY_TOKEN|APP_SECRET|ACCESS_TOKEN)\s*[=:]/,
  );
});

test("WhatsApp setup card renders configured status and copies the webhook URL", () => {
  let copied = false;
  const card = renderWhatsAppCard({ onCopy: () => { copied = true; } });
  const html = renderToStaticMarkup(card);

  assert.match(html, />Configured</);
  assert.match(html, /bfm_case_update/);
  assert.match(html, /https:\/\/crm\.example\/api\/public\/whatsapp\/webhook/);
  assert.doesNotMatch(html, />Missing</);

  const copyButton = findByTestId(card, "button-copy-whatsapp-webhook");
  assert.ok(copyButton);
  (copyButton.props as { onClick: () => void }).onClick();
  assert.equal(copied, true);
});

test("WhatsApp setup card renders incomplete settings and template fallback", () => {
  const html = renderToStaticMarkup(renderWhatsAppCard({
    status: {
      ...configuredWhatsAppSettings,
      businessAccountIdConfigured: false,
      defaultTemplate: null,
    },
  }));

  assert.match(html, />Incomplete</);
  assert.match(html, />Missing</);
  assert.match(html, /Not configured/);
});

test("WhatsApp setup card keeps settings hidden while loading", () => {
  const html = renderToStaticMarkup(renderWhatsAppCard({ status: undefined, isPending: true }));

  assert.match(html, />Loading</);
  assert.match(html, /Checking WhatsApp configuration/);
  assert.doesNotMatch(html, />Missing</);
});

test("WhatsApp setup card renders unavailable status and retries without showing missing settings", () => {
  let retried = false;
  const card = renderWhatsAppCard({
    status: undefined,
    isError: true,
    onRetry: () => { retried = true; },
  });
  const html = renderToStaticMarkup(card);

  assert.match(html, /Status unavailable/);
  assert.match(html, /Could not load the WhatsApp configuration status/);
  assert.doesNotMatch(html, />Missing</);

  const retryButton = findByTestId(card, "button-retry-whatsapp-status");
  assert.ok(retryButton);
  (retryButton.props as { onClick: () => void }).onClick();
  assert.equal(retried, true);
});
