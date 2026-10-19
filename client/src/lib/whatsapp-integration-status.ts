export type WhatsAppSettingsStatus = {
  verifyTokenConfigured: boolean;
  appSecretConfigured: boolean;
  accessTokenConfigured: boolean;
  phoneNumberIdConfigured: boolean;
  businessAccountIdConfigured: boolean;
  defaultTemplate: string | null;
};

export type WhatsAppConnectionState = "loading" | "unavailable" | "configured" | "incomplete";

export function getWhatsAppConnectionState(
  status: WhatsAppSettingsStatus | undefined,
  isPending: boolean,
  isError: boolean,
): WhatsAppConnectionState {
  if (isPending) return "loading";
  if (isError || !status) return "unavailable";

  return status.verifyTokenConfigured
    && status.appSecretConfigured
    && status.accessTokenConfigured
    && status.phoneNumberIdConfigured
    && status.businessAccountIdConfigured
    ? "configured"
    : "incomplete";
}
