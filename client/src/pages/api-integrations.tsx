import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CalendarClock, ChevronDown, ChevronUp, Copy, KeyRound, Plus, ReceiptText, RefreshCw } from "lucide-react";
import { WhatsAppIntegrationCard } from "@/components/whatsapp-integration-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { WhatsAppSettingsStatus } from "@/lib/whatsapp-integration-status";
import { ISSUE_TYPES, LEAD_SOURCES, REFERRAL_TYPES } from "@shared/schema";

type ApiIntegration = {
  id: string;
  type: string;
  label: string;
  keyPrefix: string;
  status: "active" | "revoked" | string;
  createdAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
};

type CreatedIntegration = {
  integration: ApiIntegration;
  apiKey: string;
};

type IntegrationStatus = {
  calendlyWebhookSigningKeyConfigured: boolean;
  calendlyPatConfigured: boolean;
  calendlyOrganizationUriConfigured: boolean;
  xeroClientIdConfigured: boolean;
  xeroClientSecretConfigured: boolean;
  xeroWebhookKeyConfigured: boolean;
  xeroDefaultAccountCodeConfigured: boolean;
  xeroDefaultTaxTypeConfigured: boolean;
  xeroDefaultBrandingThemeIdConfigured: boolean;
};

type XeroStatus = {
  connected: boolean;
  configured: IntegrationStatus;
  connection: null | {
    tenantId: string;
    tenantName: string | null;
    tenantType: string | null;
    tokenExpiresAt: string;
  };
  lastError: string | null;
};

type XeroTaxRate = {
  taxType: string;
  name: string | null;
  status: string | null;
  displayTaxRate: string | null;
  effectiveRate: string | null;
  canApplyToRevenue: boolean;
  canApplyToExpenses: boolean;
  reportTaxType: string | null;
};

type XeroTaxRatesResponse = {
  tenantId: string;
  tenantName: string | null;
  taxRates: XeroTaxRate[];
  recommendedTaxType: XeroTaxRate | null;
};

type XeroInvoiceSetupResponse = {
  ready: boolean;
  tenantId: string;
  tenantName: string | null;
  requiredCurrency: string;
  configuredAccountCode: string | null;
  configuredTaxType: string | null;
  currencies: Array<{ code: string; description: string | null }>;
  account: null | {
    code: string;
    name: string | null;
    status: string | null;
    type: string | null;
    class: string | null;
    taxType: string | null;
  };
  taxRate: XeroTaxRate | null;
  recommendedTaxType: XeroTaxRate | null;
  issues: string[];
};

type CalendlySubscriptionResponse = {
  success: boolean;
  deletedCount: number;
  preflight?: {
    ok: true;
    status: number;
    reason: string;
  };
  subscription: {
    uri: string | null;
    callbackUrl: string | null;
    state: string | null;
    events: string[];
    scope: string | null;
    organization: string | null;
  };
};

const websiteEndpointPath = "/api/public/integrations/website-enquiries";
const calendlyEndpointPath = "/api/public/integrations/calendly-consultations";
const xeroWebhookEndpointPath = "/api/public/integrations/xero/webhook";
const whatsappWebhookEndpointPath = "/api/public/whatsapp/webhook";

const examplePayload = `{
  "firstName": "Kelly",
  "lastName": "Smith",
  "email": "kelly@example.com",
  "mobileTelephone": "07123456789",
  "postcode": "SW1A 1AA",
  "leadSource": "Website",
  "referralType": "Self-referral",
  "issueType": "Child arrangements",
  "notes": "Submitted from the website contact form"
}`;

const metadataPayload = `{
  "websitePageUrl": "https://www.brighterfuturemediation.co.uk/contact",
  "utmSource": "google",
  "utmMedium": "organic",
  "utmCampaign": "family-mediation"
}`;

const calendlyExamplePayload = `{
  "event": "invitee.created",
  "created_at": "2026-08-05T09:30:00.000000Z",
  "payload": {
    "uri": "https://api.calendly.com/scheduled_events/AAAA/invitees/BBBB",
    "event": "https://api.calendly.com/scheduled_events/AAAA",
    "name": "Kelly Smith",
    "first_name": "Kelly",
    "last_name": "Smith",
    "email": "kelly@example.com",
    "event_type_name": "Initial consultation",
    "start_time": "2026-08-12T10:00:00.000000Z",
    "end_time": "2026-08-12T10:30:00.000000Z",
    "timezone": "Europe/London",
    "questions_and_answers": [
      { "question": "Mobile telephone", "answer": "07123456789" },
      { "question": "Postcode", "answer": "SW1A 1AA" },
      { "question": "How did you hear about us?", "answer": "Website" },
      { "question": "Are you referring yourself or a client?", "answer": "Self-referral" },
      { "question": "What kind of mediation would you like to discuss?", "answer": "Child arrangements" }
    ]
  }
}`;

const fieldReference = [
  { field: "firstName", label: "First name", required: "Yes", type: "string", allowed: "-", notes: "Visible CRM enquiry field." },
  { field: "lastName", label: "Last name", required: "Yes", type: "string", allowed: "-", notes: "Visible CRM enquiry field." },
  { field: "email", label: "Email address", required: "Yes", type: "email string", allowed: "-", notes: "Used for the acknowledgement email." },
  { field: "mobileTelephone", label: "Telephone", required: "Yes", type: "string", allowed: "-", notes: "Main contact telephone." },
  { field: "postcode", label: "Postcode", required: "Yes", type: "string", allowed: "-", notes: "Visible CRM enquiry field." },
  { field: "leadSource", label: "How did you hear about us?", required: "Yes", type: "enum", allowed: LEAD_SOURCES.join(", "), notes: "Must match one of the allowed values exactly." },
  { field: "leadSourceOther", label: "Please specify", required: "Conditional", type: "string", allowed: "-", notes: 'Use when leadSource is "Other (please specify)" or "Word of mouth (please tell us who?)".' },
  { field: "referralType", label: "Are you referring yourself or a client?", required: "Yes", type: "enum", allowed: REFERRAL_TYPES.join(", "), notes: "This is the CRM referral question." },
  { field: "issueType", label: "What kind of mediation would you like to discuss?", required: "Yes", type: "enum", allowed: ISSUE_TYPES.join(", "), notes: "Must match one of the allowed values exactly." },
  { field: "issueTypeOther", label: "Please give details", required: "Conditional", type: "string", allowed: "-", notes: 'Use when issueType is "Other (please give details below)".' },
  { field: "notes", label: "Anything else you'd like to tell us?", required: "No", type: "string", allowed: "-", notes: "Optional visible CRM notes field." },
  { field: "privacyConsent", label: "Privacy consent received", required: "No", type: "boolean", allowed: "true, false", notes: "Optional edit-visible consent flag." },
];

function fmtDate(value: string | null) {
  if (!value) return "Never";
  return new Date(value).toLocaleString();
}

function calendlyUpdateErrorMessage(error: Error) {
  const message = error.message || "Calendly webhook update failed";
  if (message.includes("<!DOCTYPE") || message.includes("<html") || message.includes("trycloudflare.com")) {
    return "Tunnel is not reachable. Restart Cloudflare tunnel to 127.0.0.1:5000, refresh this page through the new tunnel URL, then click Update Calendly webhook.";
  }
  return message;
}

export default function ApiIntegrationsPage() {
  const { toast } = useToast();
  const [label, setLabel] = useState("Website enquiries");
  const [newKey, setNewKey] = useState<string | null>(null);
  const [showFieldReference, setShowFieldReference] = useState(false);
  const endpointUrl = `${window.location.origin}${websiteEndpointPath}`;
  const calendlyEndpointUrl = `${window.location.origin}${calendlyEndpointPath}`;
  const xeroWebhookEndpointUrl = `${window.location.origin}${xeroWebhookEndpointPath}`;
  const whatsappWebhookEndpointUrl = `${window.location.origin}${whatsappWebhookEndpointPath}`;
  const [calendlyCallbackUrl, setCalendlyCallbackUrl] = useState(calendlyEndpointUrl);
  const [calendlyUpdateStatus, setCalendlyUpdateStatus] = useState<string | null>(null);
  const calendlyWebhookCurl = `curl --request POST \\
  --url https://api.calendly.com/webhook_subscriptions \\
  --header "Authorization: Bearer YOUR_CALENDLY_PERSONAL_ACCESS_TOKEN" \\
  --header "Content-Type: application/json" \\
  --data '{
    "url": "${calendlyEndpointUrl}",
    "events": ["invitee.created"],
    "organization": "CALENDLY_ORGANIZATION_URI",
    "scope": "organization"
  }'`;

  const integrations = useQuery<ApiIntegration[]>({
    queryKey: ["/api/integrations"],
  });

  const integrationStatus = useQuery<IntegrationStatus>({
    queryKey: ["/api/integrations/status"],
  });

  const xeroStatus = useQuery<XeroStatus>({
    queryKey: ["/api/integrations/xero/status"],
  });

  const whatsappSettingsQuery = useQuery<WhatsAppSettingsStatus>({
    queryKey: ["/api/whatsapp/settings"],
  });

  const xeroTaxRates = useQuery<XeroTaxRatesResponse>({
    queryKey: ["/api/integrations/xero/tax-rates"],
    enabled: false,
  });

  const xeroInvoiceSetup = useQuery<XeroInvoiceSetupResponse>({
    queryKey: ["/api/integrations/xero/invoice-setup"],
    enabled: Boolean(xeroStatus.data?.connected),
  });

  const calendlyWebhookSigningKeyConfigured = integrationStatus.data?.calendlyWebhookSigningKeyConfigured ?? false;
  const calendlyPatConfigured = integrationStatus.data?.calendlyPatConfigured ?? false;
  const calendlyOrganizationUriConfigured = integrationStatus.data?.calendlyOrganizationUriConfigured ?? false;
  const xeroClientIdConfigured = integrationStatus.data?.xeroClientIdConfigured ?? false;
  const xeroClientSecretConfigured = integrationStatus.data?.xeroClientSecretConfigured ?? false;
  const xeroWebhookKeyConfigured = integrationStatus.data?.xeroWebhookKeyConfigured ?? false;
  const xeroDefaultAccountCodeConfigured = integrationStatus.data?.xeroDefaultAccountCodeConfigured ?? false;
  const xeroDefaultTaxTypeConfigured = integrationStatus.data?.xeroDefaultTaxTypeConfigured ?? false;

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/integrations", { label });
      return res.json() as Promise<CreatedIntegration>;
    },
    onSuccess: (data) => {
      setNewKey(data.apiKey);
      queryClient.invalidateQueries({ queryKey: ["/api/integrations"] });
      toast({ title: "API key created", description: "Copy it now. It will not be shown again." });
    },
    onError: (err: Error) => toast({ title: "Could not create API key", description: err.message, variant: "destructive" }),
  });

  const revokeMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("PATCH", `/api/integrations/${id}/revoke`, {});
      return res.json() as Promise<ApiIntegration>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/integrations"] });
      toast({ title: "API key revoked" });
    },
    onError: (err: Error) => toast({ title: "Could not revoke API key", description: err.message, variant: "destructive" }),
  });

  const calendlySubscriptionMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/integrations/calendly/webhook-subscription", {
        callbackUrl: calendlyCallbackUrl,
      });
      return res.json() as Promise<CalendlySubscriptionResponse>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/status"] });
      setCalendlyUpdateStatus(
        `Webhook ${data.subscription.state || "updated"} at ${data.subscription.callbackUrl || calendlyCallbackUrl}`,
      );
      toast({
        title: "Calendly webhook updated",
        description: data.subscription.state
          ? `Subscription ${data.subscription.state}. Removed ${data.deletedCount} old subscription(s).`
          : "Subscription updated.",
      });
    },
    onError: (err: Error) => {
      const safeMessage = calendlyUpdateErrorMessage(err);
      setCalendlyUpdateStatus(`Update failed: ${safeMessage}`);
      toast({
        title: "Could not update Calendly webhook",
        description: safeMessage,
        variant: "destructive",
      });
    },
  });

  const activeRevenueTaxRates = xeroTaxRates.data?.taxRates.filter((rate) =>
    rate.status?.toUpperCase() === "ACTIVE" && rate.canApplyToRevenue,
  ) || [];
  const xeroCurrencyCodes = xeroInvoiceSetup.data?.currencies.map((currency) => currency.code).join(", ") || "Not loaded";

  async function copy(value: string, label: string) {
    await navigator.clipboard.writeText(value);
    toast({ title: "Copied", description: label });
  }

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto" data-testid="api-integrations-page">
      <div>
        <h1 className="text-2xl font-heading font-semibold text-foreground">API</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage external server-to-server APIs for Brighter Future Mediation.</p>
      </div>

      <Card data-testid="xero-integration-card">
        <CardHeader>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg">
                <ReceiptText className="w-5 h-5" />
                Xero invoices
              </CardTitle>
              <CardDescription>
                Create approved MIAM invoices in Xero, email the payment link from CRM, and confirm appointments after Xero marks them paid.
              </CardDescription>
            </div>
            <Badge variant={xeroStatus.data?.connected ? "default" : "secondary"}>
              {xeroStatus.data?.connected ? "Connected" : "Not connected"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-3 md:grid-cols-[1fr_auto]">
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Webhook endpoint</p>
              <code className="block rounded-md border bg-muted px-3 py-2 text-sm break-all">{xeroWebhookEndpointUrl}</code>
            </div>
            <Button variant="outline" className="self-end" onClick={() => copy(xeroWebhookEndpointUrl, "Xero webhook endpoint")}>
              <Copy className="w-4 h-4 mr-2" />
              Copy
            </Button>
          </div>

          <div className="rounded-md border p-4 space-y-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h3 className="text-sm font-semibold">Connection</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  {xeroStatus.data?.connection
                    ? `Custom Connection authorised for ${xeroStatus.data.connection.tenantName || xeroStatus.data.connection.tenantId}.`
                    : "The Xero Custom Connection is unavailable. Check its environment credentials and Xero authorisation."}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant={xeroClientIdConfigured ? "default" : "secondary"}>Client ID {xeroClientIdConfigured ? "set" : "missing"}</Badge>
                <Badge variant={xeroClientSecretConfigured ? "default" : "secondary"}>Client secret {xeroClientSecretConfigured ? "set" : "missing"}</Badge>
                <Badge variant={xeroWebhookKeyConfigured ? "default" : "secondary"}>Webhook key {xeroWebhookKeyConfigured ? "set" : "missing"}</Badge>
                <Badge variant={xeroDefaultAccountCodeConfigured ? "default" : "secondary"}>Account code {xeroDefaultAccountCodeConfigured ? "set" : "missing"}</Badge>
                <Badge variant={xeroDefaultTaxTypeConfigured ? "default" : "secondary"}>Tax type {xeroDefaultTaxTypeConfigured ? "set" : "missing"}</Badge>
              </div>
            </div>

            {xeroStatus.data?.connection && (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 text-sm">
                <div><span className="text-xs text-muted-foreground">Tenant</span><p className="font-medium">{xeroStatus.data.connection.tenantName || xeroStatus.data.connection.tenantId}</p></div>
                <div><span className="text-xs text-muted-foreground">Token expires</span><p className="font-medium">{fmtDate(xeroStatus.data.connection.tokenExpiresAt)}</p></div>
              </div>
            )}
            {xeroStatus.data?.lastError && (
              <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{xeroStatus.data.lastError}</p>
            )}

            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" onClick={() => xeroStatus.refetch()} disabled={xeroStatus.isFetching}>
                {xeroStatus.isFetching ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                Refresh
              </Button>
            </div>
          </div>

          <div className="rounded-md border p-4 space-y-4" data-testid="xero-invoice-setup-panel">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h3 className="text-sm font-semibold">Invoice setup</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  MIAM invoices require GBP, a revenue account, and an active revenue tax type in the connected Xero organisation.
                </p>
              </div>
              <Button
                variant="outline"
                onClick={() => xeroInvoiceSetup.refetch()}
                disabled={!xeroStatus.data?.connected || xeroInvoiceSetup.isFetching}
                data-testid="button-check-xero-invoice-setup"
              >
                {xeroInvoiceSetup.isFetching ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                Check invoice setup
              </Button>
            </div>

            {xeroInvoiceSetup.error instanceof Error && (
              <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{xeroInvoiceSetup.error.message}</p>
            )}

            {xeroInvoiceSetup.data && !xeroInvoiceSetup.data.ready && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700" data-testid="xero-invoice-setup-warning">
                <p className="font-medium">Xero invoice setup is blocking GBP invoice creation.</p>
                <ul className="mt-2 list-disc pl-5 space-y-1">
                  {xeroInvoiceSetup.data.issues.map((issue) => <li key={issue}>{issue}</li>)}
                </ul>
              </div>
            )}

            {xeroInvoiceSetup.data?.ready && (
              <p className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900" data-testid="xero-invoice-setup-ready">
                Xero invoice setup is ready for GBP MIAM invoices.
              </p>
            )}

            {xeroInvoiceSetup.data && (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
                <div>
                  <span className="text-xs text-muted-foreground">Required currency</span>
                  <p className="font-medium">{xeroInvoiceSetup.data.requiredCurrency}</p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Enabled currencies</span>
                  <p className="font-medium">{xeroCurrencyCodes}</p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Account code</span>
                  <p className="font-medium">
                    {xeroInvoiceSetup.data.configuredAccountCode || "Missing"}
                    {xeroInvoiceSetup.data.account?.name ? ` — ${xeroInvoiceSetup.data.account.name}` : ""}
                  </p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Tax type</span>
                  <p className="font-medium">
                    {xeroInvoiceSetup.data.configuredTaxType || "Missing"}
                    {xeroInvoiceSetup.data.taxRate?.name ? ` — ${xeroInvoiceSetup.data.taxRate.name}` : ""}
                  </p>
                </div>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              Environment values: <code>XERO_DEFAULT_ACCOUNT_CODE=200</code>, <code>XERO_DEFAULT_TAX_TYPE=OUTPUT</code>, required Xero currency <code>GBP</code>.
            </p>
          </div>

          <div className="rounded-md border p-4 space-y-4" data-testid="xero-tax-rates-panel">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h3 className="text-sm font-semibold">Tax types</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Load the tax rates available in the connected Xero organisation and choose the revenue tax type for MIAM invoices.
                </p>
              </div>
              <Button
                variant="outline"
                onClick={() => xeroTaxRates.refetch()}
                disabled={!xeroStatus.data?.connected || xeroTaxRates.isFetching}
                data-testid="button-load-xero-tax-rates"
              >
                {xeroTaxRates.isFetching ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <ReceiptText className="w-4 h-4 mr-2" />}
                Load tax rates from Xero
              </Button>
            </div>

            {xeroTaxRates.error instanceof Error && (
              <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{xeroTaxRates.error.message}</p>
            )}

            {xeroTaxRates.data?.recommendedTaxType && (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900" data-testid="xero-tax-type-recommendation">
                <p className="font-medium">
                  Recommended: {xeroTaxRates.data.recommendedTaxType.taxType} — {xeroTaxRates.data.recommendedTaxType.name || "Unnamed tax rate"}
                </p>
                <p className="mt-1">
                  Set <code>XERO_DEFAULT_TAX_TYPE={xeroTaxRates.data.recommendedTaxType.taxType}</code> in environment secrets.
                </p>
              </div>
            )}

            {xeroTaxRates.data && !xeroTaxRates.data.recommendedTaxType && (
              <p className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
                No active revenue-applicable tax type was returned by Xero. Check the organisation tax settings before creating invoices.
              </p>
            )}

            {activeRevenueTaxRates.length > 0 && (
              <div className="overflow-x-auto">
                <Table data-testid="xero-tax-rates-table">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tax type</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Rate</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Revenue</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {activeRevenueTaxRates.map((rate) => (
                      <TableRow key={rate.taxType} className={rate.taxType === xeroTaxRates.data?.recommendedTaxType?.taxType ? "bg-emerald-50/60" : undefined}>
                        <TableCell className="font-mono text-xs">{rate.taxType}</TableCell>
                        <TableCell>{rate.name || "-"}</TableCell>
                        <TableCell>{rate.displayTaxRate ?? rate.effectiveRate ?? "-"}</TableCell>
                        <TableCell><Badge variant="default">{rate.status || "Unknown"}</Badge></TableCell>
                        <TableCell>{rate.canApplyToRevenue ? "Yes" : "No"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>

          <div className="rounded-md border bg-muted/30 p-4 space-y-3" data-testid="xero-setup-steps">
            <h3 className="text-sm font-semibold">Xero setup steps</h3>
            <ol className="list-decimal pl-5 space-y-2 text-sm text-muted-foreground">
              <li>Create a Xero <span className="font-medium text-foreground">Custom Connection</span> authorised for this environment: Xero Demo Company in dev and BFM’s live organisation in production.</li>
              <li>Store only the Custom Connection client ID and client secret in the matching environment’s AWS secret; no redirect URI or CRM-side connection step is used.</li>
              <li>Authorise the permissions needed for contacts, sales invoices, payment reads, and accounting settings.</li>
              <li>In Xero, connect Stripe as an online payment service and apply it to the invoice template used by BFM.</li>
              <li>Add the webhook endpoint above in the Xero app, subscribe to Invoice events, and store the webhook key in <code>XERO_WEBHOOK_KEY</code>.</li>
              <li>Set <code>XERO_DEFAULT_ACCOUNT_CODE</code> and <code>XERO_DEFAULT_TAX_TYPE</code> in environment secrets before testing paid bookings.</li>
            </ol>
          </div>
        </CardContent>
      </Card>

      <WhatsAppIntegrationCard
        webhookEndpointUrl={whatsappWebhookEndpointUrl}
        status={whatsappSettingsQuery.data}
        isPending={whatsappSettingsQuery.isPending}
        isError={whatsappSettingsQuery.isError}
        isFetching={whatsappSettingsQuery.isFetching}
        onRetry={() => { void whatsappSettingsQuery.refetch(); }}
        onCopy={() => { void copy(whatsappWebhookEndpointUrl, "WhatsApp webhook endpoint"); }}
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <KeyRound className="w-5 h-5" />
            Website enquiries
          </CardTitle>
          <CardDescription>
            Use this endpoint from the website backend only. Do not expose API keys in browser JavaScript.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-3 md:grid-cols-[1fr_auto]">
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Endpoint</p>
              <code className="block rounded-md border bg-muted px-3 py-2 text-sm break-all">{endpointUrl}</code>
            </div>
            <Button variant="outline" className="self-end" onClick={() => copy(endpointUrl, "Endpoint URL")}>
              <Copy className="w-4 h-4 mr-2" />
              Copy
            </Button>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-3">
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Required header</p>
                <code className="block rounded-md border bg-muted px-3 py-2 text-sm">Authorization: Bearer &lt;api_key&gt;</code>
                <p className="text-xs text-muted-foreground mt-1">Alternatively send <code>X-API-Key</code>.</p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Success response</p>
                <code className="block rounded-md border bg-muted px-3 py-2 text-sm">{`201 { "success": true, "enquiryRef": "ENQ-2026-0001" }`}</code>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">CRM mapping</p>
                <p className="text-sm text-muted-foreground">
                  Submissions create a normal CRM enquiry, linked case/client/party, follow-up task, and acknowledgement email.
                  CRM stores <code>contactMethod</code> as <code>Website form</code> and records website origin as <code>Website API</code> in audit/notes.
                  The submitted <code>leadSource</code> is saved on the enquiry.
                </p>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs font-medium text-muted-foreground">Example JSON payload</p>
                <Button variant="ghost" size="sm" onClick={() => copy(examplePayload, "Example payload")}>
                  <Copy className="w-3.5 h-3.5 mr-1" />
                  Copy
                </Button>
              </div>
              <pre className="rounded-md border bg-muted p-3 text-xs overflow-auto max-h-[360px]">{examplePayload}</pre>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold">Field reference</h3>
              <Button
                variant="outline"
                size="sm"
                aria-expanded={showFieldReference}
                aria-controls="website-enquiry-field-reference"
                onClick={() => setShowFieldReference((value) => !value)}
              >
                {showFieldReference ? <ChevronUp className="w-4 h-4 mr-2" /> : <ChevronDown className="w-4 h-4 mr-2" />}
                {showFieldReference ? "Hide field reference" : "View field reference"}
              </Button>
            </div>
            {showFieldReference && (
              <div id="website-enquiry-field-reference" className="rounded-md border overflow-auto mt-2">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Field</TableHead>
                      <TableHead>Label</TableHead>
                      <TableHead>Required</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Allowed values</TableHead>
                      <TableHead>Notes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {fieldReference.map((field) => (
                      <TableRow key={field.field}>
                        <TableCell><code>{field.field}</code></TableCell>
                        <TableCell>{field.label}</TableCell>
                        <TableCell>{field.required}</TableCell>
                        <TableCell>{field.type}</TableCell>
                        <TableCell className="min-w-[260px] text-xs">{field.allowed}</TableCell>
                        <TableCell className="min-w-[220px] text-xs text-muted-foreground">{field.notes}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <p className="text-sm font-semibold mb-1">Website metadata</p>
              <p className="text-xs text-muted-foreground mb-2">
                Optional tracking fields are accepted for website analytics context. They are not the CRM referral question.
              </p>
              <pre className="rounded-md border bg-muted p-3 text-xs overflow-auto">{metadataPayload}</pre>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-semibold">Error examples</p>
              <code className="block rounded-md border bg-muted px-3 py-2 text-xs">{`401 { "success": false, "message": "Missing API key" }`}</code>
              <code className="block rounded-md border bg-muted px-3 py-2 text-xs">{`401 { "success": false, "message": "Invalid API key" }`}</code>
              <code className="block rounded-md border bg-muted px-3 py-2 text-xs">{`400 { "success": false, "message": "Invalid enquiry data", "errors": { "fieldErrors": { "issueType": ["Invalid enum value"] } } }`}</code>
            </div>
          </div>
        </CardContent>
	      </Card>

	      <Card>
	        <CardHeader>
	          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
	            <div>
	              <CardTitle className="flex items-center gap-2 text-lg">
	                <CalendarClock className="w-5 h-5" />
	                Calendly consultations
	              </CardTitle>
	              <CardDescription>
	                Use this callback URL in Calendly webhook subscriptions for consultation bookings.
	              </CardDescription>
	            </div>
	            <Badge variant={calendlyWebhookSigningKeyConfigured ? "default" : "secondary"}>
	              {calendlyWebhookSigningKeyConfigured ? "Configured" : "Not configured"}
	            </Badge>
	          </div>
	        </CardHeader>
	        <CardContent className="space-y-5">
	          <div className="grid gap-3 md:grid-cols-[1fr_auto]">
	            <div>
	              <p className="text-xs font-medium text-muted-foreground mb-1">Webhook endpoint</p>
	              <code className="block rounded-md border bg-muted px-3 py-2 text-sm break-all">{calendlyEndpointUrl}</code>
	            </div>
	            <Button variant="outline" className="self-end" onClick={() => copy(calendlyEndpointUrl, "Calendly webhook endpoint")}>
	              <Copy className="w-4 h-4 mr-2" />
	              Copy
	            </Button>
	          </div>

	          <div className="rounded-md border p-4 space-y-4">
	            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
	              <div>
	                <h3 className="text-sm font-semibold">Update Calendly webhook</h3>
	                <p className="text-sm text-muted-foreground mt-1">
	                  Open this page through the public HTTPS domain you want Calendly to call, then update the subscription.
	                </p>
	              </div>
	              <div className="flex flex-wrap gap-2">
	                <Badge variant={calendlyPatConfigured ? "default" : "secondary"}>CALENDLY_PAT {calendlyPatConfigured ? "set" : "missing"}</Badge>
	                <Badge variant={calendlyWebhookSigningKeyConfigured ? "default" : "secondary"}>Signing key {calendlyWebhookSigningKeyConfigured ? "set" : "missing"}</Badge>
	                <Badge variant={calendlyOrganizationUriConfigured ? "default" : "secondary"}>Organization URI {calendlyOrganizationUriConfigured ? "set" : "missing"}</Badge>
	              </div>
	            </div>
	            <div className="grid gap-3 lg:grid-cols-[1fr_auto_auto]">
	              <Input
	                value={calendlyCallbackUrl}
	                onChange={(event) => setCalendlyCallbackUrl(event.target.value)}
	                className="font-mono text-xs"
	                data-testid="input-calendly-callback-url"
	              />
	              <Button variant="outline" onClick={() => copy(calendlyCallbackUrl, "Calendly webhook URL")}>
	                <Copy className="w-4 h-4 mr-2" />
	                Copy webhook URL
	              </Button>
	              <Button
	                onClick={() => calendlySubscriptionMutation.mutate()}
	                disabled={calendlySubscriptionMutation.isPending || !calendlyCallbackUrl.trim()}
	                data-testid="button-update-calendly-webhook"
	              >
	                {calendlySubscriptionMutation.isPending ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
	                Update Calendly webhook
	              </Button>
	            </div>
	            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
	              <p className="text-xs text-muted-foreground">
	                For local testing, start Cloudflare tunnel to <code>127.0.0.1:5000</code>, open this page through the tunnel URL, then click update.
	              </p>
	              <Button variant="ghost" size="sm" onClick={() => integrationStatus.refetch()} disabled={integrationStatus.isFetching}>
	                {integrationStatus.isFetching ? <RefreshCw className="w-3.5 h-3.5 mr-1 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1" />}
	                Refresh status
	              </Button>
	            </div>
	            {calendlySubscriptionMutation.data?.subscription && (
	              <code className="block rounded-md border bg-muted px-3 py-2 text-xs break-all">
	                Active subscription: {calendlySubscriptionMutation.data.subscription.uri || "unknown"} · {calendlySubscriptionMutation.data.subscription.callbackUrl || calendlyCallbackUrl}
	              </code>
	            )}
	            {calendlyUpdateStatus && (
	              <p className="text-xs text-muted-foreground" data-testid="calendly-update-status">{calendlyUpdateStatus}</p>
	            )}
	          </div>

	          <div className="rounded-md border bg-muted/30 p-4 space-y-4" data-testid="calendly-setup-steps">
	            <div>
	              <h3 className="text-sm font-semibold">Calendly setup steps</h3>
	              <p className="text-sm text-muted-foreground mt-1">
	                No Calendly Developer OAuth app is required for this implementation. BFM receives signed Calendly webhooks only; it does not install a Calendly app or store OAuth tokens.
	              </p>
	            </div>
	            <ol className="list-decimal pl-5 space-y-2 text-sm text-muted-foreground">
	              <li>In Calendly, open <span className="font-medium text-foreground">Integrations</span>, then <span className="font-medium text-foreground">API & Webhooks</span>.</li>
	              <li>Create a <span className="font-medium text-foreground">Personal Access Token</span> and copy it immediately.</li>
	              <li>Choose webhook/API scopes for setup: <code>webhooks:write</code>, <code>webhooks:read</code>, and read access for scheduled events/invitees where Calendly offers those scope choices.</li>
	              <li>Create a webhook subscription for <code>invitee.created</code> using the endpoint above.</li>
	              <li>Use subscription scope <code>organization</code> for all BFM bookings. Use subscription scope <code>user</code> only for one Calendly account.</li>
	              <li>For local testing, do not send Calendly to <code>localhost</code> directly. Use a public HTTPS tunnel or the deployed HTTPS domain.</li>
	              <li>Set <code>CALENDLY_WEBHOOK_SIGNING_KEY</code> in environment secrets to the webhook signing key used by Calendly.</li>
	            </ol>
	            <div>
	              <div className="flex items-center justify-between gap-3 mb-1">
	                <p className="text-xs font-medium text-muted-foreground">Create webhook subscription curl template</p>
	                <Button variant="ghost" size="sm" onClick={() => copy(calendlyWebhookCurl, "Calendly webhook curl template")}>
	                  <Copy className="w-3.5 h-3.5 mr-1" />
	                  Copy
	                </Button>
	              </div>
	              <pre className="rounded-md border bg-background p-3 text-xs overflow-auto max-h-[260px]">{calendlyWebhookCurl}</pre>
	            </div>
	          </div>

	          <div className="grid gap-4 lg:grid-cols-2">
	            <div className="space-y-3">
	              <div>
	                <p className="text-xs font-medium text-muted-foreground mb-1">Webhook security</p>
	                <p className="text-sm text-muted-foreground">
	                  Configure <code>CALENDLY_WEBHOOK_SIGNING_KEY</code> in local <code>.env</code>, Replit development Secrets, and deployment
	                  secrets as applicable. The CRM verifies <code>Calendly-Webhook-Signature</code> before creating any enquiry and never
	                  exposes the signing key in this page.
	                </p>
	              </div>
	              <div>
	                <p className="text-xs font-medium text-muted-foreground mb-1">Supported event</p>
	                <code className="block rounded-md border bg-muted px-3 py-2 text-sm">invitee.created</code>
	                <p className="text-xs text-muted-foreground mt-1"><code>invitee.canceled</code> is accepted as an ignored no-op in v1.</p>
	              </div>
	              <div>
	                <p className="text-xs font-medium text-muted-foreground mb-1">Required Calendly questions</p>
	                <p className="text-sm text-muted-foreground">
	                  Mobile telephone, Postcode, How did you hear about us?, Are you referring yourself or a client?, and
	                  What kind of mediation would you like to discuss?. Enum answers must match the Website enquiries field reference values.
	                </p>
	              </div>
	              <div className="space-y-2">
	                <p className="text-xs font-medium text-muted-foreground">Responses</p>
	                <code className="block rounded-md border bg-muted px-3 py-2 text-xs">{`201 { "success": true, "enquiryRef": "ENQ-2026-0001" }`}</code>
	                <code className="block rounded-md border bg-muted px-3 py-2 text-xs">{`200 { "success": true, "ignored": true }`}</code>
	                <code className="block rounded-md border bg-muted px-3 py-2 text-xs">{`400 { "success": false, "message": "Invalid Calendly consultation data" }`}</code>
	                <code className="block rounded-md border bg-muted px-3 py-2 text-xs">{`401 { "success": false, "message": "Invalid Calendly webhook signature" }`}</code>
	              </div>
	            </div>

	            <div>
	              <div className="flex items-center justify-between mb-1">
	                <p className="text-xs font-medium text-muted-foreground">Example Calendly webhook payload</p>
	                <Button variant="ghost" size="sm" onClick={() => copy(calendlyExamplePayload, "Calendly example payload")}>
	                  <Copy className="w-3.5 h-3.5 mr-1" />
	                  Copy
	                </Button>
	              </div>
	              <pre className="rounded-md border bg-muted p-3 text-xs overflow-auto max-h-[420px]">{calendlyExamplePayload}</pre>
	            </div>
	          </div>
	        </CardContent>
	      </Card>

	      <Card>
	        <CardHeader>
	          <CardTitle className="text-lg">API keys</CardTitle>
          <CardDescription>Create bearer keys for server-to-server APIs such as Website enquiries. These keys do not expire automatically and remain valid until a superadmin revokes them. Calendly webhooks use their own signing key configured in environment secrets.</CardDescription>
	        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex flex-col gap-3 md:flex-row">
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Key label" className="md:max-w-sm" data-testid="input-api-key-label" />
            <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending || !label.trim()} data-testid="button-create-api-key">
              {createMutation.isPending ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
              Create key
            </Button>
          </div>

          {newKey && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 space-y-2" data-testid="new-api-key-panel">
              <p className="text-sm font-medium text-amber-900">Copy this key now. It will not be shown again.</p>
              <div className="flex flex-col gap-2 md:flex-row">
                <Input readOnly value={newKey} className="font-mono text-xs bg-white" data-testid="input-new-api-key" />
                <Button variant="outline" onClick={() => copy(newKey, "API key")}>
                  <Copy className="w-4 h-4 mr-2" />
                  Copy key
                </Button>
              </div>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            Revocation takes effect immediately. Raw keys are shown only once at creation and cannot be recovered later.
          </p>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Label</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Prefix</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Last used</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(integrations.data ?? []).map((integration) => (
                <TableRow key={integration.id}>
                  <TableCell className="font-medium">{integration.label}</TableCell>
                  <TableCell>
                    <Badge variant={integration.status === "active" ? "default" : "secondary"}>{integration.status}</Badge>
                  </TableCell>
                  <TableCell><code>{integration.keyPrefix}...</code></TableCell>
                  <TableCell>{fmtDate(integration.createdAt)}</TableCell>
                  <TableCell>{fmtDate(integration.lastUsedAt)}</TableCell>
                  <TableCell className="text-right">
                    {integration.status === "active" && (
                      <Button variant="outline" size="sm" onClick={() => revokeMutation.mutate(integration.id)} disabled={revokeMutation.isPending}>
                        Revoke
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {!integrations.isLoading && (integrations.data ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">
                    No API keys created yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
