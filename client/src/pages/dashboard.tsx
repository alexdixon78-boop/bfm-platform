import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest, queryClient, refreshClientDashboardActions } from "@/lib/queryClient";
import { AppointmentJoinFallbackDialog } from "@/components/appointments/appointment-join-fallback-dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuditedAppointmentJoin } from "@/hooks/use-audited-appointment-join";
import { useCalendarOAuthResult } from "@/hooks/use-calendar-oauth-result";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  MessageSquare,
  Briefcase,
  Calendar,
  Clock,
  PoundSterling,
  UserPlus,
  AlertCircle,
  Shield,
  Video,
  MapPin,
  Phone,
  CheckCircle2,
  ListChecks,
  CircleDot,
  CalendarClock,
  CalendarDays,
  ArrowRight,
  MoreHorizontal,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  FileText,
  ClipboardList,
  CreditCard,
  PenLine,
} from "lucide-react";
import { Link } from "wouter";
import { CalendarConnectModal } from "@/components/calendar/calendar-connect-modal";
import { ServiceApprovalDrawer, type ServiceApprovalSheetRow } from "@/components/mediator/service-approval-drawer";
import type { ServiceScheduleSlotRow } from "@/components/mediator-service-schedule-modal";

type DashboardStats = {
  newEnquiries: number;
  outstandingEnquiries: number;
  activeCases: number;
  miamsThisWeek: number;
  sessionsThisWeek: number;
  overduePayments: number;
  awaitingClientAction: number;
  awaitingBfmAction: number;
};

type Appointment = {
  id: string;
  kind: "appointment" | "service_event";
  time: string;
  clientNames: string;
  type: string;
  mediator: string;
  location: string;
  status: string;
};

type Notification = {
  id: string;
  recipientId: string | null;
  recipientRole: string;
  type: string;
  urgency: string;
  caseId: string | null;
  appointmentId: string | null;
  title: string;
  message: string;
  status: string;
  caseNoteRequired: boolean;
  assignedTo: string | null;
  assignedUserIds?: string[];
  followUpDate: string | null;
  createdAt: string;
  actionHref?: string;
  actionLabel?: string;
};

type TaskPagePayload = {
  items: Notification[];
  total: number;
  page: number;
  pageSize: number;
};

type StaffUser = {
  id: string;
  name: string;
  role: string;
};

type ServiceApprovalSummary = {
  id: string;
  serviceTypeId: string;
  status: string;
  effectiveStatus?: string;
  proofFileName?: string | null;
  proofFileUrl?: string | null;
  proofLink?: string | null;
  proofMimeType?: string | null;
  expiryDate?: string | null;
  submittedAt?: string | null;
  requestedAt?: string | null;
  requestedBy?: string | null;
  reviewedAt?: string | null;
  reviewedBy?: string | null;
  reviewReason?: string | null;
  reminderSentAt?: string | null;
  expiredAt?: string | null;
  calendarStartAt?: string | null;
  calendarEndAt?: string | null;
  calendarTitle?: string | null;
  calendarGoogleEventId?: string | null;
  serviceType?: {
    id: string;
    name: string;
    category: string;
  } | null;
};

type MediatorSessionIndicator = {
  sessionId: string;
  caseId: string;
  sessionNumber: number;
  caseRef: string;
  appointmentAt: string | null;
  indicator: {
    color: "red" | "amber" | "green";
    label: string;
    reason: string;
  };
};

type ClientDashboardAppointment = {
  id: string;
  dateTime: string;
  dateTimeBasis: "instant" | "wall_clock_utc";
  duration: number;
  sessionType: string;
  mediatorName: string;
  hasMeetingLink: boolean;
  canJoin: boolean;
  status: string;
  paymentStatus: string | null;
};

type ClientDashboardAction = {
  id: string;
  kind: "demographic" | "payment" | "signed_form" | "document" | "task";
  title: string;
  message: string;
  urgency: string;
  href: string;
  source: "derived" | "task";
  invoiceId?: string;
  invoiceNumber?: string;
  subtotalPence?: number;
  voucherDiscountPence?: number;
  totalPence?: number;
  outstandingPence?: number;
  currency?: string;
  paymentLinkUrl?: string | null;
  isMediationSessionInvoice?: boolean;
};

type ClientDashboardNotice = {
  id: string;
  type: string;
  title: string;
  message: string;
  urgency: string;
  appointmentId: string | null;
  createdAt: string;
};

type ClientDashboardCase = {
  caseId: string;
  caseRef: string;
  stage: string;
  status: string;
  issueType: string | null;
  mediatorName: string;
  nextConfirmedAppointment: ClientDashboardAppointment | null;
  pendingAppointment: ClientDashboardAppointment | null;
  tasks: ClientDashboardAction[];
  notifications: ClientDashboardNotice[];
};

type ClientDashboardPayload = {
  cases: ClientDashboardCase[];
};

type ClientInvoicePaymentStatus = {
  invoiceId: string;
  reconciliationAction: string;
  paymentStatus: string;
};

type ClientPendingActionsCase = ClientDashboardCase & { tasks: ClientDashboardAction[] };

const statCards = [
  { key: "newEnquiries" as const, label: "New enquiries today", icon: MessageSquare, color: "text-[#5a7d58] dark:text-[#a7baa4]", bg: "bg-[#a7baa4]/15 dark:bg-[#5a7d58]/20", href: "/enquiries" },
  { key: "outstandingEnquiries" as const, label: "Outstanding enquiries", icon: AlertCircle, color: "text-[#b8825a] dark:text-[#dcae96]", bg: "bg-[#dcae96]/15 dark:bg-[#b8825a]/20", href: "/enquiries?followUpFilter=unclaimed" },
  { key: "activeCases" as const, label: "Active cases", icon: Briefcase, color: "text-gray-600 dark:text-gray-300", bg: "bg-gray-100 dark:bg-gray-800", href: "/cases" },
  { key: "miamsThisWeek" as const, label: "MIAMs this week", icon: Calendar, color: "text-[#b8825a] dark:text-[#dcae96]", bg: "bg-[#dcae96]/15 dark:bg-[#b8825a]/20", href: "/appointments" },
  { key: "sessionsThisWeek" as const, label: "Mediation sessions this week", icon: Clock, color: "text-[#5a7d58] dark:text-[#a7baa4]", bg: "bg-[#a7baa4]/15 dark:bg-[#5a7d58]/20", href: "/appointments" },
  { key: "overduePayments" as const, label: "Overdue payments", icon: PoundSterling, color: "text-[#b8825a] dark:text-[#dcae96]", bg: "bg-[#dcae96]/15 dark:bg-[#b8825a]/20", href: "/finance" },
  { key: "awaitingClientAction" as const, label: "Awaiting client action", icon: UserPlus, color: "text-gray-600 dark:text-gray-300", bg: "bg-gray-100 dark:bg-gray-800", href: "/cases" },
  { key: "awaitingBfmAction" as const, label: "Awaiting BFM action", icon: AlertCircle, color: "text-[#b8825a] dark:text-[#dcae96]", bg: "bg-[#dcae96]/15 dark:bg-[#b8825a]/20", href: "/tasks?view=list" },
];

const APPROVAL_PROMPT_DISMISSED_KEY = "bfm:mediatorApprovalPromptDismissed";
const AVAILABILITY_PROMPT_DISMISSED_KEY = "bfm:mediatorAvailabilityPromptDismissed";
const CLIENT_PENDING_ACTIONS_DISMISSED_KEY = "bfm:clientPendingActionsDismissed";
const MEDIATOR_PENDING_TASKS_DISMISSED_KEY = "bfm:mediatorPendingTasksDismissed";
const STAFF_PENDING_TASKS_DISMISSED_KEY = "bfm:staffPendingTasksDismissed";
const MEDIATOR_PENDING_TASKS_PAGE_SIZE = 25;
const PENDING_TASKS_PAGE_SIZE = MEDIATOR_PENDING_TASKS_PAGE_SIZE;

function getServiceApprovalStatus(approval: ServiceApprovalSummary): string {
  return (approval.effectiveStatus ?? approval.status ?? "not_requested").toLowerCase();
}

function serviceName(approval: ServiceApprovalSummary): string {
  return approval.serviceType?.name ?? "Selected service";
}

function serviceCategory(approval: ServiceApprovalSummary): string {
  return approval.serviceType?.category ?? "Service";
}

function getTypeIcon(type: string) {
  if (type.includes("Video") || type.includes("Remote")) return Video;
  if (type.includes("Phone") || type.includes("Telephone")) return Phone;
  return MapPin;
}

function getStatusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "Confirmed": return "default";
    case "Pending": return "secondary";
    case "Cancelled": return "destructive";
    default: return "outline";
  }
}

function getActionIcon(kind: ClientDashboardAction["kind"]) {
  if (kind === "demographic") return ClipboardList;
  if (kind === "payment") return CreditCard;
  if (kind === "signed_form") return PenLine;
  if (kind === "document") return FileText;
  return ListChecks;
}

function formatClientAppointment(appt: ClientDashboardAppointment): { date: string; time: string } {
  const date = new Date(appt.dateTime);
  if (Number.isNaN(date.getTime())) return { date: "Date to be confirmed", time: "" };
  return {
    date: date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: appt.dateTimeBasis === "instant" ? "Europe/London" : "UTC" }),
    time: date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: appt.dateTimeBasis === "instant" ? "Europe/London" : "UTC" }),
  };
}

function formatDashboardPence(amountPence?: number, currency = "gbp") {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: currency.toUpperCase() }).format((amountPence || 0) / 100);
}

function getPendingActionSignature(cases: ClientPendingActionsCase[]): string {
  return cases
    .flatMap((caseItem) => caseItem.tasks.map((action) => `${caseItem.caseId}:${action.id}`))
    .sort()
    .join("|");
}

function getTaskSignature(tasks: Notification[]): string {
  return tasks.map((task) => task.id).sort().join("|");
}

function clearDashboardPaymentReturnParams() {
  const params = new URLSearchParams(window.location.search);
  params.delete("payment");
  params.delete("invoiceId");
  params.delete("session_id");
  const nextQuery = params.toString();
  window.history.replaceState({}, "", `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}`);
}

function ActionButton({ action, onOpen }: { action: ClientDashboardAction; onOpen?: () => void }) {
  const isExternal = /^https?:\/\//i.test(action.href);
  const content = (
    <>
      <ExternalLink className="w-3.5 h-3.5" />
      Open
    </>
  );

  if (isExternal) {
    return (
      <Button asChild size="sm" variant="outline" className="h-8 gap-1.5 shrink-0" data-testid={`button-client-action-${action.id}`}>
        <a href={action.href} target="_blank" rel="noreferrer" onClick={onOpen}>{content}</a>
      </Button>
    );
  }

  return (
    <Link href={action.href}>
      <Button size="sm" variant="outline" className="h-8 gap-1.5 shrink-0" onClick={onOpen} data-testid={`button-client-action-${action.id}`}>
        {content}
      </Button>
    </Link>
  );
}

function ClientPendingActionsModal({
  open,
  cases,
  onDismiss,
}: {
  open: boolean;
  cases: ClientPendingActionsCase[];
  onDismiss: () => void;
}) {
  const actionCount = cases.reduce((total, caseItem) => total + caseItem.tasks.length, 0);

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onDismiss(); }}>
      <DialogContent className="sm:max-w-2xl" data-testid="dialog-client-pending-actions">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 rounded-lg bg-[#a7baa4]/15 flex items-center justify-center shrink-0">
              <ListChecks className="w-5 h-5 text-[#5a7d58]" />
            </div>
            <DialogTitle className="font-heading text-lg">Your pending actions</DialogTitle>
          </div>
          <DialogDescription className="text-sm text-muted-foreground leading-relaxed">
            You have {actionCount} pending {actionCount === 1 ? "item" : "items"} to complete across your mediation {cases.length === 1 ? "case" : "cases"}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 max-h-[60vh] overflow-y-auto py-1">
          {cases.map((caseItem) => (
            <section key={caseItem.caseId} className="space-y-2" data-testid={`client-pending-case-${caseItem.caseId}`}>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <p className="text-sm font-semibold font-mono text-foreground">{caseItem.caseRef}</p>
                <Badge variant={caseItem.status === "Active" ? "default" : "secondary"}>{caseItem.status}</Badge>
              </div>
              <div className="space-y-2">
                {caseItem.tasks.map((action) => {
                  const Icon = getActionIcon(action.kind);
                  const style = urgencyStyles[action.urgency] || urgencyStyles.green;
                  return (
                    <div key={action.id} className={`flex items-start gap-3 rounded-md border ${style.border} ${style.bg} p-3`} data-testid={`client-pending-action-${action.id}`}>
                      <div className={`w-3 h-3 rounded-full ${style.dot} mt-2 flex-shrink-0`} />
                      <div className="w-8 h-8 rounded-lg bg-background flex items-center justify-center shrink-0">
                        <Icon className="w-4 h-4 text-[#5a7d58]" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className={`text-sm font-medium ${style.text}`}>{action.title}</p>
                        <p className="text-xs text-muted-foreground mt-1">{action.message}</p>
                      </div>
                      <ActionButton action={action} onOpen={onDismiss} />
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onDismiss} data-testid="button-client-pending-actions-later">
            Remind me later
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MediatorPendingTasksModal({
  open,
  tasks,
  total,
  onDismiss,
}: {
  open: boolean;
  tasks: Notification[];
  total: number;
  onDismiss: () => void;
}) {
  const hiddenCount = Math.max(0, total - tasks.length);

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onDismiss(); }}>
      <DialogContent className="sm:max-w-2xl" data-testid="dialog-mediator-pending-tasks">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 rounded-lg bg-[#a7baa4]/15 flex items-center justify-center shrink-0">
              <ListChecks className="w-5 h-5 text-[#5a7d58]" />
            </div>
            <DialogTitle className="font-heading text-lg">Your pending tasks</DialogTitle>
          </div>
          <DialogDescription className="text-sm text-muted-foreground leading-relaxed">
            You have {total} open {total === 1 ? "task" : "tasks"} waiting for your attention.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 max-h-[60vh] overflow-y-auto py-1">
          {tasks.map((task) => {
            const style = urgencyStyles[task.urgency] || urgencyStyles.green;
            const href = task.actionHref || "/tasks";
            return (
              <div key={task.id} className={`flex items-start gap-3 rounded-md border ${style.border} ${style.bg} p-3`} data-testid={`mediator-pending-task-${task.id}`}>
                <div className={`w-3 h-3 rounded-full ${style.dot} mt-2 flex-shrink-0`} />
                <div className="w-8 h-8 rounded-lg bg-background flex items-center justify-center shrink-0">
                  <ListChecks className="w-4 h-4 text-[#5a7d58]" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className={`text-sm font-medium ${style.text}`}>{task.title}</p>
                    <span className="text-xs text-muted-foreground">{formatTimeAgo(task.createdAt)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{task.message}</p>
                  {task.followUpDate && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Follow-up: {new Date(task.followUpDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                    </p>
                  )}
                </div>
                <Link href={href}>
                  <Button size="sm" variant="outline" className="h-8 gap-1.5 shrink-0" onClick={onDismiss} data-testid={`button-mediator-pending-task-${task.id}`}>
                    <ExternalLink className="w-3.5 h-3.5" />
                    {task.actionLabel || "Open"}
                  </Button>
                </Link>
              </div>
            );
          })}
          {hiddenCount > 0 && (
            <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
              {hiddenCount} more {hiddenCount === 1 ? "task is" : "tasks are"} available on the full Tasks page.
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Link href="/tasks">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={onDismiss} data-testid="button-mediator-pending-tasks-open-all">
              <ListChecks className="w-3.5 h-3.5" />
              Open tasks
            </Button>
          </Link>
          <Button variant="ghost" size="sm" onClick={onDismiss} data-testid="button-mediator-pending-tasks-later">
            Remind me later
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StaffPendingTasksModal({
  open,
  tasks,
  total,
  onDismiss,
}: {
  open: boolean;
  tasks: Notification[];
  total: number;
  onDismiss: () => void;
}) {
  const hiddenCount = Math.max(0, total - tasks.length);

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onDismiss(); }}>
      <DialogContent className="sm:max-w-2xl" data-testid="dialog-staff-pending-tasks">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 rounded-lg bg-[#a7baa4]/15 flex items-center justify-center shrink-0">
              <ListChecks className="w-5 h-5 text-[#5a7d58]" />
            </div>
            <DialogTitle className="font-heading text-lg">Pending staff tasks</DialogTitle>
          </div>
          <DialogDescription className="text-sm text-muted-foreground leading-relaxed">
            You have {total} open {total === 1 ? "task" : "tasks"} visible to your role.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 max-h-[60vh] overflow-y-auto py-1">
          {tasks.map((task) => {
            const style = urgencyStyles[task.urgency] || urgencyStyles.green;
            const href = task.actionHref || "/tasks";
            return (
              <div key={task.id} className={`flex items-start gap-3 rounded-md border ${style.border} ${style.bg} p-3`} data-testid={`staff-pending-task-${task.id}`}>
                <div className={`w-3 h-3 rounded-full ${style.dot} mt-2 flex-shrink-0`} />
                <div className="w-8 h-8 rounded-lg bg-background flex items-center justify-center shrink-0">
                  <ListChecks className="w-4 h-4 text-[#5a7d58]" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className={`text-sm font-medium ${style.text}`}>{task.title}</p>
                    <span className="text-xs text-muted-foreground">{formatTimeAgo(task.createdAt)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{task.message}</p>
                  {task.followUpDate && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Follow-up: {new Date(task.followUpDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                    </p>
                  )}
                </div>
                <Link href={href}>
                  <Button size="sm" variant="outline" className="h-8 gap-1.5 shrink-0" onClick={onDismiss} data-testid={`button-staff-pending-task-${task.id}`}>
                    <ExternalLink className="w-3.5 h-3.5" />
                    {task.actionLabel || "Open"}
                  </Button>
                </Link>
              </div>
            );
          })}
          {hiddenCount > 0 && (
            <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
              {hiddenCount} more {hiddenCount === 1 ? "task is" : "tasks are"} available on the full Tasks page.
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Link href="/tasks">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={onDismiss} data-testid="button-staff-pending-tasks-open-all">
              <ListChecks className="w-3.5 h-3.5" />
              Open tasks
            </Button>
          </Link>
          <Button variant="ghost" size="sm" onClick={onDismiss} data-testid="button-staff-pending-tasks-later">
            Remind me later
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ClientAppointmentBlock({ appointment, emptyText, pending }: { appointment: ClientDashboardAppointment | null; emptyText: string; pending?: boolean }) {
  const {
    fallbackMeetingLink,
    joiningAppointmentId,
    joinAppointment,
    clearFallbackMeetingLink,
  } = useAuditedAppointmentJoin();

  if (!appointment) {
    return (
      <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground" data-testid={pending ? "client-pending-appointment-empty" : "client-confirmed-appointment-empty"}>
        {emptyText}
      </div>
    );
  }

  const when = formatClientAppointment(appointment);
  const paymentLabel = appointment.paymentStatus === "paid" ? "Payment complete" : "Payment pending";
  return (
    <>
      <div className="rounded-md border p-4" data-testid={pending ? "client-pending-appointment" : "client-next-confirmed-appointment"}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">{appointment.sessionType}</p>
            <p className="text-sm text-muted-foreground mt-1">
              {when.date}{when.time ? ` at ${when.time}` : ""} &middot; {appointment.duration} min
            </p>
            <p className="text-xs text-muted-foreground mt-1">Mediator: {appointment.mediatorName}</p>
          </div>
          <Badge variant={pending ? "secondary" : "default"}>{appointment.status}</Badge>
        </div>
        {pending && (
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <Badge variant={appointment.paymentStatus === "paid" ? "default" : "outline"}>{paymentLabel}</Badge>
            {appointment.paymentStatus === "paid" && <Badge variant="outline">Awaiting forms or confirmation</Badge>}
          </div>
        )}
        {appointment.canJoin && !pending && (
          <Button
            size="sm"
            variant="outline"
            className="mt-3 h-8 gap-1.5"
            onClick={() => void joinAppointment(appointment.id)}
            disabled={joiningAppointmentId === appointment.id}
            data-testid={`button-client-join-${appointment.id}`}
          >
            {joiningAppointmentId === appointment.id ? (
              <Clock className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Video className="w-3.5 h-3.5" />
            )}
            Join
          </Button>
        )}
      </div>
      <AppointmentJoinFallbackDialog meetingLink={fallbackMeetingLink} onClose={clearFallbackMeetingLink} />
    </>
  );
}

function ClientDashboard({ firstName }: { firstName: string }) {
  const { data, isLoading } = useQuery<ClientDashboardPayload>({
    queryKey: ["/api/dashboard/client"],
  });
  const paymentReturnParams = new URLSearchParams(window.location.search);
  const paymentReturn = paymentReturnParams.get("payment");
  const returnInvoiceId = paymentReturnParams.get("invoiceId")?.trim() || "";
  const returnSessionId = paymentReturnParams.get("session_id")?.trim().replace(/\?+$/, "") || "";
  const paymentStatusQuery = useQuery<ClientInvoicePaymentStatus>({
    queryKey: ["/api/client/invoices", returnInvoiceId, "payment-status", returnSessionId],
    queryFn: async () => {
      const res = await fetch(`/api/client/invoices/${encodeURIComponent(returnInvoiceId)}/payment-status?session_id=${encodeURIComponent(returnSessionId)}`, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || "Could not check payment status");
      return body as ClientInvoicePaymentStatus;
    },
    enabled: paymentReturn === "success" && !!returnInvoiceId && !!returnSessionId,
    retry: false,
  });
  useEffect(() => {
    if (paymentStatusQuery.data) {
      void refreshClientDashboardActions();
      clearDashboardPaymentReturnParams();
    } else if (paymentStatusQuery.error) {
      clearDashboardPaymentReturnParams();
    } else if (paymentReturn === "cancelled") {
      clearDashboardPaymentReturnParams();
    }
  }, [paymentReturn, paymentStatusQuery.data, paymentStatusQuery.error]);

  const pendingActionCases: ClientPendingActionsCase[] = (data?.cases || [])
    .filter((caseItem) => caseItem.tasks.length > 0);
  const pendingActionsSignature = getPendingActionSignature(pendingActionCases);
  const [pendingActionsModalOpen, setPendingActionsModalOpen] = useState(false);
  const [dismissedPaymentInvoiceIds, setDismissedPaymentInvoiceIds] = useState<string[]>([]);
  const paymentDueModalInvoice = data?.cases
    .flatMap((caseItem) => caseItem.tasks.map((task) => ({ ...task, caseRef: caseItem.caseRef })))
    .find((action) => action.kind === "payment" && action.invoiceId && action.isMediationSessionInvoice && !dismissedPaymentInvoiceIds.includes(action.invoiceId));
  useEffect(() => {
    if (!pendingActionsSignature) {
      setPendingActionsModalOpen(false);
      return;
    }
    if (typeof window !== "undefined" && sessionStorage.getItem(CLIENT_PENDING_ACTIONS_DISMISSED_KEY) === pendingActionsSignature) return;
    setPendingActionsModalOpen(true);
  }, [pendingActionsSignature]);

  const dismissPendingActionsModal = () => {
    if (typeof window !== "undefined" && pendingActionsSignature) {
      sessionStorage.setItem(CLIENT_PENDING_ACTIONS_DISMISSED_KEY, pendingActionsSignature);
    }
    setPendingActionsModalOpen(false);
  };
  const payInvoiceMutation = useMutation({
    mutationFn: async (invoice: ClientDashboardAction) => {
      const res = await apiRequest("POST", `/api/client/invoices/${invoice.invoiceId}/pay`, {});
      return res.json() as Promise<{ checkoutUrl: string }>;
    },
    onSuccess: (result) => {
      const paymentUrl = result.checkoutUrl;
      if (paymentUrl) window.location.assign(paymentUrl);
    },
  });

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto" data-testid="client-dashboard-page">
      {(paymentReturn === "success" || paymentReturn === "cancelled") && (
        <Card className={paymentReturn === "success" ? "border-[#5a7d58]/30 bg-[#5a7d58]/10" : "border-amber-200 bg-amber-50"} data-testid="dashboard-payment-return">
          <CardContent className="p-4 flex gap-3">
            {paymentReturn === "success" && !paymentStatusQuery.error ? (
              <CheckCircle2 className="h-5 w-5 text-[#5a7d58] mt-0.5 shrink-0" />
            ) : (
              <AlertCircle className="h-5 w-5 text-amber-700 mt-0.5 shrink-0" />
            )}
            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">
                {paymentReturn === "cancelled"
                  ? "Payment cancelled"
                  : paymentStatusQuery.isLoading
                    ? "Checking payment"
                    : paymentStatusQuery.error
                      ? "Payment check failed"
                      : paymentStatusQuery.data?.paymentStatus === "paid" || paymentStatusQuery.data?.reconciliationAction === "already_paid"
                        ? "Payment recorded"
                        : "Payment not confirmed"}
              </p>
              <p className="text-sm text-muted-foreground">
                {paymentReturn === "cancelled"
                  ? "Your payment was not completed. You can try again from the outstanding invoice prompt."
                  : paymentStatusQuery.isLoading
                    ? "Please wait while we confirm the Stripe payment."
                    : paymentStatusQuery.error
                      ? paymentStatusQuery.error.message
                      : paymentStatusQuery.data?.paymentStatus === "paid" || paymentStatusQuery.data?.reconciliationAction === "already_paid"
                        ? "Thank you. Your mediation session invoice has been updated."
                        : "Stripe has not confirmed this payment yet. Please try again or contact Brighter Future Mediation."}
              </p>
              {paymentStatusQuery.data?.reconciliationAction === "session_not_paid" && paymentDueModalInvoice && (
                <Button
                  type="button"
                  size="sm"
                  className="bg-[#5a7d58] hover:bg-[#4a6c49] text-white"
                  onClick={() => payInvoiceMutation.mutate(paymentDueModalInvoice)}
                  disabled={payInvoiceMutation.isPending}
                >
                  {payInvoiceMutation.isPending ? <Clock className="w-4 h-4 mr-2 animate-spin" /> : <CreditCard className="w-4 h-4 mr-2" />}
                  Try payment again
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}
      <div>
        <h1 className="text-2xl font-heading font-semibold text-foreground" data-testid="text-client-dashboard-greeting">
          Good {getGreeting()}, {firstName}
        </h1>
        <p className="text-muted-foreground mt-1">
          Your mediation cases, appointments, actions, and updates.
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2].map((i) => (
            <Card key={i}>
              <CardContent className="p-5 space-y-4">
                <Skeleton className="h-6 w-44" />
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-20 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : data?.cases.length ? (
        <div className="space-y-5">
          {data.cases.map((caseItem) => (
            <Card key={caseItem.caseId} className="hover-elevate" data-testid={`client-case-card-${caseItem.caseId}`}>
              <CardContent className="p-5 space-y-5">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="text-lg font-heading font-semibold text-foreground font-mono" data-testid={`text-client-case-ref-${caseItem.caseId}`}>
                        {caseItem.caseRef}
                      </h2>
                      <Badge variant={caseItem.status === "Active" ? "default" : "secondary"}>{caseItem.status}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      {caseItem.issueType || "Mediation"} &middot; Mediator: {caseItem.mediatorName}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap justify-start sm:justify-end">
                    <span className="text-xs font-medium text-muted-foreground">Current stage</span>
                    <Badge variant="outline" className="max-w-full whitespace-normal text-left" data-testid={`badge-client-case-stage-${caseItem.caseId}`}>
                      {caseItem.stage}
                    </Badge>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-[#5a7d58]" />
                      <h3 className="text-sm font-semibold text-foreground">Next appointment</h3>
                    </div>
                    <ClientAppointmentBlock appointment={caseItem.nextConfirmedAppointment} emptyText="No appointment confirmed yet" />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <CalendarClock className="w-4 h-4 text-[#b8825a]" />
                      <h3 className="text-sm font-semibold text-foreground">Pending booking</h3>
                    </div>
                    <ClientAppointmentBlock appointment={caseItem.pendingAppointment} emptyText="No pending booking or payment hold" pending />
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <ListChecks className="w-4 h-4 text-[#5a7d58]" />
                      <h3 className="text-sm font-semibold text-foreground">Outstanding actions</h3>
                      {caseItem.tasks.length > 0 && <Badge variant="secondary">{caseItem.tasks.length}</Badge>}
                    </div>
                    {caseItem.tasks.length > 0 ? (
                      <div className="space-y-2">
                        {caseItem.tasks.map((action) => {
                          const Icon = getActionIcon(action.kind);
                          const style = urgencyStyles[action.urgency] || urgencyStyles.green;
                          return (
                            <div key={action.id} className={`flex items-start gap-3 rounded-md border ${style.border} ${style.bg} p-3`} data-testid={`client-action-${action.id}`}>
                              <div className={`w-3 h-3 rounded-full ${style.dot} mt-2 flex-shrink-0`} />
                              <div className="w-8 h-8 rounded-lg bg-[#a7baa4]/15 flex items-center justify-center shrink-0">
                                <Icon className="w-4 h-4 text-[#5a7d58]" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className={`text-sm font-medium ${style.text}`}>{action.title}</p>
                                <p className="text-xs text-muted-foreground mt-1">{action.message}</p>
                              </div>
                              <ActionButton action={action} />
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground" data-testid={`client-actions-empty-${caseItem.caseId}`}>
                        No outstanding actions
                      </div>
                    )}
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <MessageSquare className="w-4 h-4 text-[#b8825a]" />
                      <h3 className="text-sm font-semibold text-foreground">Recent updates</h3>
                    </div>
                    {caseItem.notifications.length > 0 ? (
                      <div className="space-y-2">
                        {caseItem.notifications.map((notice) => (
                          <div key={notice.id} className="rounded-md border p-3" data-testid={`client-notification-${notice.id}`}>
                            <div className="flex items-center justify-between gap-3">
                              <p className="text-sm font-medium text-foreground">{notice.title}</p>
                              <span className="text-xs text-muted-foreground shrink-0">{formatTimeAgo(notice.createdAt)}</span>
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">{notice.message}</p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground" data-testid={`client-notifications-empty-${caseItem.caseId}`}>
                        No recent updates
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex justify-end">
                  <Link href={`/cases/${caseItem.caseId}`}>
                    <Button variant="ghost" size="sm" className="gap-1.5" data-testid={`link-client-view-case-${caseItem.caseId}`}>
                      View case
                      <ArrowRight className="w-4 h-4" />
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card data-testid="client-dashboard-empty">
          <CardContent className="p-8 text-center">
            <Briefcase className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">No active mediation cases are linked to your portal yet.</p>
          </CardContent>
        </Card>
      )}
      <Dialog
        open={!!paymentDueModalInvoice}
        onOpenChange={(open) => {
          if (!open && paymentDueModalInvoice?.invoiceId) {
            setDismissedPaymentInvoiceIds((current) => [...current, paymentDueModalInvoice.invoiceId!]);
          }
        }}
      >
        <DialogContent data-testid="dialog-client-payment-due">
          <DialogHeader>
            <DialogTitle>Invoice payment is due</DialogTitle>
            <DialogDescription>
              {paymentDueModalInvoice?.invoiceNumber || "This invoice"} must be paid before your mediation session can be confirmed.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border bg-muted/30 p-3 text-sm">
            <p className="font-medium">{paymentDueModalInvoice?.invoiceNumber || "Outstanding invoice"}</p>
            {(paymentDueModalInvoice?.voucherDiscountPence || 0) > 0 ? (
              <div className="mt-1 grid gap-1 text-muted-foreground">
                <p>Subtotal: {formatDashboardPence(paymentDueModalInvoice?.subtotalPence, paymentDueModalInvoice?.currency || "gbp")}</p>
                <p>Voucher discount: -{formatDashboardPence(paymentDueModalInvoice?.voucherDiscountPence, paymentDueModalInvoice?.currency || "gbp")}</p>
                <p>Total payable: {formatDashboardPence(paymentDueModalInvoice?.totalPence, paymentDueModalInvoice?.currency || "gbp")}</p>
                <p>Outstanding: {formatDashboardPence(paymentDueModalInvoice?.outstandingPence, paymentDueModalInvoice?.currency || "gbp")}</p>
              </div>
            ) : (
              <p className="text-muted-foreground">
                Outstanding: {formatDashboardPence(paymentDueModalInvoice?.outstandingPence, paymentDueModalInvoice?.currency || "gbp")}
              </p>
            )}
          </div>
          {payInvoiceMutation.error && (
            <p className="text-sm text-red-600">{payInvoiceMutation.error.message}</p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                if (paymentDueModalInvoice?.invoiceId) {
                  setDismissedPaymentInvoiceIds((current) => [...current, paymentDueModalInvoice.invoiceId!]);
                }
              }}
            >
              Later
            </Button>
            <Button
              type="button"
              className="bg-[#5a7d58] hover:bg-[#4a6c49] text-white"
              onClick={() => paymentDueModalInvoice && payInvoiceMutation.mutate(paymentDueModalInvoice)}
              disabled={!paymentDueModalInvoice || payInvoiceMutation.isPending}
              data-testid="button-client-pay-now"
            >
              {payInvoiceMutation.isPending ? <Clock className="w-4 h-4 mr-2 animate-spin" /> : <CreditCard className="w-4 h-4 mr-2" />}
              Pay now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ClientPendingActionsModal
        open={pendingActionsModalOpen && !paymentDueModalInvoice}
        cases={pendingActionCases}
        onDismiss={dismissPendingActionsModal}
      />
    </div>
  );
}

const urgencyStyles: Record<string, { border: string; bg: string; dot: string; text: string }> = {
  red: {
    border: "border-l-4 border-l-red-500",
    bg: "bg-red-50 dark:bg-red-950/30",
    dot: "bg-red-500",
    text: "text-red-700 dark:text-red-400",
  },
  amber: {
    border: "border-l-4 border-l-amber-500",
    bg: "bg-amber-50 dark:bg-amber-950/30",
    dot: "bg-amber-500",
    text: "text-amber-700 dark:text-amber-400",
  },
  green: {
    border: "border-l-4 border-l-green-500",
    bg: "bg-green-50 dark:bg-green-950/30",
    dot: "bg-green-500",
    text: "text-green-700 dark:text-green-400",
  },
};

function formatTimeAgo(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

export default function DashboardPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const isAdmin = user?.role === "superadmin" || user?.role === "subadmin";
  const isClient = user?.role === "client";

  const [selectedTask, setSelectedTask] = useState<Notification | null>(null);
  const [completeDialogOpen, setCompleteDialogOpen] = useState(false);
  const [completionNotes, setCompletionNotes] = useState("");
  const [caseNoteText, setCaseNoteText] = useState("");
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [selectedAssigneeIds, setSelectedAssigneeIds] = useState<string[]>([]);
  const [followUpDialogOpen, setFollowUpDialogOpen] = useState(false);
  const [followUpDateValue, setFollowUpDateValue] = useState("");
  const [calendarPromptOpen, setCalendarPromptOpen] = useState(false);
  const [justConnectedCalendar, setJustConnectedCalendar] = useState(false);
  const [selectedServiceApprovalId, setSelectedServiceApprovalId] = useState<string | null>(null);
  const [approvalPromptOpen, setApprovalPromptOpen] = useState(false);
  const [availabilityPromptOpen, setAvailabilityPromptOpen] = useState(false);
  const [mediatorPendingTasksModalOpen, setMediatorPendingTasksModalOpen] = useState(false);
  const [staffPendingTasksModalOpen, setStaffPendingTasksModalOpen] = useState(false);

  useCalendarOAuthResult({
    onConnected: () => {
      setJustConnectedCalendar(true);
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
  });

  const isStaff = !isClient;

  const { data: stats, isLoading: statsLoading } = useQuery<DashboardStats>({
    queryKey: ["/api/dashboard/stats"],
    enabled: !isClient,
  });

  const { data: appointments, isLoading: apptLoading } = useQuery<Appointment[]>({
    queryKey: ["/api/dashboard/appointments"],
    enabled: !isClient,
  });

  const { data: serviceApprovals } = useQuery<ServiceApprovalSummary[]>({
    queryKey: ["/api/mediators", user?.id, "service-approvals"],
    enabled: !!user && user.role === "mediator",
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
  });

  const { data: serviceScheduleSlots } = useQuery<ServiceScheduleSlotRow[]>({
    queryKey: ["/api/mediators", user?.id, "service-schedule-slots"],
    enabled: !!user && user.role === "mediator",
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
  });

  const { data: mediatorSessionIndicators } = useQuery<MediatorSessionIndicator[]>({
    queryKey: ["/api/dashboard/mediator-session-indicators"],
    enabled: !!user && user.role === "mediator",
  });

  // Task #212 — Server-side pagination for the dashboard "Your tasks" list.
  // PAGE_SIZE matches the prior client-only slice (5) so the visible UX is
  // identical for small queues, but now only one page is fetched at a time.
  const TASKS_PAGE_SIZE = 5;
  const [tasksPage, setTasksPage] = useState(1);

  const { data: tasksPayload, isLoading: tasksLoading } = useQuery<TaskPagePayload>({
    queryKey: ["/api/tasks", "dashboard", tasksPage, TASKS_PAGE_SIZE],
    queryFn: async () => {
      const res = await fetch(
        `/api/tasks?status=open&page=${tasksPage}&pageSize=${TASKS_PAGE_SIZE}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Failed to fetch tasks");
      return res.json();
    },
    placeholderData: (prev) => prev,
    enabled: !isClient,
  });

  const { data: mediatorPendingTasksPayload } = useQuery<TaskPagePayload>({
    queryKey: ["/api/tasks", "mediator-pending-actions", MEDIATOR_PENDING_TASKS_PAGE_SIZE],
    queryFn: async () => {
      const res = await fetch(
        `/api/tasks?status=open&page=1&pageSize=${MEDIATOR_PENDING_TASKS_PAGE_SIZE}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Failed to fetch pending tasks");
      return res.json();
    },
    enabled: !!user && user.role === "mediator",
  });

  const { data: staffPendingTasksPayload } = useQuery<TaskPagePayload>({
    queryKey: ["/api/tasks", "staff-pending-actions", PENDING_TASKS_PAGE_SIZE],
    queryFn: async () => {
      const res = await fetch(
        `/api/tasks?status=open&page=1&pageSize=${PENDING_TASKS_PAGE_SIZE}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Failed to fetch pending tasks");
      return res.json();
    },
    enabled: isStaff,
  });

  const { data: taskCounts } = useQuery<{
    active: number;
    inProgress: number;
    followUp: number;
    overdueFollowUp: number;
    completed: number;
  }>({
    queryKey: ["/api/tasks/counts"],
    enabled: !isClient,
  });

  const { data: staffUsers } = useQuery<StaffUser[]>({
    queryKey: ["/api/tasks/staff"],
    enabled: isStaff,
  });

  const updateTaskListCaches = (updatedTask: Notification) => {
    queryClient.setQueriesData<TaskPagePayload>(
      { queryKey: ["/api/tasks"] },
      (old) => {
        if (!old || !Array.isArray(old.items)) return old;
        return {
          ...old,
          items: old.items.map((task) => task.id === updatedTask.id ? { ...task, ...updatedTask } : task),
        };
      },
    );
  };

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => {
      const res = await apiRequest("PATCH", `/api/tasks/${id}`, data);
      return res.json() as Promise<Notification>;
    },
    onSuccess: async (updatedTask) => {
      updateTaskListCaches(updatedTask);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/tasks"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/tasks/counts"] }),
      ]);
      // Task #212 — Land the user back on page 1 after a mutation so they see
      // the freshest tasks at the top instead of a stale interior page.
      setTasksPage(1);
      toast({ title: "Task updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const getTaskAssigneeIds = (task: Notification) => (
    task.assignedUserIds?.length ? task.assignedUserIds : (task.assignedTo ? [task.assignedTo] : [])
  );

  const handleStatusChange = (task: Notification, newStatus: string) => {
    setSelectedTask(task);
    if (newStatus === "completed") {
      setCompletionNotes("");
      setCaseNoteText("");
      setCompleteDialogOpen(true);
    } else if (newStatus === "follow_up" && (!task.followUpDate || getTaskAssigneeIds(task).length === 0)) {
      setFollowUpDateValue(task.followUpDate ? new Date(task.followUpDate).toISOString().slice(0, 10) : "");
      setSelectedAssigneeIds(getTaskAssigneeIds(task));
      setFollowUpDialogOpen(true);
    } else {
      updateMutation.mutate({ id: task.id, data: { status: newStatus } });
    }
  };

  const handleCompleteSubmit = () => {
    if (!selectedTask) return;
    updateMutation.mutate({
      id: selectedTask.id,
      data: {
        status: "completed",
        completionNotes: completionNotes.trim() || undefined,
        caseNote: caseNoteText.trim() || undefined,
      },
    });
    setCompleteDialogOpen(false);
  };

  const handleAssignSubmit = () => {
    if (!selectedTask) return;
    updateMutation.mutate({
      id: selectedTask.id,
      data: { assignedUserIds: selectedAssigneeIds },
    });
    setAssignDialogOpen(false);
  };

  const handleFollowUpSubmit = () => {
    if (!selectedTask || !followUpDateValue || selectedAssigneeIds.length === 0) return;
    updateMutation.mutate({
      id: selectedTask.id,
      data: {
        status: "follow_up",
        followUpDate: new Date(followUpDateValue).toISOString(),
        assignedUserIds: selectedAssigneeIds,
      },
    });
    setFollowUpDialogOpen(false);
  };

  const openAssignDialog = (task: Notification) => {
    setSelectedTask(task);
    setSelectedAssigneeIds(getTaskAssigneeIds(task));
    setAssignDialogOpen(true);
  };

  const getStaffName = (userId: string) => {
    const staff = staffUsers?.find((s) => s.id === userId);
    return staff?.name ?? "Unknown";
  };

  const getAssignedStaffNames = (task: Notification) => {
    const ids = getTaskAssigneeIds(task);
    return Array.from(new Set(ids)).map(getStaffName).filter((name) => name !== "Unknown");
  };

  const toggleSelectedAssignee = (userId: string) => {
    setSelectedAssigneeIds((current) => (
      current.includes(userId)
        ? current.filter((id) => id !== userId)
        : [...current, userId]
    ));
  };

  const firstName = user?.name?.split(" ")[0] || "there";

  // Task #212 — Drive everything from the paginated server payload. The badge
  // total comes from `total` on the same response (no extra fetch), and the
  // pager flips between server-fetched pages.
  const pagedTasks = tasksPayload?.items ?? [];
  const totalTasks = tasksPayload?.total ?? 0;
  const totalTaskPages = Math.max(1, Math.ceil(totalTasks / TASKS_PAGE_SIZE));
  const mediatorPendingTasks = mediatorPendingTasksPayload?.items ?? [];
  const mediatorPendingTasksTotal = mediatorPendingTasksPayload?.total ?? 0;
  const mediatorPendingTasksSignature = getTaskSignature(mediatorPendingTasks);
  const staffPendingTasks = staffPendingTasksPayload?.items ?? [];
  const staffPendingTasksTotal = staffPendingTasksPayload?.total ?? 0;
  const staffPendingTasksSignature = getTaskSignature(staffPendingTasks);
  // Safety clamp if the visible page is past the end after a mutation shrinks
  // the list (e.g. completing the last task on the final page).
  useEffect(() => {
    if (tasksPage > totalTaskPages) setTasksPage(totalTaskPages);
  }, [totalTaskPages, tasksPage]);

  useEffect(() => {
    if (!user) return;
    if (user.role !== "mediator") return;
    const mediatorCalendarReady = (user.activeCalendarProvider === "google" && !!user.googleCalendarConnected)
      || (user.activeCalendarProvider === "outlook" && !!user.outlookCalendarConnected);
    if (mediatorCalendarReady) return;
    if (justConnectedCalendar) return;
    if (typeof window !== "undefined" && sessionStorage.getItem("bfm:calendarPromptDismissed") === "1") return;
    setCalendarPromptOpen(true);
  }, [user, justConnectedCalendar]);

  const serviceSlotsByTypeId = useMemo(() => {
    const map = new Map<string, ServiceScheduleSlotRow[]>();
    for (const slot of serviceScheduleSlots ?? []) {
      const arr = map.get(slot.serviceTypeId) ?? [];
      arr.push(slot);
      map.set(slot.serviceTypeId, arr);
    }
    return map;
  }, [serviceScheduleSlots]);

  const futureSlotsByServiceTypeId = useMemo(() => {
    const map = new Map<string, ServiceScheduleSlotRow[]>();
    const nowMs = Date.now();
    for (const slot of serviceScheduleSlots ?? []) {
      if (new Date(slot.startAt).getTime() >= nowMs) {
        const arr = map.get(slot.serviceTypeId) ?? [];
        arr.push(slot);
        map.set(slot.serviceTypeId, arr);
      }
    }
    return map;
  }, [serviceScheduleSlots]);

  const servicesNeedingApproval = useMemo(
    () => (serviceApprovals ?? []).filter((approval) => {
      const status = getServiceApprovalStatus(approval);
      return status === "requested" || status === "rejected" || status === "expired" || status === "not_requested";
    }),
    [serviceApprovals],
  );

  const servicesPendingReview = useMemo(
    () => (serviceApprovals ?? []).filter((approval) => {
      const status = getServiceApprovalStatus(approval);
      return status === "pending_review";
    }),
    [serviceApprovals],
  );

  const servicesNeedingAvailability = useMemo(
    () => (serviceApprovals ?? []).filter((approval) => {
      const status = getServiceApprovalStatus(approval);
      return status === "approved" && (futureSlotsByServiceTypeId.get(approval.serviceTypeId)?.length ?? 0) === 0;
    }),
    [futureSlotsByServiceTypeId, serviceApprovals],
  );

  const servicePromptsReady = user?.role === "mediator" && !!serviceApprovals && !!serviceScheduleSlots && !calendarPromptOpen;

  useEffect(() => {
    if (!servicePromptsReady) return;
    if (selectedServiceApprovalId) return;
    if (approvalPromptOpen || availabilityPromptOpen) return;
    if (mediatorPendingTasksModalOpen) return;
    if (servicesNeedingApproval.length > 0 && sessionStorage.getItem(APPROVAL_PROMPT_DISMISSED_KEY) !== "1") {
      setApprovalPromptOpen(true);
      return;
    }
    if (servicesNeedingAvailability.length > 0 && sessionStorage.getItem(AVAILABILITY_PROMPT_DISMISSED_KEY) !== "1") {
      setAvailabilityPromptOpen(true);
    }
  }, [
    approvalPromptOpen,
    availabilityPromptOpen,
    mediatorPendingTasksModalOpen,
    selectedServiceApprovalId,
    servicePromptsReady,
    servicesNeedingApproval.length,
    servicesNeedingAvailability.length,
  ]);

  const selectedServiceApproval = serviceApprovals?.find((approval) => approval.id === selectedServiceApprovalId) ?? null;
  const selectedServiceSlots = selectedServiceApproval ? (serviceSlotsByTypeId.get(selectedServiceApproval.serviceTypeId) ?? []) : [];
  const mediatorActiveCalendarReady = Boolean(
    user?.role === "mediator"
    && ((user.activeCalendarProvider === "google" && user.googleCalendarConnected)
      || (user.activeCalendarProvider === "outlook" && user.outlookCalendarConnected)),
  );
  const autoOpenSchedulePrompt = Boolean(
    user?.role === "mediator" &&
    mediatorActiveCalendarReady &&
    selectedServiceApproval &&
    (selectedServiceApproval.effectiveStatus ?? selectedServiceApproval.status)?.toLowerCase() === "approved" &&
    (futureSlotsByServiceTypeId.get(selectedServiceApproval.serviceTypeId)?.length ?? 0) === 0,
  );

  useEffect(() => {
    const mediatorPendingTasksPromptBlocked = Boolean(
      calendarPromptOpen ||
      approvalPromptOpen ||
      availabilityPromptOpen ||
      !!selectedServiceApproval
    );
    if (user?.role !== "mediator") return;
    if (mediatorPendingTasksPromptBlocked) {
      setMediatorPendingTasksModalOpen(false);
      return;
    }
    if (!mediatorPendingTasksSignature) {
      setMediatorPendingTasksModalOpen(false);
      return;
    }
    if (typeof window !== "undefined" && sessionStorage.getItem(MEDIATOR_PENDING_TASKS_DISMISSED_KEY) === mediatorPendingTasksSignature) return;
    setMediatorPendingTasksModalOpen(true);
  }, [
    approvalPromptOpen,
    availabilityPromptOpen,
    calendarPromptOpen,
    mediatorPendingTasksSignature,
    selectedServiceApproval,
    user?.role,
  ]);

  const dismissMediatorPendingTasksModal = () => {
    if (typeof window !== "undefined" && mediatorPendingTasksSignature) {
      sessionStorage.setItem(MEDIATOR_PENDING_TASKS_DISMISSED_KEY, mediatorPendingTasksSignature);
    }
    setMediatorPendingTasksModalOpen(false);
  };

  useEffect(() => {
    if (!isAdmin) return;
    if (!staffPendingTasksSignature) {
      setStaffPendingTasksModalOpen(false);
      return;
    }
    if (typeof window !== "undefined" && sessionStorage.getItem(STAFF_PENDING_TASKS_DISMISSED_KEY) === staffPendingTasksSignature) return;
    setStaffPendingTasksModalOpen(true);
  }, [isAdmin, staffPendingTasksSignature]);

  const dismissStaffPendingTasksModal = () => {
    if (typeof window !== "undefined" && staffPendingTasksSignature) {
      sessionStorage.setItem(STAFF_PENDING_TASKS_DISMISSED_KEY, staffPendingTasksSignature);
    }
    setStaffPendingTasksModalOpen(false);
  };

  const dismissCalendarPrompt = () => {
    if (typeof window !== "undefined") {
      sessionStorage.setItem("bfm:calendarPromptDismissed", "1");
    }
    setCalendarPromptOpen(false);
  };

  const dismissApprovalPrompt = () => {
    sessionStorage.setItem(APPROVAL_PROMPT_DISMISSED_KEY, "1");
    setApprovalPromptOpen(false);
  };

  const dismissAvailabilityPrompt = () => {
    sessionStorage.setItem(AVAILABILITY_PROMPT_DISMISSED_KEY, "1");
    setAvailabilityPromptOpen(false);
  };

  const closeAvailabilityPromptForDrawer = () => {
    setAvailabilityPromptOpen(false);
  };

  const openApprovalDrawer = (approval: ServiceApprovalSummary) => {
    dismissApprovalPrompt();
    setSelectedServiceApprovalId(approval.id);
  };

  const openAvailabilityDrawer = (approval: ServiceApprovalSummary) => {
    closeAvailabilityPromptForDrawer();
    setSelectedServiceApprovalId(approval.id);
  };

  if (isClient) {
    return <ClientDashboard firstName={firstName} />;
  }

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto" data-testid="dashboard-page">
      <CalendarConnectModal
        open={calendarPromptOpen}
        onOpenChange={(open) => { if (!open) dismissCalendarPrompt(); }}
        mode="prompt"
        connectedProvider={user?.activeCalendarProvider === "google" || user?.activeCalendarProvider === "outlook"
          ? user.activeCalendarProvider
          : user?.googleCalendarConnected ? "google" : user?.outlookCalendarConnected ? "outlook" : null}
        returnTo="dashboard"
        onDismiss={dismissCalendarPrompt}
      />
      {user?.role === "mediator" && (
        <ServiceApprovalDrawer
          open={!!selectedServiceApproval}
          onOpenChange={(open) => {
            if (!open) {
              setSelectedServiceApprovalId(null);
            }
          }}
          mediatorId={user.id}
          serviceTypeId={selectedServiceApproval?.serviceTypeId ?? ""}
          serviceType={selectedServiceApproval?.serviceType ?? null}
          approval={selectedServiceApproval as ServiceApprovalSheetRow | null}
          scheduleSlots={selectedServiceSlots}
          autoOpenSchedulePrompt={autoOpenSchedulePrompt}
        />
      )}
      {user?.role === "mediator" && (
        <MediatorPendingTasksModal
          open={mediatorPendingTasksModalOpen}
          tasks={mediatorPendingTasks}
          total={mediatorPendingTasksTotal}
          onDismiss={dismissMediatorPendingTasksModal}
        />
      )}
      {isAdmin && (
        <StaffPendingTasksModal
          open={staffPendingTasksModalOpen}
          tasks={staffPendingTasks}
          total={staffPendingTasksTotal}
          onDismiss={dismissStaffPendingTasksModal}
        />
      )}

      <Dialog open={approvalPromptOpen} onOpenChange={(open) => { if (!open) dismissApprovalPrompt(); }}>
        <DialogContent className="sm:max-w-2xl" data-testid="dialog-mediator-approval-needed">
          <DialogHeader>
            <DialogTitle>Service approval needed</DialogTitle>
            <DialogDescription>
              Send proof for selected services so admins can approve them for booking.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {servicesNeedingApproval.map((approval) => (
              <div key={approval.id} className="flex items-center justify-between gap-3 rounded-md border p-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{serviceName(approval)}</p>
                  <p className="text-xs text-muted-foreground">{serviceCategory(approval)}</p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="shrink-0 gap-1.5"
                  onClick={() => openApprovalDrawer(approval)}
                  data-testid={`button-open-approval-${approval.serviceTypeId}`}
                >
                  <Shield className="h-3.5 w-3.5" />
                  Send request
                </Button>
              </div>
            ))}
            {servicesPendingReview.length > 0 && (
              <div className="rounded-md border bg-muted/30 p-3">
                <p className="text-sm font-medium text-foreground">Pending review</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {servicesPendingReview.map(serviceName).join(", ")} already {servicesPendingReview.length === 1 ? "has" : "have"} proof awaiting admin review.
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={dismissApprovalPrompt} data-testid="button-dismiss-approval-prompt">
              Later
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={availabilityPromptOpen} onOpenChange={(open) => { if (!open) dismissAvailabilityPrompt(); }}>
        <DialogContent className="sm:max-w-2xl" data-testid="dialog-mediator-availability-needed">
          <DialogHeader>
            <DialogTitle>Availability needed</DialogTitle>
            <DialogDescription>
              Add the next available slot for approved services so clients can book them.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {servicesNeedingAvailability.map((approval) => (
              <div key={approval.id} className="flex items-center justify-between gap-3 rounded-md border p-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{serviceName(approval)}</p>
                  <p className="text-xs text-muted-foreground">{serviceCategory(approval)}</p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="shrink-0 gap-1.5"
                  onClick={() => openAvailabilityDrawer(approval)}
                  data-testid={`button-open-availability-${approval.serviceTypeId}`}
                >
                  <CalendarDays className="h-3.5 w-3.5" />
                  Add slot
                </Button>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={dismissAvailabilityPrompt} data-testid="button-dismiss-availability-prompt">
              Later
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div>
        <h1 className="text-2xl font-heading font-semibold text-foreground" data-testid="text-dashboard-greeting">
          Good {getGreeting()}, {firstName}
        </h1>
        <p className="text-muted-foreground mt-1">
          Here's what's happening at Brighter Future Mediation today.
        </p>
      </div>

      {!isClient && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {statCards.map((card) => {
            const href = isAdmin ? card.href : null;
            const content = (
              <Card className={`hover-elevate h-full ${href ? "cursor-pointer" : ""}`}>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm text-muted-foreground">{card.label}</p>
                      {statsLoading ? (
                        <Skeleton className="h-8 w-16 mt-1" />
                      ) : (
                        <p className="text-3xl font-bold text-foreground mt-1" data-testid={`text-stat-${card.key}`}>
                          {stats?.[card.key] ?? 0}
                        </p>
                      )}
                    </div>
                    <div className={`w-10 h-10 rounded-lg ${card.bg} flex items-center justify-center flex-shrink-0`}>
                      <card.icon className={`w-5 h-5 ${card.color}`} />
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
            return href ? (
              <Link key={card.key} href={href} data-testid={`link-stat-${card.key}`}>
                {content}
              </Link>
            ) : (
              <div key={card.key}>{content}</div>
            );
          })}
        </div>
      )}

      {user?.role === "mediator" && serviceApprovals && serviceApprovals.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-4">
            <Shield className="w-5 h-5 text-muted-foreground" />
            <h2 className="text-lg font-heading font-semibold text-foreground" data-testid="text-service-approvals-heading">
              Service approvals
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {serviceApprovals.map((approval) => {
              const status = getServiceApprovalStatus(approval);
              const futureSlotCount = futureSlotsByServiceTypeId.get(approval.serviceTypeId)?.length ?? 0;
              const statusText = status === "approved"
                ? futureSlotCount > 0
                  ? "Calendar event captured"
                  : "Approved - awaiting calendar event"
                : status === "pending_review"
                  ? "Pending admin review"
                  : status === "rejected"
                    ? "Request rejected"
                    : status === "expired"
                      ? "Approval expired"
                      : status === "revoked"
                        ? "Approval revoked - fresh proof needed"
                        : "Approval needed";
              return (
                <Card key={approval.id} data-testid={`card-service-approval-${approval.serviceTypeId}`}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground">{serviceName(approval)}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{serviceCategory(approval)}</p>
                        <p className="text-xs text-muted-foreground mt-2">{statusText}</p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="shrink-0"
                        onClick={() => setSelectedServiceApprovalId(approval.id)}
                        data-testid={`button-manage-service-approval-${approval.serviceTypeId}`}
                      >
                        Manage in profile
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {taskCounts && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <ListChecks className="w-5 h-5 text-muted-foreground" />
              <h2 className="text-lg font-heading font-semibold text-foreground" data-testid="text-tasks-heading">
                Task overview
              </h2>
            </div>
            {!isClient && (
              <Link href="/tasks">
                <Button variant="ghost" size="sm" className="text-sm gap-1" data-testid="link-view-all-tasks">
                  View all tasks
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </Link>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card data-testid="dash-task-active">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                  <CircleDot className="w-4 h-4 text-blue-600" />
                </div>
                <div>
                  <p className="text-xl font-bold text-foreground">{taskCounts.active}</p>
                  <p className="text-xs text-muted-foreground">Active</p>
                </div>
              </CardContent>
            </Card>
            <Card data-testid="dash-task-in-progress">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                  <Clock className="w-4 h-4 text-amber-600" />
                </div>
                <div>
                  <p className="text-xl font-bold text-foreground">{taskCounts.inProgress}</p>
                  <p className="text-xs text-muted-foreground">In Progress</p>
                </div>
              </CardContent>
            </Card>
            <Card data-testid="dash-task-follow-up">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
                  <CalendarClock className="w-4 h-4 text-purple-600" />
                </div>
                <div>
                  <p className="text-xl font-bold text-foreground">{taskCounts.followUp}</p>
                  <p className="text-xs text-muted-foreground">
                    Follow-up
                    {taskCounts.overdueFollowUp > 0 && (
                      <span className="text-red-600 dark:text-red-400 ml-1">({taskCounts.overdueFollowUp} overdue)</span>
                    )}
                  </p>
                </div>
              </CardContent>
            </Card>
            <Card data-testid="dash-task-completed">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                  <CheckCircle2 className="w-4 h-4 text-green-600" />
                </div>
                <div>
                  <p className="text-xl font-bold text-foreground">{taskCounts.completed}</p>
                  <p className="text-xs text-muted-foreground">Completed</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {user?.role === "mediator" && mediatorSessionIndicators && mediatorSessionIndicators.length > 0 && (
        <div data-testid="mediator-session-indicators">
          <div className="flex items-center gap-2 mb-4">
            <CalendarClock className="w-5 h-5 text-muted-foreground" />
            <h2 className="text-lg font-heading font-semibold text-foreground">
              Session status
            </h2>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {mediatorSessionIndicators.map((item) => {
              const style = urgencyStyles[item.indicator.color] || urgencyStyles.green;
              const appointmentLabel = item.appointmentAt ? formatClientAppointment({
                id: item.sessionId,
                dateTime: item.appointmentAt,
                dateTimeBasis: "wall_clock_utc",
                duration: 0,
                sessionType: "Mediation Session",
                mediatorName: "",
                hasMeetingLink: false,
                canJoin: false,
                status: "",
                paymentStatus: null,
              }).date : "Date to be proposed";
              return (
                <Link key={item.sessionId} href={`/cases/${item.caseId}?tab=mediation-sessions`}>
                  <Card className={`${style.border} ${style.bg} hover-elevate`}>
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        <div className={`w-3 h-3 rounded-full ${style.dot} mt-1.5 shrink-0`} />
                        <div className="min-w-0">
                          <p className={`text-sm font-medium ${style.text}`}>{item.caseRef} · Session {item.sessionNumber}</p>
                          <p className="text-sm text-muted-foreground mt-1">{item.indicator.reason}</p>
                          <p className="text-xs text-muted-foreground mt-1">{appointmentLabel}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      <div>
        <div className="flex items-center gap-2 mb-4">
          <ListChecks className="w-5 h-5 text-muted-foreground" />
          <h2 className="text-lg font-heading font-semibold text-foreground" data-testid="text-your-tasks-heading">
            Your tasks
          </h2>
          {totalTasks > 0 && (
            <Badge variant="secondary" className="ml-1" data-testid="badge-task-count">
              {totalTasks}
            </Badge>
          )}
        </div>

        {tasksLoading ? (
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <Card key={i}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-4">
                    <Skeleton className="h-3 w-3 rounded-full" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-64" />
                      <Skeleton className="h-3 w-48" />
                    </div>
                    <Skeleton className="h-8 w-24" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : totalTasks > 0 ? (
          <div className="space-y-3">
            {pagedTasks.map((task) => {
              const style = urgencyStyles[task.urgency] || urgencyStyles.green;
              return (
                <Card key={task.id} className={`${style.border} ${style.bg}`} data-testid={`task-card-${task.id}`}>
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <div className={`w-3 h-3 rounded-full ${style.dot} mt-1.5 flex-shrink-0`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`font-medium text-sm ${style.text}`} data-testid={`text-task-title-${task.id}`}>
                            {task.title}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {formatTimeAgo(task.createdAt)}
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground mt-1" data-testid={`text-task-message-${task.id}`}>
                          {task.message}
                        </p>
                        {task.caseNoteRequired && !isClient && (
                          <div className="flex items-center gap-1 mt-2 text-xs text-amber-600 dark:text-amber-400">
                            <FileText className="w-3 h-3" />
                            <span>Case note required to complete</span>
                          </div>
                        )}
                        {getAssignedStaffNames(task).length > 0 && (
                          <div className="flex flex-wrap items-center gap-1.5 mt-2">
                            <span className="text-xs text-muted-foreground">Assigned:</span>
                            {getAssignedStaffNames(task).map((name) => (
                              <Badge
                                key={name}
                                variant="outline"
                                className="text-[11px] bg-background/70"
                                data-testid={`badge-dashboard-task-assignee-${task.id}`}
                              >
                                {name}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <Link href={task.actionHref || "/tasks"}>
                          <Button variant="ghost" size="sm" className="gap-1 text-xs" data-testid={`link-view-case-${task.id}`}>
                            <ExternalLink className="w-3.5 h-3.5" />
                            {task.actionLabel || "Open"}
                          </Button>
                        </Link>
                        {isStaff && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="outline" size="icon" className="h-8 w-8" data-testid={`button-task-actions-${task.id}`}>
                                <MoreHorizontal className="w-4 h-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {task.status !== "in_progress" && (
                                <DropdownMenuItem onClick={() => handleStatusChange(task, "in_progress")} data-testid={`action-set-in-progress-${task.id}`}>
                                  <Clock className="w-4 h-4 mr-2 text-amber-600" />
                                  Set In Progress
                                </DropdownMenuItem>
                              )}
                              {task.status !== "follow_up" && (
                                <DropdownMenuItem onClick={() => handleStatusChange(task, "follow_up")} data-testid={`action-set-follow-up-${task.id}`}>
                                  <CalendarClock className="w-4 h-4 mr-2 text-purple-600" />
                                  Set Follow-up
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem onClick={() => handleStatusChange(task, "completed")} data-testid={`action-complete-${task.id}`}>
                                <CheckCircle2 className="w-4 h-4 mr-2 text-green-600" />
                                Complete
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              {staffUsers && (
                                <DropdownMenuItem onClick={() => openAssignDialog(task)} data-testid={`action-assign-${task.id}`}>
                                  <UserPlus className="w-4 h-4 mr-2" />
                                  Assign
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem onClick={() => {
                                setSelectedTask(task);
                                setFollowUpDateValue(task.followUpDate ? new Date(task.followUpDate).toISOString().slice(0, 10) : "");
                                setSelectedAssigneeIds(getTaskAssigneeIds(task));
                                setFollowUpDialogOpen(true);
                              }} data-testid={`action-follow-up-date-${task.id}`}>
                                <CalendarDays className="w-4 h-4 mr-2" />
                                Set follow-up date
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
            {totalTaskPages > 1 && (
              <div
                className="flex items-center justify-between pt-2"
                data-testid="tasks-pager"
              >
                <span
                  className="text-xs text-muted-foreground"
                  data-testid="text-tasks-page-indicator"
                >
                  Page {tasksPage} of {totalTaskPages}
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1"
                    onClick={() => setTasksPage((p) => Math.max(1, p - 1))}
                    disabled={tasksPage <= 1}
                    aria-label="Previous page of tasks"
                    data-testid="button-tasks-page-prev"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    Prev
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1"
                    onClick={() => setTasksPage((p) => Math.min(totalTaskPages, p + 1))}
                    disabled={tasksPage >= totalTaskPages}
                    aria-label="Next page of tasks"
                    data-testid="button-tasks-page-next"
                  >
                    Next
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <Card>
            <CardContent className="p-6 text-center">
              <ListChecks className="w-8 h-8 text-muted-foreground mx-auto mb-2 opacity-50" />
              <p className="text-sm text-muted-foreground">No active tasks</p>
            </CardContent>
          </Card>
        )}
      </div>

      <div>
        <h2 className="text-lg font-heading font-semibold text-foreground mb-4" data-testid="text-todays-schedule">
          Today's schedule
        </h2>
        {apptLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Card key={i}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-4">
                    <Skeleton className="h-10 w-10 rounded-lg" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-48" />
                      <Skeleton className="h-3 w-32" />
                    </div>
                    <Skeleton className="h-6 w-20 rounded-full" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : appointments && appointments.length > 0 ? (
          <div className="space-y-3">
            {appointments.map((appt) => {
              const TypeIcon = getTypeIcon(appt.type);
              const isServiceEvent = appt.kind === "service_event";
              return (
                <Card key={appt.id} className="hover-elevate">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-4 flex-wrap">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${isServiceEvent ? "bg-[#a7baa4]/20" : "bg-primary/10"}`}>
                        <TypeIcon className={`w-5 h-5 ${isServiceEvent ? "text-[#5a7d58]" : "text-primary"}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-foreground text-sm" data-testid={`text-appt-time-${appt.id}`}>
                            {appt.time}
                          </span>
                          <span className="text-muted-foreground text-sm">&middot;</span>
                          <span className="text-sm text-foreground truncate" data-testid={`text-appt-client-${appt.id}`}>
                            {appt.clientNames}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground flex-wrap">
                          <span>{appt.type}</span>
                          <span>&middot;</span>
                          <span>{appt.mediator}</span>
                          <span>&middot;</span>
                          <span>{appt.location}</span>
                        </div>
                      </div>
                      <Badge variant={isServiceEvent ? "outline" : getStatusVariant(appt.status)} data-testid={`badge-appt-status-${appt.id}`}>
                        {isServiceEvent ? "Service event" : appt.status}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : (
          <Card>
            <CardContent className="p-8 text-center">
              <Calendar className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">No appointments scheduled for today</p>
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={completeDialogOpen} onOpenChange={setCompleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Complete task</DialogTitle>
            <DialogDescription>
              Record the outcome of this task. {selectedTask?.caseNoteRequired && "A case note is required."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium text-foreground mb-1.5 block">Outcome notes</label>
              <Textarea
                placeholder="What was done? What's the outcome?"
                value={completionNotes}
                onChange={e => setCompletionNotes(e.target.value)}
                rows={3}
                data-testid="input-completion-notes"
              />
              {selectedTask?.caseId && (
                <p className="text-xs text-muted-foreground mt-1">
                  These notes will be recorded in the case activity timeline.
                </p>
              )}
            </div>
            {selectedTask?.caseNoteRequired && (
              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 block">
                  Case note <span className="text-red-500">*</span>
                </label>
                <Textarea
                  placeholder="Enter case note (required)..."
                  value={caseNoteText}
                  onChange={e => setCaseNoteText(e.target.value)}
                  rows={3}
                  data-testid="input-case-note"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  This will be saved to the case's confidential notes.
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCompleteDialogOpen(false)} data-testid="button-cancel-complete">
              Cancel
            </Button>
            <Button
              onClick={handleCompleteSubmit}
              disabled={updateMutation.isPending || (selectedTask?.caseNoteRequired && !caseNoteText.trim())}
              data-testid="button-submit-complete"
            >
              Complete task
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={assignDialogOpen} onOpenChange={setAssignDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign task</DialogTitle>
            <DialogDescription>
              Choose one or more team members to assign this task to.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2 space-y-2">
            {staffUsers?.map(s => (
              <label key={s.id} className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm">
                <Checkbox
                  checked={selectedAssigneeIds.includes(s.id)}
                  onCheckedChange={() => toggleSelectedAssignee(s.id)}
                  data-testid={`checkbox-dashboard-assignee-${s.id}`}
                />
                <span>{s.name} ({s.role})</span>
              </label>
            ))}
            {staffUsers?.length === 0 && (
              <p className="text-sm text-muted-foreground">No active staff members available.</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignDialogOpen(false)} data-testid="button-cancel-assign">
              Cancel
            </Button>
            <Button onClick={handleAssignSubmit} disabled={updateMutation.isPending} data-testid="button-submit-assign">
              Assign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={followUpDialogOpen} onOpenChange={setFollowUpDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set follow-up date</DialogTitle>
            <DialogDescription>
              Choose when this task should be followed up and who owns the follow-up.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2 space-y-4">
            <div>
              <label className="text-sm font-medium text-foreground mb-1.5 block">Follow-up date</label>
              <Input
                type="date"
                value={followUpDateValue}
                onChange={e => setFollowUpDateValue(e.target.value)}
                data-testid="input-follow-up-date"
              />
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">Follow-up owner</p>
              {staffUsers?.map(s => (
                <label key={s.id} className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm">
                  <Checkbox
                    checked={selectedAssigneeIds.includes(s.id)}
                    onCheckedChange={() => toggleSelectedAssignee(s.id)}
                    data-testid={`checkbox-dashboard-follow-up-assignee-${s.id}`}
                  />
                  <span>{s.name} ({s.role})</span>
                </label>
              ))}
              {staffUsers?.length === 0 && (
                <p className="text-sm text-muted-foreground">No active staff members available.</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFollowUpDialogOpen(false)} data-testid="button-cancel-follow-up">
              Cancel
            </Button>
            <Button
              onClick={handleFollowUpSubmit}
              disabled={updateMutation.isPending || !followUpDateValue || selectedAssigneeIds.length === 0}
              data-testid="button-submit-follow-up"
            >
              Set date
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}
