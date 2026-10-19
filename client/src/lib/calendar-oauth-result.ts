export type CalendarOAuthResult = {
  connected: boolean;
  provider: "google" | "outlook";
  error: string | null;
  warning: string | null;
};

export type CalendarOAuthResultMessage = {
  title: string;
  description: string;
  variant?: "destructive";
};

const RESULT_PARAMS = ["calendarConnected", "calendarProvider", "calendarError", "calendarWarning"] as const;

export function parseCalendarOAuthResult(search: string): CalendarOAuthResult | null {
  const params = new URLSearchParams(search);
  const connected = params.get("calendarConnected") === "true";
  const error = params.get("calendarError");
  const warning = params.get("calendarWarning");
  if (!connected && !error && !warning) return null;
  return {
    connected,
    provider: params.get("calendarProvider") === "outlook" ? "outlook" : "google",
    error,
    warning,
  };
}

export function calendarOAuthResultMessage(result: CalendarOAuthResult): CalendarOAuthResultMessage {
  const providerName = result.provider === "outlook" ? "Microsoft Outlook" : "Google Calendar";
  if (result.connected && result.warning === "initial_sync_delayed") {
    return {
      title: `${providerName} connected`,
      description: "Your calendar is connected. The first sync is taking longer than expected, and BFM will retry automatically.",
    };
  }
  if (result.connected) {
    return {
      title: `${providerName} connected`,
      description: "Your availability and bookings will now sync.",
    };
  }

  const messages: Record<string, CalendarOAuthResultMessage> = {
    not_configured: {
      title: `${providerName} is unavailable`,
      description: `${providerName} is not available right now. Please contact BFM support.`,
      variant: "destructive",
    },
    session_expired: {
      title: "Please sign in again",
      description: "Your session expired. Please sign in and try connecting your calendar again.",
      variant: "destructive",
    },
    mediator_only: {
      title: "Calendar connection unavailable",
      description: "Only mediator accounts can connect a personal calendar.",
      variant: "destructive",
    },
    disconnect_existing_provider: {
      title: "Disconnect your current calendar first",
      description: "Disconnect your current calendar before connecting another calendar provider.",
      variant: "destructive",
    },
    access_denied: {
      title: "Calendar connection cancelled",
      description: "Calendar access was cancelled. Your calendar was not connected.",
      variant: "destructive",
    },
    missing_params: {
      title: `${providerName} connection failed`,
      description: "The calendar provider did not return all required information. Please try again.",
      variant: "destructive",
    },
    invalid_state: {
      title: `${providerName} connection expired`,
      description: "The connection request expired or was opened in another tab. Please try again.",
      variant: "destructive",
    },
    missing_write_scope: {
      title: `${providerName} needs permission`,
      description: "BFM needs permission to manage calendar events. Try again and allow calendar access.",
      variant: "destructive",
    },
    start_failed: {
      title: `${providerName} connection failed`,
      description: `BFM could not start the ${providerName} connection. Please try again. If the problem continues, contact BFM support.`,
      variant: "destructive",
    },
    exchange_failed: {
      title: `${providerName} connection failed`,
      description: `BFM could not connect to ${providerName}. Please try again. If the problem continues, contact BFM support.`,
      variant: "destructive",
    },
  };
  return messages[result.error ?? ""] ?? {
    title: `${providerName} connection failed`,
    description: `BFM could not connect to ${providerName}. Please try again. If the problem continues, contact BFM support.`,
    variant: "destructive",
  };
}

export function stripCalendarOAuthResultParams(pathAndSearch: string): string {
  const url = new URL(pathAndSearch, "https://bfm.invalid");
  for (const key of RESULT_PARAMS) url.searchParams.delete(key);
  const query = url.searchParams.toString();
  return `${url.pathname}${query ? `?${query}` : ""}${url.hash}`;
}
