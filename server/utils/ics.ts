import { UK_TIME_ZONE } from "./uk-wall-clock";

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

function formatIcsDate(date: Date): string {
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

function formatIcsLondonDate(date: Date): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: UK_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${parts.year}${parts.month}${parts.day}T${parts.hour}${parts.minute}${parts.second}`;
}

function escapeIcs(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

export function generateIcsContent(options: {
  summary: string;
  description: string;
  startTime: Date;
  durationMinutes: number;
  organizer?: string;
  attendee?: string;
  uid?: string;
  status?: "CONFIRMED" | "TENTATIVE" | "CANCELLED";
}): string {
  const { summary, description, startTime, durationMinutes, organizer, attendee, uid, status = "CONFIRMED" } = options;
  const endTime = new Date(startTime.getTime() + durationMinutes * 60000);
  const now = new Date();
  const eventUid = uid || `${now.getTime()}-${Math.random().toString(36).slice(2)}@brighterfuturemediation.co.uk`;

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Brighter Future Mediation//CRM//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VTIMEZONE",
    `TZID:${UK_TIME_ZONE}`,
    `X-LIC-LOCATION:${UK_TIME_ZONE}`,
    "BEGIN:DAYLIGHT",
    "TZOFFSETFROM:+0000",
    "TZOFFSETTO:+0100",
    "TZNAME:BST",
    "DTSTART:19700329T010000",
    "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
    "END:DAYLIGHT",
    "BEGIN:STANDARD",
    "TZOFFSETFROM:+0100",
    "TZOFFSETTO:+0000",
    "TZNAME:GMT",
    "DTSTART:19701025T020000",
    "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
    "END:STANDARD",
    "END:VTIMEZONE",
    "BEGIN:VEVENT",
    `UID:${eventUid}`,
    `DTSTAMP:${formatIcsDate(now)}`,
    `DTSTART;TZID=${UK_TIME_ZONE}:${formatIcsLondonDate(startTime)}`,
    `DTEND;TZID=${UK_TIME_ZONE}:${formatIcsLondonDate(endTime)}`,
    `SUMMARY:${escapeIcs(summary)}`,
    `DESCRIPTION:${escapeIcs(description)}`,
  ];

  if (organizer) {
    lines.push(`ORGANIZER;CN=Brighter Future Mediation:mailto:${organizer}`);
  }
  if (attendee) {
    lines.push(`ATTENDEE:mailto:${attendee}`);
  }

  lines.push(`STATUS:${status}`, "END:VEVENT", "END:VCALENDAR");
  return lines.join("\r\n");
}
