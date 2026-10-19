import { apiRequest } from "@/lib/queryClient";

type JoinWindow = {
  opener?: unknown;
  location: {
    href: string;
    replace?: (url: string) => void;
  };
  close: () => void;
};

type AppointmentJoinOptions = {
  open?: (url?: string | URL, target?: string, features?: string) => JoinWindow | null;
  request?: typeof apiRequest;
};

export type AppointmentJoinResult = {
  meetingLink: string;
  opened: boolean;
};

export async function openAuditedAppointmentJoin(
  appointmentId: string,
  options: AppointmentJoinOptions = {},
): Promise<AppointmentJoinResult> {
  const openFn = options.open ?? window.open.bind(window);
  const request = options.request ?? apiRequest;
  const joinWindow = openFn("about:blank", "_blank");

  if (joinWindow) {
    try {
      joinWindow.opener = null;
    } catch {
      // Some browser handles expose opener as read-only; keeping the join working is more important.
    }
  }

  try {
    const res = await request("POST", `/api/appointments/${appointmentId}/join`, {});
    const data = await res.json() as { meetingLink?: string | null };
    const meetingLink = data.meetingLink?.trim();
    if (!meetingLink) throw new Error("Join response did not include a meeting link");

    if (joinWindow) {
      if (joinWindow.location.replace) {
        joinWindow.location.replace(meetingLink);
      } else {
        joinWindow.location.href = meetingLink;
      }
    }
    return { meetingLink, opened: Boolean(joinWindow) };
  } catch (err) {
    joinWindow?.close();
    throw err;
  }
}
