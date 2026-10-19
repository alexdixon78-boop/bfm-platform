import { useState, useMemo, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, ChevronRight, Video, Clock, User, Briefcase, FileText, ExternalLink } from "lucide-react";
import { appointmentWallClockDate, type BookingTimeBasis } from "@shared/booking-time";
import { getLondonInstantDateTimeParts } from "@/lib/date-time";

export const APPT_STATUS_STYLES: Record<string, { bg: string; text: string; border: string; label: string; dotColor: string }> = {
  hold: { bg: "bg-amber-50", text: "text-amber-900", border: "border-l-amber-500", label: "Payment hold", dotColor: "bg-amber-500" },
  held: { bg: "bg-amber-50", text: "text-amber-900", border: "border-l-amber-500", label: "Payment hold", dotColor: "bg-amber-500" },
  confirmed: { bg: "bg-[#e8f0e7]", text: "text-[#3d5a3a]", border: "border-l-[#5a7d58]", label: "Confirmed", dotColor: "bg-[#5a7d58]" },
  cancelled: { bg: "bg-gray-50", text: "text-gray-500", border: "border-l-gray-300", label: "Cancelled", dotColor: "bg-gray-400" },
  completed: { bg: "bg-blue-50", text: "text-blue-900", border: "border-l-blue-500", label: "Completed", dotColor: "bg-blue-500" },
  expired: { bg: "bg-red-50", text: "text-red-700", border: "border-l-red-400", label: "Expired", dotColor: "bg-red-400" },
};

export type AppointmentData = {
  id: string;
  caseId: string;
  partyId: string | null;
  serviceTypeId: string | null;
  mediatorId: string | null;
  dateTime: string;
  dateTimeBasis?: BookingTimeBasis;
  duration: number;
  status: string;
  holdExpiresAt: string | null;
  holdAlertSentAt?: string | null;
  bookingToken: string | null;
  paymentStatus?: string | null;
  paymentStatusUpdatedAt?: string | null;
  paymentStatusUpdatedBy?: string | null;
  paymentNotes?: string | null;
  paymentFailureReason?: string | null;
  notes: string | null;
  meetingLink?: string | null;
  hasMeetingLink?: boolean;
  canJoin?: boolean;
  createdAt: string;
  partyName?: string | null;
  mediatorName?: string | null;
  serviceName?: string | null;
  caseReference?: string | null;
  xeroInvoice?: {
    id: string;
    invoiceId: string;
    invoiceNumber: string | null;
    invoiceUrl: string | null;
    status: string;
    sentAt: string | null;
    paidAt: string | null;
    lastSyncedAt: string | null;
    lastError: string | null;
    amountPence: number;
    currency: string;
  } | null;
  calendarSync?: {
    status: "pending" | "processing" | "succeeded" | "failed" | "skipped";
    attemptCount: number;
    lastAttemptAt: string | null;
    failureStage: "mediator_calendar" | "bfm_client_calendar" | null;
    lastErrorCode: string | null;
    lastErrorMessage: string | null;
  } | null;
  parentEventOriginalStart?: string | null;
  parentEventOriginalEnd?: string | null;
  parentEventOriginalTitle?: string | null;
};

export type PersonalEventData = {
  id: string;
  title: string | null;
  startAt: string;
  endAt: string;
  sourceKind?: "service_schedule" | "calendar_cache";
  serviceTypeId?: string | null;
  serviceTypeName?: string | null;
  isAllDay?: boolean;
  bfmAttendanceStatus?: string | null;
  isOrganiser?: boolean;
  attendees?: Array<{ email: string; displayName?: string; responseStatus: string }> | null;
  syncedAt?: string | null;
  mediatorId?: string | null;
  mediatorName?: string | null;
  mediatorEmail?: string | null;
  mediatorAvailabilityColor?: string | null;
  bfmCalendarEmail?: string | null;
  calendarProvider?: "google" | "outlook" | null;
};

function hslToHex(h: number, s: number, l: number): string {
  const sn = s / 100;
  const ln = l / 100;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r1 = 0, g1 = 0, b1 = 0;
  if (hp >= 0 && hp < 1) [r1, g1, b1] = [c, x, 0];
  else if (hp < 2) [r1, g1, b1] = [x, c, 0];
  else if (hp < 3) [r1, g1, b1] = [0, c, x];
  else if (hp < 4) [r1, g1, b1] = [0, x, c];
  else if (hp < 5) [r1, g1, b1] = [x, 0, c];
  else [r1, g1, b1] = [c, 0, x];
  const m = ln - c / 2;
  const r = Math.round((r1 + m) * 255);
  const g = Math.round((g1 + m) * 255);
  const b = Math.round((b1 + m) * 255);
  const toHex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function hashStringToInt(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) >>> 0;
  }
  return h;
}

export function autoColorFromMediatorId(mediatorId: string | null | undefined): string {
  if (!mediatorId) return "#5a7d58";
  const hue = hashStringToInt(mediatorId) % 360;
  return hslToHex(hue, 45, 42);
}

export function resolveMediatorColor(
  mediatorId: string | null | undefined,
  manualColor: string | null | undefined
): string {
  if (manualColor && /^#[0-9a-fA-F]{6}$/.test(manualColor)) return manualColor.toLowerCase();
  return autoColorFromMediatorId(mediatorId);
}

function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return `rgba(90, 125, 88, ${alpha})`;
  const v = m[1];
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function formatTimeRange(startAt: string, endAt: string): string {
  const fmt = (iso: string) => getLondonInstantDateTimeParts(new Date(iso)).time;
  return `${fmt(startAt)}–${fmt(endAt)}`;
}

export function getWeekDates(date: Date): Date[] {
  const d = new Date(date);
  const day = d.getUTCDay();
  const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), diff));
  const days: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const dd = new Date(monday);
    dd.setUTCDate(monday.getUTCDate() + i);
    days.push(dd);
  }
  return days;
}

export function formatDateKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

const HOUR_HEIGHT = 64;
const START_HOUR = 0;
const END_HOUR = 23;
const DEFAULT_SCROLL_HOUR = 7;
export const CALENDAR_HOURS = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => i + START_HOUR);

type PositionedAppointment = AppointmentData & {
  topPx: number;
  heightPx: number;
  columnIndex: number;
  totalColumns: number;
};

function computePositions(dayAppts: AppointmentData[]): PositionedAppointment[] {
  if (dayAppts.length === 0) return [];

  const items = dayAppts.map(appt => {
    const dt = appointmentWallClockDate(appt.dateTime, appt.dateTimeBasis ?? "wall_clock_utc");
    const startMinutes = dt.getUTCHours() * 60 + dt.getUTCMinutes();
    const endMinutes = startMinutes + (appt.duration || 60);
    const topPx = ((startMinutes - START_HOUR * 60) / 60) * HOUR_HEIGHT;
    const heightPx = Math.max((appt.duration / 60) * HOUR_HEIGHT, 28);
    return { ...appt, startMinutes, endMinutes, topPx, heightPx, columnIndex: 0, totalColumns: 1 };
  });

  items.sort((a, b) => a.startMinutes - b.startMinutes || a.endMinutes - b.endMinutes);

  const groups: (typeof items)[] = [];
  let currentGroup: typeof items = [];

  for (const item of items) {
    if (currentGroup.length === 0) {
      currentGroup.push(item);
    } else {
      const groupEnd = Math.max(...currentGroup.map(g => g.endMinutes));
      if (item.startMinutes < groupEnd) {
        currentGroup.push(item);
      } else {
        groups.push(currentGroup);
        currentGroup = [item];
      }
    }
  }
  if (currentGroup.length > 0) groups.push(currentGroup);

  for (const group of groups) {
    const columns: number[] = [];
    for (const item of group) {
      let col = 0;
      while (columns[col] !== undefined && columns[col] > item.startMinutes) {
        col++;
      }
      item.columnIndex = col;
      columns[col] = item.endMinutes;
    }
    const totalCols = columns.length;
    for (const item of group) {
      item.totalColumns = totalCols;
    }
  }

  return items;
}

function AppointmentPopover({ appt, isClient }: { appt: AppointmentData; isClient: boolean }) {
  const dt = appointmentWallClockDate(appt.dateTime, appt.dateTimeBasis ?? "wall_clock_utc");
  const endDt = new Date(dt.getTime() + (appt.duration || 60) * 60000);
  const style = APPT_STATUS_STYLES[appt.status] || APPT_STATUS_STYLES.hold;

  return (
    <div className="bg-white dark:bg-gray-900 border rounded-lg shadow-lg p-3 min-w-[240px] max-w-[300px] z-50 space-y-2" data-testid="popover-appointment">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-foreground truncate">{appt.serviceName || "Appointment"}</span>
        <Badge className={`${style.bg} ${style.text} border-none text-[10px] shrink-0`}>{style.label}</Badge>
      </div>

      <div className="space-y-1.5 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <Clock className="w-3 h-3 shrink-0" />
          <span>
            {dt.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })},{" "}
            {dt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" })}
            {" – "}
            {endDt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" })}
            {" "}({appt.duration} min)
          </span>
        </div>
        {appt.partyName && (
          <div className="flex items-center gap-1.5">
            <User className="w-3 h-3 shrink-0" />
            <span>{appt.partyName}</span>
          </div>
        )}
        {!isClient && appt.mediatorName && (
          <div className="flex items-center gap-1.5">
            <Briefcase className="w-3 h-3 shrink-0" />
            <span>{appt.mediatorName}</span>
          </div>
        )}
        {!isClient && appt.caseReference && (
          <div className="flex items-center gap-1.5">
            <FileText className="w-3 h-3 shrink-0" />
            <span className="font-mono">{appt.caseReference}</span>
          </div>
        )}
        {!isClient && appt.meetingLink && (
          <div className="flex items-center gap-1.5">
            <Video className="w-3 h-3 shrink-0 text-blue-600" />
            <a
              href={appt.meetingLink}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline truncate"
              onClick={(e) => e.stopPropagation()}
            >
              Meeting link
              <ExternalLink className="w-2.5 h-2.5 inline ml-0.5" />
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

function AppointmentBlock({
  appt,
  onAppointmentClick,
  isClient,
}: {
  appt: PositionedAppointment;
  onAppointmentClick?: (appt: AppointmentData) => void;
  isClient: boolean;
}) {
  const [showPopover, setShowPopover] = useState(false);
  const [popoverPosition, setPopoverPosition] = useState<{ top: number; left: number } | null>(null);
  const blockRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const style = APPT_STATUS_STYLES[appt.status] || APPT_STATUS_STYLES.hold;
  const isCancelledOrExpired = appt.status === "cancelled" || appt.status === "expired";
  const isClickable = !isCancelledOrExpired && !!onAppointmentClick;
  const dt = appointmentWallClockDate(appt.dateTime, appt.dateTimeBasis ?? "wall_clock_utc");
  const endDt = new Date(dt.getTime() + (appt.duration || 60) * 60000);
  const isCompact = appt.heightPx < 48;

  const handleMouseEnter = () => {
    timerRef.current = setTimeout(() => {
      if (blockRef.current) {
        const rect = blockRef.current.getBoundingClientRect();
        const viewportW = window.innerWidth;
        const left = rect.right + 8 + 300 > viewportW ? rect.left - 308 : rect.right + 8;
        setPopoverPosition({ top: rect.top, left });
        setShowPopover(true);
      }
    }, 300);
  };

  const handleMouseLeave = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setShowPopover(false);
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const widthPercent = 100 / appt.totalColumns;
  const leftPercent = appt.columnIndex * widthPercent;

  return (
    <>
      <div
        ref={blockRef}
        className={`absolute rounded-r-md border-l-[3px] px-1.5 py-1 overflow-hidden transition-all
          ${style.bg} ${style.border}
          ${isCancelledOrExpired ? "opacity-50" : ""}
          ${isClickable ? "cursor-pointer hover:shadow-md hover:brightness-95" : "cursor-default"}
        `}
        style={{
          top: `${appt.topPx}px`,
          height: `${appt.heightPx}px`,
          left: `calc(${leftPercent}% + 1px)`,
          width: `calc(${widthPercent}% - 3px)`,
          zIndex: showPopover ? 20 : 10,
        }}
        onClick={() => {
          if (isClickable) onAppointmentClick!(appt);
        }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        data-testid={`cal-appt-${appt.id}`}
      >
        {isCompact ? (
          <div className="flex items-center gap-1 h-full">
            <span className={`w-1.5 h-1.5 rounded-full ${style.dotColor} shrink-0`} />
            <span className={`text-[11px] font-semibold ${style.text} truncate ${isCancelledOrExpired ? "line-through" : ""}`}>
              {dt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" })}
            </span>
            <span className={`text-[11px] ${style.text} truncate ${isCancelledOrExpired ? "line-through" : ""}`}>{appt.serviceName || "Appt"}</span>
            {(appt.meetingLink || appt.hasMeetingLink) && <Video className="w-3 h-3 text-blue-600 shrink-0" />}
          </div>
        ) : (
          <div className="flex flex-col gap-0.5 h-full">
            <div className="flex items-center justify-between gap-1">
              <span className={`text-[11px] font-semibold ${style.text} truncate`}>
                {dt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" })}
                {" – "}
                {endDt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" })}
              </span>
              <div className="flex items-center gap-0.5 shrink-0">
                {(appt.meetingLink || appt.hasMeetingLink) && <Video className="w-3 h-3 text-blue-600" />}
              </div>
            </div>
            <div className={`text-xs font-medium ${style.text} truncate leading-tight ${isCancelledOrExpired ? "line-through" : ""}`}>
              {appt.serviceName || "Appointment"}
            </div>
            {appt.partyName && (
              <div className="text-[11px] text-muted-foreground truncate leading-tight flex items-center gap-1">
                <User className="w-2.5 h-2.5 shrink-0" />
                {appt.partyName}
              </div>
            )}
            {!isClient && appt.mediatorName && appt.heightPx >= 72 && (
              <div className="text-[11px] text-muted-foreground truncate leading-tight flex items-center gap-1">
                <Briefcase className="w-2.5 h-2.5 shrink-0" />
                {appt.mediatorName}
              </div>
            )}
            {!isClient && appt.caseReference && appt.heightPx >= 88 && (
              <div className="text-[10px] text-muted-foreground/70 font-mono truncate leading-tight">
                {appt.caseReference}
              </div>
            )}
          </div>
        )}
      </div>

      {showPopover && popoverPosition && (
        <div
          className="fixed z-[100]"
          style={{ top: popoverPosition.top, left: popoverPosition.left }}
          onMouseEnter={() => { if (timerRef.current) clearTimeout(timerRef.current); }}
          onMouseLeave={handleMouseLeave}
        >
          <AppointmentPopover appt={appt} isClient={isClient} />
        </div>
      )}
    </>
  );
}

function StatusLegend() {
  const statuses = ["hold", "confirmed", "completed", "cancelled", "expired"];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1" data-testid="calendar-status-legend">
      {statuses.map(s => {
        const style = APPT_STATUS_STYLES[s];
        return (
          <div key={s} className="flex items-center gap-1.5">
            <span className={`w-2.5 h-2.5 rounded-full ${style.dotColor}`} />
            <span className="text-[11px] text-muted-foreground">{style.label}</span>
          </div>
        );
      })}
    </div>
  );
}

type PersonalEventVariant = "available" | "booking-spawned" | "busy";

type PositionedPersonalEvent = {
  id: string;
  title: string | null;
  topPx: number;
  heightPx: number;
  variant: PersonalEventVariant;
  startAt: string;
  endAt: string;
  mediatorName: string | null;
  resolvedColor: string;
  source: PersonalEventData;
};

function classifyPersonalEvent(ev: PersonalEventData): PersonalEventVariant {
  if (ev.sourceKind === "service_schedule") {
    return "available";
  }
  const title = (ev.title || "").trim();
  if (title.startsWith("BFM Booking —") || title.startsWith("BFM Booking -")) {
    return "booking-spawned";
  }
  // Match the backend bookability rule in availability-windows.ts:
  // only events where BFM is the organiser or has accepted are bookable.
  // "tentative" must NOT be labelled as available.
  const status = (ev.bfmAttendanceStatus ?? "").toLowerCase();
  if (status === "organiser" || status === "accepted" || ev.isOrganiser) {
    return "available";
  }
  return "busy";
}

function computePersonalPositions(events: PersonalEventData[]): Record<string, PositionedPersonalEvent[]> {
  const byDay: Record<string, PositionedPersonalEvent[]> = {};
  for (const ev of events) {
    if (ev.isAllDay) continue;
    const startDt = new Date(ev.startAt);
    const endDt = new Date(ev.endAt);
    const start = getLondonInstantDateTimeParts(new Date(ev.startAt));
    const [hour, minute] = start.time.split(":").map(Number);
    const key = start.date;
    const startMinutes = hour * 60 + minute;
    const durationMin = Math.max(15, (endDt.getTime() - startDt.getTime()) / 60000);
    const topPx = ((startMinutes - START_HOUR * 60) / 60) * HOUR_HEIGHT;
    const heightPx = Math.max((durationMin / 60) * HOUR_HEIGHT, 24);
    if (topPx + heightPx < 0 || topPx > (END_HOUR - START_HOUR + 1) * HOUR_HEIGHT) continue;
    if (!byDay[key]) byDay[key] = [];
    byDay[key].push({
      id: ev.id,
      title: ev.title,
      topPx,
      heightPx,
      variant: classifyPersonalEvent(ev),
      startAt: ev.startAt,
      endAt: ev.endAt,
      mediatorName: ev.mediatorName ?? null,
      resolvedColor: resolveMediatorColor(ev.mediatorId, ev.mediatorAvailabilityColor),
      source: ev,
    });
  }
  return byDay;
}

function PersonalEventBlock({
  ev,
  onClick,
}: {
  ev: PositionedPersonalEvent;
  onClick?: (ev: PersonalEventData) => void;
}) {
  if (ev.variant === "booking-spawned") {
    // BFM Booking events are surfaced as the actual appointment block elsewhere.
    // Skip rendering them as a personal-event overlay to avoid double-display.
    return null;
  }

  const isAvailable = ev.variant === "available";
  const isClickable = isAvailable && !!onClick;
  const containerClass = isAvailable
    ? `absolute left-0 right-0 mx-0.5 rounded-sm border-2 border-dashed px-1.5 py-0.5 overflow-hidden ${isClickable ? "cursor-pointer hover-elevate active-elevate-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1" : "cursor-default"}`
    : "absolute left-0 right-0 mx-0.5 rounded-sm border border-dashed border-gray-400/60 bg-gray-200/60 dark:bg-gray-700/40 px-1.5 py-0.5 overflow-hidden cursor-default";

  const containerStyle: React.CSSProperties = {
    top: `${ev.topPx}px`,
    height: `${ev.heightPx}px`,
    zIndex: 5,
  };
  if (isAvailable) {
    containerStyle.borderColor = ev.resolvedColor;
    containerStyle.backgroundColor = hexToRgba(ev.resolvedColor, 0.13);
  } else {
    containerStyle.backgroundImage =
      "repeating-linear-gradient(45deg, transparent, transparent 4px, rgba(0,0,0,0.04) 4px, rgba(0,0,0,0.04) 8px)";
  }

  const timeRange = formatTimeRange(ev.startAt, ev.endAt);
  const mediatorLabel = ev.mediatorName || "Available";
  const labelText = isAvailable ? mediatorLabel : ev.source.calendarProvider === "outlook" ? "Outlook" : "Google";
  const dotClass = isAvailable
    ? "inline-block w-1.5 h-1.5 rounded-full shrink-0"
    : "inline-block w-1 h-1 rounded-full bg-gray-500 shrink-0";
  const dotStyle: React.CSSProperties | undefined = isAvailable ? { backgroundColor: ev.resolvedColor } : undefined;
  const titleAttr = isAvailable
    ? `Available — bookable · ${ev.mediatorName ?? "Mediator"} · ${timeRange}${ev.title ? ` (${ev.title})` : ""}`
    : ev.title || "Personal event";

  const handleClick = () => {
    if (isClickable) onClick(ev.source);
  };
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!isClickable) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onClick(ev.source);
    }
  };

  return (
    <div
      className={containerClass}
      style={containerStyle}
      title={titleAttr}
      data-testid={`cal-personal-${ev.id}`}
      role={isClickable ? "button" : undefined}
      tabIndex={isClickable ? 0 : undefined}
      aria-label={isClickable ? `Available slot ${ev.mediatorName ? `for ${ev.mediatorName} ` : ""}${timeRange}` : undefined}
      onClick={isClickable ? handleClick : undefined}
      onKeyDown={isClickable ? handleKeyDown : undefined}
    >
      <div
        className={`flex items-center gap-1 text-[10px] truncate leading-tight ${
          isAvailable ? "" : "text-gray-700 dark:text-gray-200"
        }`}
        style={isAvailable ? { color: ev.resolvedColor } : undefined}
      >
        <span className={dotClass} style={dotStyle} />
        <span className="font-medium uppercase tracking-wide text-[9px] shrink-0">{labelText}</span>
      </div>
      {isAvailable && (
        <div className="text-[10px] leading-tight font-medium" style={{ color: ev.resolvedColor }}>
          {timeRange}
        </div>
      )}
      {!isAvailable && <span className="truncate text-[10px] text-gray-700 dark:text-gray-200">{ev.title || "Personal event"}</span>}
    </div>
  );
}

export function WeeklyCalendar({
  appointments,
  personalEvents = [],
  currentDate,
  onDateChange,
  onAppointmentClick,
  onPersonalEventClick,
  isClient,
}: {
  appointments: AppointmentData[];
  personalEvents?: PersonalEventData[];
  currentDate: Date;
  onDateChange: (d: Date) => void;
  onAppointmentClick?: (appt: AppointmentData) => void;
  onPersonalEventClick?: (ev: PersonalEventData) => void;
  isClient: boolean;
}) {
  const weekDays = getWeekDates(currentDate);
  const todayKey = formatDateKey(new Date());

  const positionedByDay = useMemo(() => {
    const map: Record<string, PositionedAppointment[]> = {};
    const byDay: Record<string, AppointmentData[]> = {};

    for (const appt of appointments) {
      const dt = appointmentWallClockDate(appt.dateTime, appt.dateTimeBasis ?? "wall_clock_utc");
      const key = formatDateKey(dt);
      if (!byDay[key]) byDay[key] = [];
      byDay[key].push(appt);
    }

    for (const key of Object.keys(byDay)) {
      map[key] = computePositions(byDay[key]);
    }
    return map;
  }, [appointments]);

  const personalByDay = useMemo(() => computePersonalPositions(personalEvents), [personalEvents]);

  const goToday = () => onDateChange(new Date());
  const goPrev = () => {
    const d = new Date(currentDate);
    d.setDate(d.getDate() - 7);
    onDateChange(d);
  };
  const goNext = () => {
    const d = new Date(currentDate);
    d.setDate(d.getDate() + 7);
    onDateChange(d);
  };

  const weekStart = weekDays[0];
  const weekEnd = weekDays[6];
  const monthYear =
    weekStart.getUTCMonth() === weekEnd.getUTCMonth()
      ? weekStart.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })
      : `${weekStart.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" })} – ${weekEnd.toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" })}`;

  const totalHeight = CALENDAR_HOURS.length * HOUR_HEIGHT;

  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = (DEFAULT_SCROLL_HOUR - START_HOUR) * HOUR_HEIGHT;
    }
  }, []);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={goPrev} data-testid="button-prev-week">
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={goToday} data-testid="button-today">
            Today
          </Button>
          <Button variant="outline" size="sm" onClick={goNext} data-testid="button-next-week">
            <ChevronRight className="w-4 h-4" />
          </Button>
          <h3 className="text-sm font-heading font-semibold text-foreground ml-2" data-testid="text-week-label">{monthYear}</h3>
        </div>
        <StatusLegend />
        <span className="text-[11px] text-muted-foreground" data-testid="text-calendar-timezone">
          Times shown in UK time (Europe/London)
        </span>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <div className="grid grid-cols-[56px_repeat(7,1fr)] bg-muted/50 border-b">
          <div className="p-2 text-xs font-medium text-muted-foreground border-r" />
          {weekDays.map((day) => {
            const key = formatDateKey(day);
            const isToday = key === todayKey;
            const dayApptCount = (positionedByDay[key] || []).length;
            return (
              <div key={key} className={`p-2 text-center border-r last:border-r-0 ${isToday ? "bg-[#5a7d58]/10" : ""}`}>
                <div className="text-[11px] text-muted-foreground uppercase tracking-wide">
                  {day.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" })}
                </div>
                <div className={`text-base font-bold ${isToday ? "text-[#5a7d58]" : "text-foreground"}`}>
                  {day.getUTCDate()}
                </div>
                {dayApptCount > 0 && (
                  <div className="text-[10px] text-muted-foreground">{dayApptCount} appt{dayApptCount !== 1 ? "s" : ""}</div>
                )}
              </div>
            );
          })}
        </div>

        <div ref={scrollRef} className="max-h-[640px] overflow-y-auto">
          <div className="grid grid-cols-[56px_repeat(7,1fr)]" style={{ height: `${totalHeight}px` }}>
            <div className="relative border-r bg-muted/20">
              {CALENDAR_HOURS.map((hour, idx) => (
                <div
                  key={hour}
                  className="absolute w-full text-[11px] text-muted-foreground text-right pr-2 leading-none"
                  style={{ top: `${idx * HOUR_HEIGHT}px`, height: `${HOUR_HEIGHT}px`, paddingTop: "2px" }}
                >
                  {String(hour).padStart(2, "0")}:00
                </div>
              ))}
            </div>

            {weekDays.map((day) => {
              const dayKey = formatDateKey(day);
              const isToday = dayKey === todayKey;
              const dayAppts = positionedByDay[dayKey] || [];

              return (
                <div key={dayKey} className={`relative border-r last:border-r-0 ${isToday ? "bg-[#5a7d58]/[0.03]" : ""}`}>
                  {CALENDAR_HOURS.map((_, idx) => (
                    <div
                      key={idx}
                      className="absolute w-full border-t border-gray-100 dark:border-gray-800"
                      style={{ top: `${idx * HOUR_HEIGHT}px`, height: `${HOUR_HEIGHT}px` }}
                    />
                  ))}

                  {(personalByDay[dayKey] || []).map((ev) => (
                    <PersonalEventBlock key={ev.id} ev={ev} onClick={onPersonalEventClick} />
                  ))}

                  {dayAppts.map((appt) => (
                    <AppointmentBlock
                      key={appt.id}
                      appt={appt}
                      onAppointmentClick={onAppointmentClick}
                      isClient={isClient}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
