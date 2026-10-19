import React from "react";
import { Copy, MessageCircle, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getWhatsAppConnectionState,
  type WhatsAppConnectionState,
  type WhatsAppSettingsStatus,
} from "@/lib/whatsapp-integration-status";

type WhatsAppIntegrationCardProps = {
  webhookEndpointUrl: string;
  status: WhatsAppSettingsStatus | undefined;
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  onRetry: () => void;
  onCopy: () => void;
};

const connectionLabels: Record<WhatsAppConnectionState, string> = {
  loading: "Loading",
  unavailable: "Status unavailable",
  configured: "Configured",
  incomplete: "Incomplete",
};

export function WhatsAppIntegrationCard({
  webhookEndpointUrl,
  status,
  isPending,
  isError,
  isFetching,
  onRetry,
  onCopy,
}: WhatsAppIntegrationCardProps) {
  const connectionState = getWhatsAppConnectionState(status, isPending, isError);
  const settings = [
    { key: "verify-token", label: "Verify token", configured: status?.verifyTokenConfigured },
    { key: "app-secret", label: "App secret", configured: status?.appSecretConfigured },
    { key: "access-token", label: "Access token", configured: status?.accessTokenConfigured },
    { key: "phone-number-id", label: "Phone number ID", configured: status?.phoneNumberIdConfigured },
    { key: "business-account-id", label: "Business account ID", configured: status?.businessAccountIdConfigured },
  ];

  return (
    <Card data-testid="whatsapp-integration-card">
      <CardHeader>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <MessageCircle className="w-5 h-5" />
              WhatsApp / Meta Cloud API
            </CardTitle>
            <CardDescription>
              Receive WhatsApp webhooks and send messages through the environment-managed Meta Cloud API integration.
            </CardDescription>
          </div>
          <Badge
            variant={connectionState === "configured" ? "default" : "secondary"}
            data-testid="whatsapp-overall-status"
          >
            {connectionLabels[connectionState]}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 md:grid-cols-[1fr_auto]">
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">Webhook endpoint</p>
            <code
              className="block rounded-md border bg-muted px-3 py-2 text-sm break-all"
              data-testid="whatsapp-webhook-url"
            >
              {webhookEndpointUrl}
            </code>
          </div>
          <Button
            variant="outline"
            className="self-end"
            onClick={onCopy}
            data-testid="button-copy-whatsapp-webhook"
          >
            <Copy className="w-4 h-4 mr-2" />
            Copy
          </Button>
        </div>

        {connectionState === "loading" && (
          <p className="text-sm text-muted-foreground">Checking WhatsApp configuration…</p>
        )}

        {connectionState === "unavailable" && (
          <div className="flex flex-col gap-3 rounded-md border border-red-200 bg-red-50 p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-red-700">Could not load the WhatsApp configuration status.</p>
            <Button
              variant="outline"
              size="sm"
              onClick={onRetry}
              disabled={isFetching}
              data-testid="button-retry-whatsapp-status"
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
              Retry
            </Button>
          </div>
        )}

        {(connectionState === "configured" || connectionState === "incomplete") && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {settings.map((setting) => (
                <div
                  key={setting.key}
                  className="flex items-center justify-between gap-3 rounded-md border p-3"
                  data-testid={`whatsapp-setting-${setting.key}`}
                >
                  <span className="text-sm font-medium">{setting.label}</span>
                  <Badge variant={setting.configured ? "default" : "secondary"}>
                    {setting.configured ? "Configured" : "Missing"}
                  </Badge>
                </div>
              ))}
            </div>

            <div className="rounded-md border p-4">
              <p className="text-xs font-medium text-muted-foreground">Default template</p>
              <p className="mt-1 text-sm font-medium">{status?.defaultTemplate || "Not configured"}</p>
            </div>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          WhatsApp credentials are managed through environment secrets and are never displayed in the CRM.
        </p>
      </CardContent>
    </Card>
  );
}
