import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { Save, Settings, ShieldCheck, Calendar, CheckCircle2, AlertCircle, RefreshCw, Unlink, AlertTriangle, ChevronDown, ExternalLink, CreditCard } from "lucide-react";
import {
  ACCESS_AREAS,
  CLIENT_PORTAL_ACCESS,
  CONFIGURABLE_ROLES,
  ROLE_LABELS,
  type PermissionEntry,
} from "@shared/permissions";
import { CalendarConnectModal } from "@/components/calendar/calendar-connect-modal";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { useCalendarOAuthResult } from "@/hooks/use-calendar-oauth-result";

interface MediatorCalendarStatus {
  role: string;
  configured: boolean;
  googleCalendarConnected: boolean;
  googleCalendarEmail: string | null;
  lastCalendarSyncAt: string | null;
  lastCalendarSyncError: string | null;
  hasWriteScope: boolean;
  needsWriteScope?: boolean;
  needsReauth?: boolean;
  outlookCalendarConnected: boolean;
  outlookCalendarEmail: string | null;
  lastOutlookSyncAt: string | null;
  lastOutlookSyncError: string | null;
  hasOutlookWriteScope: boolean;
  outlookConfigured: boolean;
  activeCalendarProvider: "google" | "outlook" | null;
}

const MEDIATOR_SYNC_ERROR_LABELS: Record<string, string> = {
  needs_reauth: "Google rejected your saved authorisation. Please reconnect.",
  needs_write_scope: "Calendar write access wasn't granted. Reconnect and tick all permission checkboxes.",
  rate_limited: "Google is rate-limiting requests. Will retry shortly.",
};

function formatMediatorSyncError(code: string | null): string {
  if (!code) return "";
  return MEDIATOR_SYNC_ERROR_LABELS[code] ?? `Last error: ${code}`;
}

function MediatorCalendarPanel() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [modalOpen, setModalOpen] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const { data: status, isLoading } = useQuery<MediatorCalendarStatus>({
    queryKey: ["/api/calendar/status/me"],
  });

  useCalendarOAuthResult({
    onConnected: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/status/me"] });
    },
  });

  const googleConnected = !!status?.googleCalendarConnected;
  const outlookConnected = !!status?.outlookCalendarConnected;
  const connected = googleConnected || outlookConnected;
  const activeProvider = status?.activeCalendarProvider ?? null;
  const disconnectProvider = activeProvider === "google" || activeProvider === "outlook"
    ? activeProvider
    : googleConnected ? "google" : outlookConnected ? "outlook" : null;
  const connectedProviderLabel = disconnectProvider === "google" ? "Google Calendar" : disconnectProvider === "outlook" ? "Microsoft Outlook" : "Calendar";
  const connectedEmail = disconnectProvider === "google" ? status?.googleCalendarEmail : disconnectProvider === "outlook" ? status?.outlookCalendarEmail : null;
  const needsReauth = !!status?.needsReauth;
  const needsWriteScope = !!status?.needsWriteScope;
  const lastSyncAt = googleConnected ? status?.lastCalendarSyncAt : outlookConnected ? status?.lastOutlookSyncAt : status?.lastCalendarSyncAt;
  const lastSynced = lastSyncAt ? new Date(lastSyncAt) : null;
  const syncError = googleConnected ? status?.lastCalendarSyncError : outlookConnected ? status?.lastOutlookSyncError : status?.lastCalendarSyncError;
  const showError = !!syncError;
  const activeProviderReady = (activeProvider === "google" && googleConnected) || (activeProvider === "outlook" && outlookConnected);
  const providerMutation = useMutation({
    mutationFn: async (provider: "google" | "outlook") => {
      const res = await apiRequest("PATCH", "/api/calendar/active-provider", { provider });
      return res.json();
    },
    onSuccess: (_, provider) => {
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/status/me"] });
      toast({
        title: provider === "google" ? "Google Calendar selected" : "Microsoft Outlook selected",
        description: "New mediator-side events will use this calendar.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Could not update calendar provider",
        description: error.message,
        variant: "destructive",
      });
    },
  });
  const disconnectMutation = useMutation({
    mutationFn: async () => {
      if (!user?.id || !disconnectProvider) throw new Error("No connected calendar was selected");
      const res = await apiRequest("DELETE", `/api/calendar/disconnect/${user.id}?provider=${disconnectProvider}`);
      return res.json();
    },
    onSuccess: () => {
      setDisconnectOpen(false);
      setModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/status/me"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      toast({
        title: "Calendar disconnected",
        description: "You can reconnect this calendar or connect another provider at any time.",
      });
    },
    onError: () => {
      toast({
        title: "Could not disconnect calendar",
        description: "Please try again. If the problem continues, contact BFM support.",
        variant: "destructive",
      });
    },
  });

  return (
    <Card className="border border-border/60" data-testid="card-mediator-calendar">
      <CardHeader className="pb-3 border-b bg-muted/20">
        <div className="flex items-center gap-2">
          <Calendar className="w-[18px] h-[18px] text-[#5a7d58]" />
          <CardTitle className="text-base font-heading">Your Calendar</CardTitle>
        </div>
        <CardDescription className="text-xs leading-relaxed">
          Connect your personal Google Calendar or Microsoft Outlook account so BFM can read your availability windows and create, edit, and delete bookings on your calendar.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-5 space-y-4">
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <>
            {needsReauth && (
              <div
                className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 p-3"
                data-testid="banner-mediator-needs-reauth"
              >
                <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <div className="min-w-0 text-xs leading-relaxed flex-1">
                  <p className="font-medium text-amber-900 dark:text-amber-100">Reauthentication required</p>
                  <p className="text-amber-800/90 dark:text-amber-200/90 mt-0.5">
                    Google rejected our saved authorisation for your calendar. Until you reconnect, your availability won't show on the booking pages and new appointments can't be added to your Google Calendar.
                  </p>
                </div>
                <Button
                  size="sm"
                  className="bg-[#5a7d58] hover:bg-[#4a6b48] text-white shrink-0"
                  onClick={() => setModalOpen(true)}
                  data-testid="button-mediator-reconnect"
                >
                  Reconnect
                </Button>
              </div>
            )}

            <div className="border rounded-xl p-4 bg-card">
              <div className="flex items-start gap-3 mb-3">
                <div className="w-10 h-10 rounded-lg bg-[#a7baa4]/20 flex items-center justify-center shrink-0">
                  <Calendar className="w-5 h-5 text-[#5a7d58]" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-sm text-foreground">{connectedProviderLabel}</p>
                    {connected && !needsReauth && !needsWriteScope ? (
                      <Badge variant="default" className="bg-[#5a7d58] hover:bg-[#5a7d58] text-white" data-testid="badge-mediator-connected">
                        <CheckCircle2 className="w-3 h-3 mr-1" /> Connected
                      </Badge>
                    ) : needsReauth ? (
                      <Badge
                        variant="outline"
                        className="border-amber-400 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100 dark:border-amber-700"
                        data-testid="badge-mediator-needs-reauth"
                      >
                        <AlertTriangle className="w-3 h-3 mr-1" /> Reauthentication required
                      </Badge>
                    ) : (
                      <Badge variant="destructive" data-testid="badge-mediator-disconnected">
                        <AlertCircle className="w-3 h-3 mr-1" /> Not connected
                      </Badge>
                    )}
                  </div>
                  {connectedEmail && (
                    <p className="text-xs text-muted-foreground mt-1 truncate" data-testid="text-mediator-cal-email">
                      {connectedEmail}
                    </p>
                  )}
                  {lastSynced && (
                    <p className="text-[11px] text-muted-foreground mt-1" data-testid="text-mediator-last-sync">
                      Last synced: {lastSynced.toLocaleString()}
                    </p>
                  )}
                  {showError && (
                    <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-1" data-testid="text-mediator-cal-error">
                      {formatMediatorSyncError(syncError ?? null)}
                    </p>
                  )}
                  {connected && (
                    <div className="mt-3 flex flex-wrap gap-2" data-testid="group-active-calendar-provider">
                      {googleConnected && (
                        <Button
                          type="button"
                          size="sm"
                          variant={activeProvider === "google" ? "default" : "outline"}
                          className={activeProvider === "google" ? "bg-[#5a7d58] hover:bg-[#4a6b48] text-white" : ""}
                          onClick={() => providerMutation.mutate("google")}
                          disabled={providerMutation.isPending}
                          data-testid="button-active-calendar-google"
                        >
                          Google
                        </Button>
                      )}
                      {outlookConnected && (
                        <Button
                          type="button"
                          size="sm"
                          variant={activeProvider === "outlook" ? "default" : "outline"}
                          className={activeProvider === "outlook" ? "bg-[#5a7d58] hover:bg-[#4a6b48] text-white" : ""}
                          onClick={() => providerMutation.mutate("outlook")}
                          disabled={providerMutation.isPending}
                          data-testid="button-active-calendar-outlook"
                        >
                          Outlook
                        </Button>
                      )}
                      {!activeProviderReady && (
                        <span className="text-[11px] text-amber-700 dark:text-amber-300 self-center">
                          Choose the active calendar for new service slots.
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-2 mt-4">
                <Button
                  className="flex-1 bg-[#5a7d58] hover:bg-[#4a6b48] text-white"
                  onClick={() => setModalOpen(true)}
                  data-testid="button-mediator-manage-calendar"
                >
                  {connected ? "Reconnect / change account" : "Connect calendar"}
                </Button>
                {(connected || needsReauth) && disconnectProvider && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setDisconnectOpen(true)}
                    disabled={disconnectMutation.isPending}
                    data-testid="button-mediator-disconnect-calendar"
                  >
                    <Unlink className="mr-1.5 h-4 w-4" />
                    Disconnect
                  </Button>
                )}
              </div>
            </div>
          </>
        )}
      </CardContent>
      <CalendarConnectModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        mode={connected || needsReauth ? "manage" : "prompt"}
        connectedEmail={connectedEmail}
        connectedProvider={activeProvider ?? (googleConnected ? "google" : outlookConnected ? "outlook" : null)}
        needsReauth={needsReauth}
        returnTo="settings"
      />
      <ConfirmDialog
        open={disconnectOpen}
        onOpenChange={setDisconnectOpen}
        title={`Disconnect ${connectedProviderLabel}?`}
        description="Calendar syncing will stop and unbooked availability imported from this calendar will be removed from BFM. Existing appointments will not be cancelled."
        confirmLabel={disconnectMutation.isPending ? "Disconnecting..." : "Disconnect calendar"}
        confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90"
        confirmTestId="button-confirm-mediator-calendar-disconnect"
        cancelTestId="button-cancel-mediator-calendar-disconnect"
        onConfirm={() => disconnectMutation.mutate()}
      />
    </Card>
  );
}

interface BfmCalendarStatus {
  configured: boolean;
  connected: boolean;
  googleCalendarEmail: string | null;
  lastHealthCheckAt: string | null;
  lastHealthCheckError: string | null;
  connectedAt: string | null;
  connectedByUserId: string | null;
  hasWriteScope: boolean;
  healthCheckAlertsEnabled: boolean;
}

type BookingPaymentProvider = "xero_invoice" | "direct_stripe_checkout";

type BankTransferSettings = {
  accountName: string;
  sortCode: string;
  accountNumber: string;
  iban: string;
  swift: string;
  instructions: string;
};

interface PaymentModeStatus {
  provider: BookingPaymentProvider;
  allowedProviders: BookingPaymentProvider[];
  xero: {
    connected: boolean;
    webhookEndpoint: string;
    configured: {
      xeroClientIdConfigured: boolean;
      xeroClientSecretConfigured: boolean;
      xeroWebhookKeyConfigured: boolean;
      xeroDefaultAccountCodeConfigured: boolean;
      xeroDefaultTaxTypeConfigured: boolean;
      xeroDefaultBrandingThemeIdConfigured: boolean;
    };
  };
  stripe: {
    stripeSecretKeyConfigured: boolean;
    stripeWebhookSecretConfigured: boolean;
    stripeWebhookEndpoint: string;
  };
  bankTransfer: BankTransferSettings;
}

function BookingPaymentModePanel() {
  const { toast } = useToast();
  const [pendingProvider, setPendingProvider] = useState<BookingPaymentProvider | null>(null);
  const { data: status, isLoading } = useQuery<PaymentModeStatus>({
    queryKey: ["/api/settings/payment-mode"],
  });

  const mutation = useMutation({
    mutationFn: async (provider: BookingPaymentProvider) => {
      const res = await apiRequest("PATCH", "/api/settings/payment-mode", { provider });
      return res.json();
    },
    onSuccess: (_data, provider) => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/payment-mode"] });
      toast({
        title: "Booking payment mode updated",
        description: provider === "direct_stripe_checkout"
          ? "New paid booking and mediation-session payment attempts will use direct Stripe Checkout."
          : "New payable bookings and mediation-session invoices will use Xero-owned billing.",
      });
    },
    onError: (err: Error) => {
      toast({ title: "Could not update payment mode", description: err.message, variant: "destructive" });
    },
  });

  const current = status?.provider ?? "xero_invoice";
  const stripeReady = !!status?.stripe.stripeSecretKeyConfigured;
  const stripeWebhookReady = !!status?.stripe.stripeWebhookSecretConfigured;
  const xeroReadinessItems = [
    { label: "Xero Custom Connection authorised", ok: !!status?.xero.connected },
    { label: "Client ID", ok: !!status?.xero.configured.xeroClientIdConfigured },
    { label: "Client secret", ok: !!status?.xero.configured.xeroClientSecretConfigured },
    { label: "Webhook key", ok: !!status?.xero.configured.xeroWebhookKeyConfigured },
    { label: "Default account code", ok: !!status?.xero.configured.xeroDefaultAccountCodeConfigured },
    { label: "Default tax type", ok: !!status?.xero.configured.xeroDefaultTaxTypeConfigured },
  ];
  const xeroConfigured = !!(
    status?.xero.connected &&
    status.xero.configured.xeroClientIdConfigured &&
    status.xero.configured.xeroClientSecretConfigured &&
    status.xero.configured.xeroWebhookKeyConfigured &&
    status.xero.configured.xeroDefaultAccountCodeConfigured &&
    status.xero.configured.xeroDefaultTaxTypeConfigured
  );

  function choose(provider: BookingPaymentProvider) {
    if (provider === current) return;
    if (provider === "direct_stripe_checkout" && !stripeReady) {
      toast({
        title: "Stripe secret missing",
        description: "Set STRIPE_SECRET_KEY before enabling direct Stripe Checkout.",
        variant: "destructive",
      });
      return;
    }
    setPendingProvider(provider);
  }

  function confirmPaymentModeSwitch() {
    if (!pendingProvider || mutation.isPending) return;
    const provider = pendingProvider;
    setPendingProvider(null);
    mutation.mutate(provider);
  }

  async function copyXeroWebhookEndpoint() {
    const endpoint = status?.xero.webhookEndpoint;
    if (!endpoint) return;
    await navigator.clipboard?.writeText(endpoint);
    toast({ title: "Xero webhook endpoint copied" });
  }

  const pendingProviderIsStripe = pendingProvider === "direct_stripe_checkout";
  const paymentModeDialogTitle = pendingProviderIsStripe
    ? "Switch to Direct Stripe Checkout?"
    : "Switch to Xero invoices?";
  const paymentModeDialogDescription = pendingProviderIsStripe
    ? "Direct Stripe Checkout is a fallback/testing mode. New payable bookings and mediation-session payment attempts will use CRM-owned Stripe Checkout instead of Xero-owned billing. Existing appointments and invoices keep their current payment provider."
    : "New payable bookings and mediation-session invoices will use Xero-owned billing. Existing appointments and invoices keep their current payment provider.";
  const paymentModeDialogConfirmLabel = pendingProviderIsStripe ? "Switch to Stripe" : "Switch to Xero";

  return (
    <Card className="border border-border/60" data-testid="card-booking-payment-mode">
      <CardHeader className="pb-3 border-b bg-muted/20">
        <div className="flex items-center gap-2">
          <CreditCard className="w-[18px] h-[18px] text-[#5a7d58]" />
          <CardTitle className="text-base font-heading">Booking Payment Mode</CardTitle>
        </div>
        <CardDescription className="text-xs leading-relaxed">
          Choose how new payable bookings and mediation-session invoices collect payment. Existing appointments keep their original payment provider.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-5 space-y-4">
        {isLoading ? (
          <Skeleton className="h-28 w-full" />
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-2">
              <button
                type="button"
                onClick={() => choose("xero_invoice")}
                disabled={mutation.isPending}
                className={`rounded-lg border p-4 text-left transition-colors ${current === "xero_invoice" ? "border-[#5a7d58] bg-[#a7baa4]/10" : "hover:bg-muted/40"}`}
                data-testid="button-payment-mode-xero"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold">Xero invoices</p>
                  <Badge variant={current === "xero_invoice" ? "default" : "secondary"}>{current === "xero_invoice" ? "Active" : "Available"}</Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Bank transfer is preferred. Xero invoice number is the payment reference, and card payment, if available, happens through Xero.
                  Confirmation waits until Xero reports the invoice paid.
                </p>
                <p className={`text-xs mt-2 ${xeroConfigured ? "text-[#5a7d58]" : "text-amber-700"}`}>
                  {xeroConfigured ? "Xero appears ready." : "Xero setup is incomplete or disconnected."}
                </p>
                <div className="grid grid-cols-1 gap-1.5 mt-3">
                  {xeroReadinessItems.map((item) => (
                    <div key={item.label} className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-muted-foreground">{item.label}</span>
                      <Badge variant={item.ok ? "default" : "secondary"} className={item.ok ? "bg-[#5a7d58] hover:bg-[#5a7d58]" : ""}>
                        {item.ok ? "Set" : "Missing"}
                      </Badge>
                    </div>
                  ))}
                </div>
              </button>

              <button
                type="button"
                onClick={() => choose("direct_stripe_checkout")}
                disabled={mutation.isPending || !stripeReady}
                className={`rounded-lg border p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${current === "direct_stripe_checkout" ? "border-[#5a7d58] bg-[#a7baa4]/10" : "hover:bg-muted/40"}`}
                data-testid="button-payment-mode-stripe"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold">Direct Stripe Checkout</p>
                  <Badge variant={current === "direct_stripe_checkout" ? "default" : "secondary"}>
                    {current === "direct_stripe_checkout" ? "Active" : stripeReady ? "Available" : "Missing key"}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-2">Fallback/testing mode. New payment attempts use CRM-owned direct Stripe Checkout instead of Xero-owned billing.</p>
                <p className={`text-xs mt-2 ${stripeWebhookReady ? "text-[#5a7d58]" : "text-amber-700"}`}>
                  {stripeReady
                    ? stripeWebhookReady ? "Stripe secret and webhook secret are set." : "Stripe secret is set; webhook secret is missing."
                    : "STRIPE_SECRET_KEY is required."}
                </p>
              </button>
            </div>
            <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
              <div className="space-y-1">
                <p className="font-medium text-foreground">Xero webhook endpoint</p>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <code className="break-all rounded bg-background px-2 py-1 text-[11px]">
                    {status?.xero.webhookEndpoint || "/api/public/integrations/xero/webhook"}
                  </code>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 w-fit px-2 text-xs"
                    onClick={copyXeroWebhookEndpoint}
                  >
                    Copy
                  </Button>
                </div>
              </div>
              <p>Required Xero webhook topic: <code>Invoices</code></p>
              <p>Xero runtime secrets may come from AWS Secrets Manager when <code>CONFIG_SOURCE=aws</code>.</p>
              <p>Stripe webhook endpoint: <code>{status?.stripe.stripeWebhookEndpoint || "/api/public/stripe/webhook"}</code></p>
              <p>Direct Stripe mode affects new payable booking and mediation-session payment attempts only. Hold-only bookings are unchanged.</p>
            </div>
          </>
        )}
      </CardContent>
      <ConfirmDialog
        open={!!pendingProvider}
        onOpenChange={(open) => {
          if (!open && !mutation.isPending) setPendingProvider(null);
        }}
        title={paymentModeDialogTitle}
        description={paymentModeDialogDescription}
        confirmLabel={paymentModeDialogConfirmLabel}
        onConfirm={confirmPaymentModeSwitch}
        confirmTestId="button-confirm-payment-mode-switch"
        cancelTestId="button-cancel-payment-mode-switch"
      />
    </Card>
  );
}

function BankTransferSettingsPanel() {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<BankTransferSettings>({
    queryKey: ["/api/settings/bank-transfer"],
  });
  const [form, setForm] = useState<BankTransferSettings>({
    accountName: "",
    sortCode: "",
    accountNumber: "",
    iban: "",
    swift: "",
    instructions: "Bank transfer is preferred. Please use the Xero invoice number as your payment reference.",
  });

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", "/api/settings/bank-transfer", form);
      return res.json();
    },
    onSuccess: (next: BankTransferSettings) => {
      queryClient.setQueryData(["/api/settings/bank-transfer"], next);
      queryClient.invalidateQueries({ queryKey: ["/api/settings/payment-mode"] });
      toast({ title: "Bank transfer settings updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Could not update bank details", description: err.message, variant: "destructive" });
    },
  });

  const setField = (key: keyof BankTransferSettings, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  return (
    <Card className="border border-border/60" data-testid="card-bank-transfer-settings">
      <CardHeader className="pb-3 border-b bg-muted/20">
        <div className="flex items-center gap-2">
          <CreditCard className="w-[18px] h-[18px] text-[#5a7d58]" />
          <CardTitle className="text-base font-heading">Bank Transfer Details</CardTitle>
        </div>
        <CardDescription className="text-xs leading-relaxed">
          These details appear on Xero-owned payment screens and emails. Clients must use the Xero invoice number as the payment reference.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-5 space-y-4">
        {isLoading ? (
          <Skeleton className="h-36 w-full" />
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-3">
              <Input value={form.accountName} onChange={(e) => setField("accountName", e.target.value)} placeholder="Account name" data-testid="input-bank-account-name" />
              <Input value={form.sortCode} onChange={(e) => setField("sortCode", e.target.value)} placeholder="Sort code" data-testid="input-bank-sort-code" />
              <Input value={form.accountNumber} onChange={(e) => setField("accountNumber", e.target.value)} placeholder="Account number" data-testid="input-bank-account-number" />
              <Input value={form.iban} onChange={(e) => setField("iban", e.target.value)} placeholder="IBAN optional" data-testid="input-bank-iban" />
              <Input value={form.swift} onChange={(e) => setField("swift", e.target.value)} placeholder="SWIFT/BIC optional" data-testid="input-bank-swift" />
            </div>
            <Textarea
              value={form.instructions}
              onChange={(e) => setField("instructions", e.target.value)}
              rows={3}
              placeholder="Payment instructions"
              data-testid="textarea-bank-instructions"
            />
            <Button onClick={() => mutation.mutate()} disabled={mutation.isPending} data-testid="button-save-bank-transfer">
              <Save className="w-4 h-4 mr-2" />
              Save bank details
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

const BFM_HEALTH_ERROR_LABELS: Record<string, string> = {
  not_connected: "Not connected — superadmin must complete OAuth.",
  needs_reauth: "Google rejected the saved token. Please reconnect.",
  needs_write_scope: "Calendar write access wasn't granted. Reconnect and tick all permission checkboxes.",
  rate_limited: "Google is rate-limiting requests. Will retry on the next health check.",
};

function formatBfmHealthError(code: string | null): string {
  if (!code) return "";
  return BFM_HEALTH_ERROR_LABELS[code] ?? `Last error: ${code}`;
}

function BfmCalendarPanel() {
  const { toast } = useToast();
  const { user } = useAuth();
  const isSuperadmin = user?.role === "superadmin";
  const { data: status, isLoading } = useQuery<BfmCalendarStatus>({
    queryKey: ["/api/calendar/bfm/status"],
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("bfmCalendarConnected") === "true") {
      toast({ title: "BFM calendar connected", description: "info@ Google calendar is now linked. Bookings will send invites from this address." });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/bfm/status"] });
      params.delete("bfmCalendarConnected");
      window.history.replaceState({}, "", `${window.location.pathname}${params.toString() ? `?${params}` : ""}`);
    }
    const err = params.get("bfmCalendarError");
    if (err) {
      const errorMessages: Record<string, string> = {
        access_denied: "OAuth was denied. Please try again and click Allow.",
        missing_params: "Google's response was incomplete. Please retry.",
        invalid_state: "Security check failed. Please retry the connection.",
        missing_write_scope: "Calendar write access wasn't granted. Tick all permission checkboxes during OAuth.",
        wrong_account: "Connection rejected — only the info@brighterfuturemediation.co.uk Google account can be connected here. Sign out of any other Google account and retry.",
        exchange_failed: "Could not exchange the OAuth code with Google. Please retry.",
        disconnect_existing_provider: "Disconnect your current calendar before connecting another calendar provider.",
      };
      toast({
        title: "BFM calendar connection failed",
        description: errorMessages[err] ?? `OAuth error: ${err}`,
        variant: "destructive",
      });
      params.delete("bfmCalendarError");
      window.history.replaceState({}, "", `${window.location.pathname}${params.toString() ? `?${params}` : ""}`);
    }
  }, [toast]);

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", "/api/calendar/bfm/disconnect");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/bfm/status"] });
      toast({ title: "BFM calendar disconnected", description: "Bookings will be hard-blocked until reconnected." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to disconnect", variant: "destructive" });
    },
  });

  const alertsToggleMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const res = await apiRequest("PATCH", "/api/calendar/bfm/health-check-alerts", { enabled });
      return res.json();
    },
    onMutate: async (enabled: boolean) => {
      await queryClient.cancelQueries({ queryKey: ["/api/calendar/bfm/status"] });
      const previous = queryClient.getQueryData<BfmCalendarStatus>(["/api/calendar/bfm/status"]);
      if (previous) {
        queryClient.setQueryData<BfmCalendarStatus>(["/api/calendar/bfm/status"], {
          ...previous,
          healthCheckAlertsEnabled: enabled,
        });
      }
      return { previous };
    },
    onSuccess: (_data, enabled) => {
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/bfm/status"] });
      toast({
        title: enabled ? "Daily alerts enabled" : "Daily alerts paused",
        description: enabled
          ? "BFM will email info@ and notify admins if the daily check fails."
          : "BFM will stop the daily failure email and admin notifications. Bookings are unaffected.",
      });
    },
    onError: (_err, _enabled, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["/api/calendar/bfm/status"], context.previous);
      }
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/bfm/status"] });
      toast({ title: "Error", description: "Failed to update the alerts setting", variant: "destructive" });
    },
  });

  const healthCheckMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/calendar/bfm/health-check");
      return res.json() as Promise<{ ok: boolean; error?: string; needsReauth?: boolean }>;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/bfm/status"] });
      if (result.ok) {
        toast({ title: "Health check passed", description: "info@ calendar is reachable." });
      } else {
        toast({
          title: "Health check failed",
          description: formatBfmHealthError(result.error ?? null),
          variant: "destructive",
        });
      }
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to run health check", variant: "destructive" });
    },
  });

  const connected = !!status?.connected;
  const lastChecked = status?.lastHealthCheckAt ? new Date(status.lastHealthCheckAt) : null;
  const hasError = !!status?.lastHealthCheckError;
  // Task #191 — distinct "needs reauth" state: row still has tokens / was once
  // connected, but Google rejected the latest refresh (invalid_grant). Distinct
  // from a never-connected row.
  const needsReauth = !connected && status?.lastHealthCheckError === "needs_reauth";
  const [docsOpen, setDocsOpen] = useState(false);

  return (
    <Card className="border border-border/60" data-testid="card-bfm-calendar">
      <CardHeader className="pb-3 border-b bg-muted/20">
        <div className="flex items-center gap-2">
          <Calendar className="w-[18px] h-[18px] text-[#5a7d58]" />
          <CardTitle className="text-base font-heading">BFM Organisation Calendar</CardTitle>
        </div>
        <CardDescription className="text-xs leading-relaxed">
          Connect <strong>info@brighterfuturemediation.co.uk</strong>'s Google Calendar so booking invites are sent to clients from <em>info@</em> rather than from the assigned mediator's personal mailbox. <strong>Bookings are hard-blocked while this is disconnected.</strong>
        </CardDescription>
      </CardHeader>
      <CardContent className="p-5 space-y-5">
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="border rounded-xl p-4 bg-card">
                <div className="flex items-start gap-3 mb-3">
                  <div className="w-10 h-10 rounded-lg bg-[#a7baa4]/20 flex items-center justify-center shrink-0">
                    <Calendar className="w-5 h-5 text-[#5a7d58]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-sm text-foreground">Google Calendar</p>
                      {connected ? (
                        <Badge variant="default" className="bg-[#5a7d58] hover:bg-[#5a7d58] text-white" data-testid="badge-bfm-connected">
                          <CheckCircle2 className="w-3 h-3 mr-1" /> Connected
                        </Badge>
                      ) : needsReauth ? (
                        <Badge
                          variant="outline"
                          className="border-amber-400 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100 dark:border-amber-700"
                          data-testid="badge-bfm-needs-reauth"
                        >
                          <AlertTriangle className="w-3 h-3 mr-1" /> Reauthentication required
                        </Badge>
                      ) : (
                        <Badge variant="destructive" data-testid="badge-bfm-disconnected">
                          <AlertCircle className="w-3 h-3 mr-1" /> Disconnected
                        </Badge>
                      )}
                    </div>
                    {connected && status?.googleCalendarEmail && (
                      <p className="text-xs text-muted-foreground mt-1 truncate" data-testid="text-bfm-email">
                        {status.googleCalendarEmail}
                      </p>
                    )}
                    {lastChecked && (
                      <p className="text-[11px] text-muted-foreground mt-1" data-testid="text-bfm-last-check">
                        Last checked: {lastChecked.toLocaleString()}
                      </p>
                    )}
                    {hasError && (
                      <p className="text-[11px] text-destructive mt-1" data-testid="text-bfm-error">
                        {formatBfmHealthError(status?.lastHealthCheckError ?? null)}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
                      Client bookings and internal staff tasks use the primary Google calendar for this connected account. Internal task events do not invite staff as Google attendees.
                    </p>
                  </div>
                </div>
                {isSuperadmin && <div className="flex flex-wrap gap-2 mt-4">
                  <a href="/api/auth/google/bfm" className="flex-1">
                    <Button
                      className="w-full bg-[#5a7d58] hover:bg-[#4a6b48] text-white"
                      variant="default"
                      data-testid="link-bfm-connect"
                    >
                      {connected ? "Reconnect" : "Connect Google Calendar"}
                    </Button>
                  </a>
                  {connected && (
                    <>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => healthCheckMutation.mutate()}
                        disabled={healthCheckMutation.isPending}
                        title="Run health check now"
                        data-testid="button-bfm-health-check"
                      >
                        <RefreshCw className={`w-4 h-4 ${healthCheckMutation.isPending ? "animate-spin" : ""}`} />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => {
                          if (confirm("Disconnect the BFM organisation calendar? Bookings will be hard-blocked until reconnected.")) {
                            disconnectMutation.mutate();
                          }
                        }}
                        disabled={disconnectMutation.isPending}
                        title="Disconnect"
                        data-testid="button-bfm-disconnect"
                      >
                        <Unlink className="w-4 h-4" />
                      </Button>
                    </>
                  )}
                </div>}
              </div>

              {isSuperadmin && (
              <div
                className="flex flex-col h-full border rounded-xl p-4 bg-card"
                data-testid="card-bfm-health-alerts"
              >
                <div className="flex items-start gap-3 mb-3">
                  <div className="w-10 h-10 rounded-lg bg-[#dcae96]/20 flex items-center justify-center shrink-0">
                    <AlertCircle className="w-5 h-5 text-[#b8825a]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-sm text-foreground">Daily health-check alerts</p>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                      When off, BFM won't email <em>info@</em> or post admin notifications about calendar health. The booking gate is unaffected, and you can still run a manual check above.
                    </p>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3 mt-auto pt-2 border-t">
                  <span className="text-xs font-medium text-foreground">
                    {status?.healthCheckAlertsEnabled ? "Enabled" : "Paused"}
                  </span>
                  <Switch
                    checked={!!status?.healthCheckAlertsEnabled}
                    disabled={!isSuperadmin || alertsToggleMutation.isPending}
                    onCheckedChange={(checked) => alertsToggleMutation.mutate(checked)}
                    data-testid="switch-bfm-health-alerts"
                    aria-label="Toggle daily BFM calendar health-check alerts"
                  />
                </div>
              </div>
              )}
            </div>

            {/* Task #191 — collapsible "Why does this disconnect?" docs. Pure
                reference, no behaviour change. The Google Cloud Console flip
                (Testing → In production / Internal) is the single biggest
                cause of repeated disconnects and must be done manually. */}
            <div className="rounded-lg border bg-muted/20" data-testid="panel-bfm-docs">
              <button
                type="button"
                onClick={() => setDocsOpen(o => !o)}
                className="w-full flex items-center justify-between gap-3 p-4 text-left hover-elevate"
                data-testid="button-toggle-bfm-docs"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <AlertTriangle className="w-4 h-4 text-[#b8825a] shrink-0" />
                  <span className="text-sm font-medium text-foreground">Why does this disconnect?</span>
                </div>
                <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${docsOpen ? "rotate-180" : ""}`} />
              </button>
              {docsOpen && (
                <div className="px-4 pb-4 pt-0 text-xs leading-relaxed text-muted-foreground space-y-3 border-t" data-testid="panel-bfm-docs-content">
                  <p>
                    Google's OAuth tokens last forever <em>only</em> when the OAuth Consent Screen is set to <strong>"In production"</strong> (or User type <strong>Internal</strong> for a Workspace org). While the screen is in <strong>"Testing"</strong> mode, Google forcibly expires every refresh token after <strong>7 days</strong> — no matter how cleanly we ask for offline access. This is the single biggest cause of repeated disconnects for both BFM and mediator calendars.
                  </p>
                  <p className="font-medium text-foreground">To fix it permanently, a Google Cloud Console admin must:</p>
                  <ol className="list-decimal list-inside space-y-1 ml-1">
                    <li>Open the OAuth consent screen for the Google Cloud project that issued our Client ID.</li>
                    <li>If the user type is <strong>External</strong>, click <strong>Publish App</strong> to switch from Testing to In production.</li>
                    <li>If the project belongs to a Google Workspace org, set User Type to <strong>Internal</strong> instead — this is the simplest setup.</li>
                    <li>Reconnect the calendar once on the button above so a fresh long-lived refresh token is saved.</li>
                  </ol>
                  <p>
                    <a
                      href="https://console.cloud.google.com/apis/credentials/consent"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[#5a7d58] hover:underline"
                      data-testid="link-google-console"
                    >
                      Open Google Cloud OAuth consent screen <ExternalLink className="w-3 h-3" />
                    </a>
                  </p>
                  <p className="font-medium text-foreground pt-2">Other documented causes (less common):</p>
                  <ul className="list-disc list-inside space-y-1 ml-1">
                    <li>The Google account holder revoked our access from <em>myaccount.google.com → Security → Third-party access</em>.</li>
                    <li>The refresh token wasn't used for 6+ months (Google auto-expires inactive tokens).</li>
                    <li>The same user re-authorised more than 50 times — Google quietly invalidates the oldest refresh tokens.</li>
                    <li>A Google Workspace admin policy ended the grant (session control, security review, etc.).</li>
                    <li>The Google account password was changed, which sometimes invalidates existing OAuth grants.</li>
                  </ul>
                  <p className="pt-1">
                    BFM also runs an automatic refresh probe every 15 minutes (throttled to once per ~6 hours per account) so any expired token is detected and surfaced here within minutes — instead of only being noticed when someone tries to book.
                  </p>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div
                className="flex flex-col h-full border border-dashed rounded-xl p-4 bg-muted/30 cursor-not-allowed select-none"
                aria-disabled="true"
                data-testid="card-bfm-outlook"
              >
                <div className="flex items-start gap-3 mb-3">
                  <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
                    <Calendar className="w-5 h-5 text-muted-foreground/70" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-sm text-muted-foreground">Microsoft Outlook</p>
                      <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-muted-foreground/10 text-muted-foreground border border-muted-foreground/20">
                        Coming soon
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground/80 mt-1 leading-relaxed">
                      Outlook / Office 365 calendar sync for the BFM organisation mailbox will be available shortly.
                    </p>
                  </div>
                </div>
                <Button
                  className="w-full mt-auto"
                  variant="outline"
                  disabled
                  data-testid="button-bfm-outlook"
                >
                  Coming soon
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

const ROLE_HEADER_COLORS: Record<string, string> = {
  subadmin: "bg-[#dcae96]/10 border-b-2 border-[#dcae96]/40",
  staff: "bg-sky-50 dark:bg-sky-950/20 border-b-2 border-sky-200 dark:border-sky-800",
  mediator: "bg-[#a7baa4]/10 border-b-2 border-[#a7baa4]/40",
  contractor: "bg-violet-50 dark:bg-violet-950/20 border-b-2 border-violet-200 dark:border-violet-800",
};

export default function SettingsPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [localPerms, setLocalPerms] = useState<PermissionEntry[]>([]);
  const canSeeBfmCalendar = user?.role === "superadmin" || user?.role === "subadmin";
  const canManagePaymentMode = user?.role === "superadmin";
  const isSuperadmin = user?.role === "superadmin";
  const isMediator = user?.role === "mediator";

  const { data: permissions, isLoading } = useQuery<PermissionEntry[]>({
    queryKey: ["/api/permissions"],
    enabled: isSuperadmin,
  });

  useEffect(() => {
    if (permissions) {
      setLocalPerms([...permissions]);
    }
  }, [permissions]);

  const saveMutation = useMutation({
    mutationFn: async (perms: PermissionEntry[]) => {
      const res = await apiRequest("PUT", "/api/permissions", { permissions: perms });
      return res.json();
    },
    onSuccess: (updated: PermissionEntry[]) => {
      queryClient.setQueryData(["/api/permissions"], updated);
      toast({ title: "Permissions saved" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save permissions", variant: "destructive" });
    },
  });

  function togglePerm(role: string, section: string, field: "canView" | "canEdit") {
    setLocalPerms(prev => {
      const updated = prev.map(p => {
        if (p.role === role && p.section === section) {
          const newVal = !p[field];
          if (field === "canEdit" && newVal && !p.canView) {
            return { ...p, canView: true, canEdit: true };
          }
          if (field === "canView" && !newVal && p.canEdit) {
            return { ...p, canView: false, canEdit: false };
          }
          return { ...p, [field]: newVal };
        }
        return p;
      });
      return updated;
    });
  }

  function getPermValue(role: string, section: string, field: "canView" | "canEdit"): boolean {
    const entry = localPerms.find(p => p.role === role && p.section === section);
    return entry?.[field] ?? false;
  }

  const changedPermissions = useMemo(() => {
    if (!permissions) return [];
    const original = new Map(permissions.map((entry) => [`${entry.role}:${entry.section}`, entry]));
    return localPerms.filter((entry) => {
      if (!CONFIGURABLE_ROLES.includes(entry.role as (typeof CONFIGURABLE_ROLES)[number])) return false;
      if (!ACCESS_AREAS.some((area) => area.section === entry.section)) return false;
      const previous = original.get(`${entry.role}:${entry.section}`);
      return !previous || previous.canView !== entry.canView || previous.canEdit !== entry.canEdit;
    });
  }, [localPerms, permissions]);
  const hasChanges = changedPermissions.length > 0;

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto" data-testid="settings-page">
      <div className="flex items-center">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
            <Settings className="w-5 h-5 text-gray-600 dark:text-gray-300" />
          </div>
          <div>
            <h1 className="text-2xl font-heading font-semibold text-foreground" data-testid="text-settings-title">Settings</h1>
            <p className="text-muted-foreground text-sm mt-0.5">Manage platform and calendar settings for your role</p>
          </div>
        </div>
      </div>

      {canManagePaymentMode && <BookingPaymentModePanel />}
      {canManagePaymentMode && <BankTransferSettingsPanel />}
      {canSeeBfmCalendar && <BfmCalendarPanel />}
      {isMediator && <MediatorCalendarPanel />}

      {isSuperadmin && <Card className="border border-border/60" data-testid="card-role-permissions">
        <CardHeader className="pb-2 border-b bg-muted/20">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-[18px] h-[18px] text-[#5a7d58]" />
                <CardTitle className="text-base font-heading">Internal Role Access</CardTitle>
              </div>
              <CardDescription className="text-xs">
                Configure business-area access for internal roles. Superadmin and fixed Client access are not shown in this matrix.
              </CardDescription>
            </div>
            <Button
              className="w-full sm:w-auto sm:shrink-0"
              onClick={() => saveMutation.mutate(changedPermissions)}
              disabled={!hasChanges || saveMutation.isPending}
              data-testid="button-save-permissions"
            >
              <Save className="w-4 h-4 mr-2" />
              {saveMutation.isPending ? "Saving..." : "Save permissions"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="text-left p-3 font-medium text-muted-foreground min-w-[160px] bg-muted/30 sticky left-0 z-10 border-r border-border/40">
                      Section
                    </th>
                    {CONFIGURABLE_ROLES.map(role => (
                      <th
                        key={role}
                        className={`text-center p-3 font-semibold text-foreground min-w-[140px] ${ROLE_HEADER_COLORS[role] || ""}`}
                        colSpan={2}
                      >
                        {ROLE_LABELS[role]}
                      </th>
                    ))}
                  </tr>
                  <tr className="border-b bg-muted/10">
                    <th className="sticky left-0 z-10 bg-muted/10 border-r border-border/40"></th>
                    {CONFIGURABLE_ROLES.map(role => (
                      <th key={role} className="text-center p-1.5" colSpan={2}>
                        <div className="flex items-center justify-center gap-6">
                          <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium w-10">View</span>
                          <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium w-10">Edit</span>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ACCESS_AREAS.map((area, idx) => (
                    <tr
                      key={area.section}
                      className={`border-b transition-colors hover:bg-muted/25 ${idx % 2 === 0 ? "bg-transparent" : "bg-muted/8"}`}
                    >
                      <td className={`p-3 font-medium sticky left-0 z-10 border-r border-border/40 ${idx % 2 === 0 ? "bg-background" : "bg-muted/8"}`}>
                        <div>{area.label}</div>
                        <div className="mt-0.5 text-xs font-normal text-muted-foreground">{area.description}</div>
                      </td>
                      {CONFIGURABLE_ROLES.map(role => (
                        <td key={`${role}-${area.section}`} className="text-center p-2.5" colSpan={2}>
                          <div className="flex items-center justify-center gap-6">
                            <div className="flex flex-col items-center gap-0.5 w-10">
                              <Switch
                                checked={getPermValue(role, area.section, "canView")}
                                onCheckedChange={() => togglePerm(role, area.section, "canView")}
                                className="scale-[0.8]"
                                data-testid={`switch-view-${role}-${area.section}`}
                              />
                            </div>
                            <div className="flex flex-col items-center gap-0.5 w-10">
                              {area.supportsEdit ? (
                                <Switch
                                  checked={getPermValue(role, area.section, "canEdit")}
                                  onCheckedChange={() => togglePerm(role, area.section, "canEdit")}
                                  className="scale-[0.8]"
                                  data-testid={`switch-edit-${role}-${area.section}`}
                                />
                              ) : (
                                <span className="text-[10px] font-medium text-muted-foreground" data-testid={`edit-na-${role}-${area.section}`}>N/A</span>
                              )}
                            </div>
                          </div>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>}

      {isSuperadmin && (
        <Card className="border border-border/60" data-testid="card-client-portal-access">
          <CardHeader className="border-b bg-muted/20">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-[18px] w-[18px] text-[#5a7d58]" />
              <CardTitle className="text-base font-heading">Client Portal Access</CardTitle>
            </div>
            <CardDescription className="text-xs">
              Fixed client access—not configurable. Documents are available inside each mediation case rather than as a standalone menu.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 p-5 sm:grid-cols-2">
            {CLIENT_PORTAL_ACCESS.map((item) => (
              <div key={item.label} className="rounded-lg border bg-card p-3">
                <p className="text-sm font-medium">{item.label}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{item.description}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
