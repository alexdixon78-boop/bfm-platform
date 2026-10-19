import { type ReactNode, type RefObject, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { usePermissions } from "@/hooks/use-permissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CASE_CLOSURE_REASONS, ENQUIRY_CONTACT_METHODS, type Case, type Party } from "@shared/schema";
import { Check, CheckCircle2, Clock, FilePlus2, Inbox, Mail, Phone, ShieldCheck, ShieldAlert, Shuffle, UserPlus } from "lucide-react";
import {
  deriveIntakeAction,
  deriveIntakeTaskLoadState,
  getFollowUpTiming,
  isOpenIntakeTask,
  selectIntakeTasks,
  type FollowUpTiming,
  type IntakeActionKind,
  type IntakeActionTask,
} from "./enquiry-intake-workflow-card-state";
import { CompletedIntakeFollowUpHistory } from "./intake-completed-follow-up-history";

type PartyWithAddress = Pick<Party, "addressLine1" | "postcode">;
type ShuttleControl = {
  checked: boolean;
  isPending: boolean;
  canEdit: boolean;
  onChange: (checked: boolean) => void;
};

const INTAKE_PROGRESS_STAGES = ["New", "Safeguarding", "Claimed", "Chasing", "Closed"] as const;
type IntakeProgressStage = typeof INTAKE_PROGRESS_STAGES[number];
type IntakeProgressState = "completed" | "current" | "upcoming";
const intakeProgressButtonTestIds: Record<IntakeProgressStage, string> = {
  New: "button-intake-progress-new",
  Claimed: "button-intake-progress-claimed",
  Chasing: "button-intake-progress-chasing",
  Safeguarding: "button-intake-progress-safeguarding",
  Closed: "button-intake-progress-closed",
};

export type IntakeCaseDetail = Case & {
  partyA?: PartyWithAddress;
  parties?: PartyWithAddress[];
  claimedByName?: string | null;
  sourceEnquiry?: {
    enquiryRef: string | null;
    contactMethod: string | null;
    addressLine1: string | null;
    postcode: string | null;
  } | null;
};

type IntakeWorkflowTask = IntakeActionTask & { dueAt?: string | Date | null };
type IntakeWorkflowTaskResponse = {
  items: Array<Omit<IntakeWorkflowTask, "type" | "followUpDate" | "completionNotes">>;
};

function DetailRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className="text-sm mt-0.5">{value}</p>
    </div>
  );
}

function formatDate(dateStr: string | Date): string {
  return new Date(dateStr).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

function formatDateTime(dateStr: string | Date): string {
  return new Date(dateStr).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function londonCalendarDate(value = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(value);
}

function shiftCalendarDate(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function calendarDayDifference(from: string, to: string): number {
  return Math.round((new Date(`${to}T00:00:00.000Z`).getTime() - new Date(`${from}T00:00:00.000Z`).getTime()) / 86_400_000);
}

function formatTaskStatus(status: string | null | undefined): string {
  if (!status) return "Not created yet";
  return status.replace(/_/g, " ");
}

function getChaseTiming(task: IntakeWorkflowTask | undefined): FollowUpTiming {
  return getFollowUpTiming(task);
}

function normaliseIntakeStatus(status: string | null | undefined): IntakeProgressStage {
  return INTAKE_PROGRESS_STAGES.includes(status as IntakeProgressStage)
    ? status as IntakeProgressStage
    : "New";
}

function deriveIntakeProgress(status: string | null | undefined): Record<IntakeProgressStage, IntakeProgressState> {
  const current = normaliseIntakeStatus(status);
  const currentIndex = INTAKE_PROGRESS_STAGES.indexOf(current);
  return INTAKE_PROGRESS_STAGES.reduce((acc, stage, index) => {
    acc[stage] = index < currentIndex ? "completed" : index === currentIndex ? "current" : "upcoming";
    return acc;
  }, {} as Record<IntakeProgressStage, IntakeProgressState>);
}

function getOpenChaseWorkloadCount({
  caseData,
  day5Task,
  day10Task,
  persistentChaseTask,
}: {
  caseData: IntakeCaseDetail;
  day5Task?: IntakeWorkflowTask;
  day10Task?: IntakeWorkflowTask;
  persistentChaseTask?: IntakeWorkflowTask;
}): number {
  const firstContactAttention = caseData.firstContactAttemptedAt ? 0 : 1;
  const openChaseTasks = [day5Task, day10Task, persistentChaseTask].filter((task) => task && task.status !== "completed").length;
  return firstContactAttention + openChaseTasks;
}

function parseChaseCompletionNotes(notes?: string | null): { contactMethod: string | null; reasonOutcome: string | null } {
  if (!notes?.trim()) return { contactMethod: null, reasonOutcome: null };
  const match = notes.match(/^Contact method:\s*(.+?)(?:\n{2,}([\s\S]*))?$/);
  if (!match) return { contactMethod: null, reasonOutcome: notes.trim() };
  return {
    contactMethod: match[1]?.trim() || null,
    reasonOutcome: match[2]?.trim() || null,
  };
}

function isSafeguardingDecidedStatus(status: string | null | undefined): boolean {
  return status === "clear" || status === "concern";
}

function isSafeguardingClearStatus(status: string | null | undefined): boolean {
  return status === "clear";
}

function deriveNextIntakeAction({
  caseData,
  currentChaseTask,
  allowSafeguardingWork = false,
}: {
  caseData: IntakeCaseDetail;
  currentChaseTask?: IntakeWorkflowTask;
  allowSafeguardingWork?: boolean;
}): { title: string; detail: string } {
  const status = normaliseIntakeStatus(caseData.intakeStatus);
  const safeguardingDecided = isSafeguardingDecidedStatus(caseData.safeguardingStatus);
  const safeguardingCleared = isSafeguardingClearStatus(caseData.safeguardingStatus);
  if (caseData.status === "Closed" || caseData.status === "Archived" || status === "Closed") {
    return {
      title: "Intake closed",
      detail: caseData.closureReason ? `Closed as ${caseData.closureReason}.` : "No further intake action is currently required.",
    };
  }
  if (!safeguardingDecided) {
    return {
      title: "Complete safeguarding check",
      detail: "Record No safeguarding concern or Raise safeguarding concern before claim, contact, chase, or closure work continues.",
    };
  }
  if ((!safeguardingCleared || status === "Safeguarding") && !allowSafeguardingWork) {
    return {
      title: "Review safeguarding",
      detail: "Safeguarding concern is active. Resolve the safeguarding position or close intake from this pathway.",
    };
  }
  if (!caseData.claimedBy) {
    return {
      title: "Claim enquiry",
      detail: "A staff member needs to claim this enquiry before intake work can be recorded.",
    };
  }
  if (!caseData.firstContactAttemptedAt) {
    return {
      title: "Record first contact",
      detail: caseData.firstContactDueAt ? `First contact is due ${formatDate(caseData.firstContactDueAt)}.` : "Record the first contact attempt to start the chase path.",
    };
  }
  if (currentChaseTask) {
    return {
      title: "Complete next chase task",
      detail: currentChaseTask.followUpDate ? `${currentChaseTask.title} is due ${formatDate(currentChaseTask.followUpDate)}.` : currentChaseTask.title,
    };
  }
  return {
    title: "Monitor intake progress",
    detail: "No open chase task is currently due. Review safeguarding and closure when ready.",
  };
}

type IntakeProgressTarget = "claim" | "chase" | "safeguarding" | "closure";

function FunctionalIntakeProgress({
  caseData,
  day5Task,
  day10Task,
  persistentChaseTask,
  openChaseWorkloadCount,
  onStageFocus,
}: {
  caseData: IntakeCaseDetail;
  day5Task?: IntakeWorkflowTask;
  day10Task?: IntakeWorkflowTask;
  persistentChaseTask?: IntakeWorkflowTask;
  openChaseWorkloadCount: number;
  onStageFocus: (target: IntakeProgressTarget) => void;
}) {
  const progress = deriveIntakeProgress(caseData.intakeStatus);
  const intakeClosed = normaliseIntakeStatus(caseData.intakeStatus) === "Closed" || caseData.status === "Closed" || caseData.status === "Archived";
  const receivedDate = caseData.enquiryDate ? formatDate(caseData.enquiryDate) : null;
  const chaseDetail = caseData.firstContactAttemptedAt ? "First contact recorded" : "First contact pending";
  const chaseDate = caseData.firstContactAttemptedAt ? formatDate(caseData.firstContactAttemptedAt) : caseData.firstContactDueAt ? `Due ${formatDate(caseData.firstContactDueAt)}` : null;
  const currentOpenChaseTask = intakeClosed ? undefined : [day5Task, day10Task, persistentChaseTask].find((task) => task && task.status !== "completed");
  const chaseBadgeLabel = currentOpenChaseTask
    ? currentOpenChaseTask.type === "enquiry_persistent_follow_up"
      ? "Ongoing"
      : currentOpenChaseTask.title.includes("Day 10")
        ? "Day 10"
        : "Day 5"
    : openChaseWorkloadCount > 0
      ? "Contact"
      : null;
  const safeguardingLabel = caseData.safeguardingStatus
    ? `Safeguarding check ${caseData.safeguardingStatus}`
    : "Safeguarding check";
  const closureDetail = caseData.closureReason ? `Closed as ${caseData.closureReason}` : "Intake closed";
  const stageMeta: Record<IntakeProgressStage, {
    icon: ReactNode;
    detail: string;
    date?: string | null;
    target?: IntakeProgressTarget;
  }> = {
    New: {
      icon: <FilePlus2 className="h-5 w-5" />,
      detail: "Enquiry received",
      date: receivedDate,
    },
    Claimed: {
      icon: <UserPlus className="h-5 w-5" />,
      detail: caseData.claimedByName ? `Claimed by ${caseData.claimedByName}` : caseData.claimedBy ? "Claimed" : "Not claimed",
      date: caseData.claimedAt ? formatDate(caseData.claimedAt) : null,
      target: "claim",
    },
    Chasing: {
      icon: <Mail className="h-5 w-5" />,
      detail: chaseDetail,
      date: chaseDate,
      target: "chase",
    },
    Safeguarding: {
      icon: caseData.safeguardingStatus === "clear" ? <ShieldCheck className="h-5 w-5" /> : <ShieldAlert className="h-5 w-5" />,
      detail: safeguardingLabel,
      date: caseData.safeguardingStatus === "clear" ? "Clear" : null,
      target: "safeguarding",
    },
    Closed: {
      icon: <Check className="h-5 w-5" />,
      detail: closureDetail,
      date: caseData.intakeStatus === "Closed" && caseData.lastUpdated ? formatDate(caseData.lastUpdated) : null,
      target: "closure",
    },
  };

  return (
    <div className="overflow-x-auto rounded-lg border bg-background p-4" data-testid="functional-intake-progress">
      <div className="min-w-[760px]">
        <div className="grid grid-cols-5">
          {INTAKE_PROGRESS_STAGES.map((stage, index) => {
            const state = progress[stage];
            const meta = stageMeta[stage];
            const isSafeguardingCurrent = stage === "Safeguarding" && state === "current";
            const nodeClass = state === "completed"
              ? "border-[#a7baa4] bg-[#eef5ec] text-[#5a7d58]"
              : isSafeguardingCurrent
                ? "border-destructive bg-destructive text-destructive-foreground"
                : state === "current"
                  ? "border-[#b85c5c] bg-[#b85c5c] text-white shadow-md"
                  : "border-border bg-muted/40 text-muted-foreground";
            const lineClass = state === "completed" ? "bg-[#5a7d58]" : state === "current" ? "bg-[#b85c5c]" : "border-t border-dashed border-muted-foreground/35";
            const labelClass = state === "upcoming" ? "text-muted-foreground" : "text-foreground";
            const target = meta.target;
            return (
              <div key={stage} className="relative px-2 text-center" data-testid={`intake-progress-step-${stage}`}>
                <div className="relative mb-3 flex h-14 items-center justify-center">
                  {index > 0 && <div className={`absolute left-0 right-1/2 top-1/2 h-px ${lineClass}`} />}
                  {index < INTAKE_PROGRESS_STAGES.length - 1 && <div className={`absolute left-1/2 right-0 top-1/2 h-px ${lineClass}`} />}
                  <button
                    type="button"
                    disabled={!target}
                    onClick={() => target && onStageFocus(target)}
                    className={`relative z-10 flex h-12 w-12 items-center justify-center rounded-full border-2 transition-colors ${nodeClass} ${target ? "hover:ring-2 hover:ring-[#a7baa4]/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5a7d58]" : "cursor-default"}`}
                    data-testid={intakeProgressButtonTestIds[stage]}
                    aria-label={`${stage} stage`}
                  >
                    {state === "completed" ? <CheckCircle2 className="h-5 w-5" /> : meta.icon}
                  </button>
                  {stage === "Chasing" && openChaseWorkloadCount > 0 && (
                    <span className="absolute left-1/2 top-0 z-20 ml-3 flex h-6 min-w-6 items-center justify-center rounded-full bg-[#d8c7b7] px-1.5 text-xs font-semibold text-[#5f4b3e]" data-testid="badge-open-chase-workload">
                      {openChaseWorkloadCount}
                    </span>
                  )}
                </div>
                <div className="min-h-[86px] space-y-1">
                  <p className={`text-sm font-medium ${labelClass}`}>{stage}</p>
                  <p className="text-xs text-muted-foreground">{meta.detail}</p>
                  {meta.date && (
                    <p className={stage === "Chasing" && chaseBadgeLabel ? "mx-auto inline-flex rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs font-medium text-red-700" : "text-xs text-muted-foreground"}>
                      {stage === "Chasing" && chaseBadgeLabel ? `${chaseBadgeLabel} - ${getChaseTiming(currentOpenChaseTask)}` : meta.date}
                    </p>
                  )}
                  {state === "current" && (
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Current</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function IntakeChaseStep({
  title,
  status,
  detail,
  note,
  completedAt,
  onClick,
  actionLabel,
  highlighted = false,
}: {
  title: string;
  status: string;
  detail: string;
  note?: string | null;
  completedAt?: string | Date | null;
  onClick?: () => void;
  actionLabel?: string;
  highlighted?: boolean;
}) {
  const parsedNotes = parseChaseCompletionNotes(note);
  const rowClass = highlighted
    ? "rounded-md border border-[#b8825a] bg-[#fff7ed] p-3 space-y-1 text-left shadow-sm"
    : "rounded-md border bg-background p-3 space-y-1 text-left";
  const badgeVariant = status === "Completed" || status === "Recorded" ? "default" : status === "Overdue" ? "destructive" : "secondary";
  const content = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{title}</p>
        <Badge variant={badgeVariant} className="capitalize">
          {status}
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground">{detail}</p>
      {status === "Completed" && parsedNotes.contactMethod && (
        <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">Contact method:</span> {parsedNotes.contactMethod}</p>
      )}
      {status === "Completed" && parsedNotes.reasonOutcome && (
        <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">Reason/outcome:</span> {parsedNotes.reasonOutcome}</p>
      )}
      {status === "Completed" && completedAt && (
        <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">Completed:</span> {formatDateTime(completedAt)}</p>
      )}
      {note && status !== "Completed" && <p className="text-xs text-muted-foreground">Notes: {note}</p>}
      {actionLabel && <p className="text-xs font-medium text-[#5a7d58]">{actionLabel}</p>}
    </>
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={`${rowClass} hover:bg-muted/40 transition-colors`}>
        {content}
      </button>
    );
  }
  return (
    <div className={rowClass}>
      {content}
    </div>
  );
}

function getSafeguardingStatusMeta(status: string | null | undefined) {
  if (status === "clear") {
    return {
      label: "Clear",
      icon: <ShieldCheck className="h-4 w-4" />,
      panelClass: "border-[#a7baa4]/60 bg-[#a7baa4]/10",
      iconClass: "bg-[#a7baa4]/20 text-[#5a7d58]",
      badgeClass: "border-[#a7baa4]/60 bg-white/80 text-[#5a7d58]",
      help: "No safeguarding concern is currently recorded. Claim and contact actions can continue.",
    };
  }
  if (status === "concern") {
    return {
      label: "Concern raised",
      icon: <ShieldAlert className="h-4 w-4" />,
      panelClass: "border-red-200 bg-red-50/50",
      iconClass: "bg-red-100 text-red-700",
      badgeClass: "border-red-200 bg-white/80 text-red-700",
      help: "Safeguarding concern is active. Standard chase and client follow-up messaging are stopped.",
    };
  }
  return {
    label: "Pending",
    icon: <ShieldAlert className="h-4 w-4" />,
    panelClass: "border-amber-200 bg-amber-50/50",
    iconClass: "bg-amber-100 text-amber-700",
    badgeClass: "border-amber-200 bg-white/80 text-amber-700",
    help: "Record the safeguarding position before intake work continues.",
  };
}

function SafeguardingGatePanel({
  sectionRef,
  caseData,
  safeguardingNotes,
  setSafeguardingNotes,
  canWorkSafeguarding,
  safeguardingMutation,
  notifyRebeccaMutation,
  shuttleControl,
}: {
  sectionRef: RefObject<HTMLDivElement>;
  caseData: IntakeCaseDetail;
  safeguardingNotes: string;
  setSafeguardingNotes: (notes: string) => void;
  canWorkSafeguarding: boolean;
  safeguardingMutation: { isPending: boolean; mutate: (status: "clear" | "concern") => void };
  notifyRebeccaMutation: { isPending: boolean; mutate: () => void };
  shuttleControl?: ShuttleControl;
}) {
  const meta = getSafeguardingStatusMeta(caseData.safeguardingStatus);

  return (
    <div ref={sectionRef} tabIndex={-1} className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5a7d58]" data-testid="section-intake-safeguarding">
      <div className={`rounded-lg border p-4 ${meta.panelClass}`} data-testid="panel-safeguarding-gate">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${meta.iconClass}`}>
              {meta.icon}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold">Safeguarding</p>
                <Badge variant="outline" className={meta.badgeClass} data-testid="badge-safeguarding-status">
                  {meta.label}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground" data-testid="safeguarding-status-help">
                {meta.help}
              </p>
            </div>
          </div>
          <Button type="button" size="sm" variant="secondary" className="w-full justify-start sm:w-auto" disabled={notifyRebeccaMutation.isPending || !canWorkSafeguarding} onClick={() => notifyRebeccaMutation.mutate()} data-testid="button-notify-rebecca">
            <Mail className="w-4 h-4 mr-2" />
            Notify Rebecca
          </Button>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px]">
          <div className="space-y-1.5">
            <Label htmlFor="safeguarding-notes">Safeguarding notes</Label>
            <Textarea id="safeguarding-notes" rows={3} value={safeguardingNotes} onChange={(event) => setSafeguardingNotes(event.target.value)} placeholder="Record the decision, context, or follow-up needed" disabled={!canWorkSafeguarding} data-testid="input-safeguarding-notes" />
          </div>
          <div className="rounded-md border bg-background/70 px-3 py-2 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">National Domestic Abuse Helpline</p>
            <p className="mt-1 text-red-700">0808 2000 247</p>
          </div>
        </div>

        {caseData.safeguardingStatus === "clear" && (
          <p className="mt-3 rounded-md border border-[#a7baa4]/50 bg-white/80 px-3 py-2 text-xs text-[#5a7d58]" data-testid="safeguarding-clear-confirmation">
            No safeguarding concern recorded. Claim and contact actions are available.
          </p>
        )}

        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <Button type="button" size="sm" variant="outline" className="justify-start" disabled={safeguardingMutation.isPending || !canWorkSafeguarding} onClick={() => safeguardingMutation.mutate("clear")} data-testid="button-safeguarding-clear">
            <CheckCircle2 className="w-4 h-4 mr-2" />
            No safeguarding concern
          </Button>
          <Button type="button" size="sm" variant="destructive" className="justify-start" disabled={safeguardingMutation.isPending || !canWorkSafeguarding} onClick={() => safeguardingMutation.mutate("concern")} data-testid="button-safeguarding-concern">
            <ShieldAlert className="w-4 h-4 mr-2" />
            Raise concern
          </Button>
        </div>

        {shuttleControl && (
          <div className="mt-4 rounded-md border bg-background/80 px-3 py-3" data-testid="section-case-safeguarding-shuttle">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-semibold flex items-center gap-2">
                  <Shuffle className="w-4 h-4 text-amber-600" />
                  Shuttle mediation
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  When enabled, "SHUTTLE" is automatically added to the case reference and client references.
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <Label htmlFor="shuttle-mediation" className="text-sm cursor-pointer">
                  {shuttleControl.checked ? "Enabled" : "Enable"}
                </Label>
                <Switch
                  id="shuttle-mediation"
                  checked={shuttleControl.checked}
                  onCheckedChange={shuttleControl.onChange}
                  disabled={shuttleControl.isPending || !shuttleControl.canEdit}
                  data-testid="switch-shuttle-mediation"
                />
              </div>
            </div>
            {shuttleControl.checked && (
              <Badge variant="outline" className="mt-3 text-amber-700 border-amber-300 bg-amber-50 text-xs">
                <Shuffle className="w-3 h-3 mr-1" /> SHUTTLE appended to all references
              </Badge>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function TerminalIntakeReadOnly({ caseData, intakeTasks }: { caseData: IntakeCaseDetail; intakeTasks: IntakeWorkflowTask[] }) {
  const intakeHistoryTasks = intakeTasks
    .filter((task) => task.type === "enquiry_chase" || task.type === "enquiry_persistent_follow_up")
    .sort((a, b) => new Date(a.followUpDate || a.createdAt || 0).getTime() - new Date(b.followUpDate || b.createdAt || 0).getTime());
  const historyTitle = (task: IntakeWorkflowTask) => {
    if (task.type === "enquiry_persistent_follow_up") return "Ongoing - Weekly follow-up";
    const text = `${task.title} ${task.message || ""}`.toLowerCase();
    return text.includes("day 10") || text.includes("day-10") ? "Day 10 - Final chase" : "Day 5 - Follow-up chase";
  };
  const historyDetail = (task: IntakeWorkflowTask) => {
    const due = task.followUpDate ? `Due ${formatDate(task.followUpDate)}` : "No due date set";
    const completed = task.completedAt ? ` Completed ${formatDateTime(task.completedAt)}.` : "";
    return `Task status: ${formatTaskStatus(task.status)}. ${due}.${completed}`;
  };

  return (
    <div className="space-y-4" data-testid="intake-terminal-read-only-workflow">
      <div data-testid="section-intake-claim-first-contact">
      <div className="rounded-lg border bg-background p-4" data-testid="panel-claim-first-contact">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[#a7baa4]/20 text-[#5a7d58]"><Phone className="h-4 w-4" /></div>
          <div className="min-w-0">
            <p className="text-sm font-semibold">Claim and next intake action</p>
            <p className="text-xs text-muted-foreground">This intake workflow is closed and read-only.</p>
          </div>
        </div>
        <div className="mt-4 rounded-md border border-[#a7baa4]/50 bg-[#a7baa4]/10 px-3 py-3 text-sm" data-testid="intake-next-action-terminal">
          <p className="font-medium">Intake closed</p>
          <p className="mt-1 text-xs text-muted-foreground">{caseData.closureReason ? `Closed as ${caseData.closureReason}.` : "No further intake action is required."}</p>
        </div>
        {caseData.firstContactAttemptedAt && (
          <div className="mt-4 rounded-md border bg-muted/30 px-3 py-3 text-xs" data-testid="intake-first-contact-summary">
            <p className="font-medium text-sm">Day 0 - First contact recorded</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              <DetailRow label="Recorded" value={formatDateTime(caseData.firstContactAttemptedAt)} />
              <DetailRow label="Method" value={caseData.firstContactMethod || "Not recorded"} />
              <DetailRow label="Notes" value={caseData.firstContactNotes || "No notes recorded"} />
            </div>
          </div>
        )}
      </div>
      </div>

      <div className="rounded-lg border p-4 space-y-3" data-testid="section-intake-chase-status">
        <div>
          <p className="text-sm font-medium">Intake chase status</p>
          <p className="text-xs text-muted-foreground">Completed workflow history is read-only.</p>
        </div>
        <div className="rounded-md border border-[#a7baa4]/50 bg-[#a7baa4]/10 px-3 py-3 text-sm" data-testid="intake-chase-closed-summary">
          <p className="font-medium text-foreground">No further chase required</p>
          <p className="mt-1 text-xs text-muted-foreground">{caseData.closureReason ? `Closed as ${caseData.closureReason}.` : "Intake has been closed."}</p>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <IntakeChaseStep
            title="Day 0 - First contact"
            status={caseData.firstContactAttemptedAt ? "Recorded" : "Pending"}
            detail={caseData.firstContactAttemptedAt ? `Recorded on ${formatDateTime(caseData.firstContactAttemptedAt)}. First contact attempt logged on the case timeline.` : "No first contact attempt recorded yet."}
          />
          {intakeHistoryTasks.map((task) => (
            <div key={task.id} data-testid={task.type === "enquiry_persistent_follow_up" ? "chase-step-persistent-follow-up" : undefined}>
              <IntakeChaseStep title={historyTitle(task)} status={task.status === "completed" ? "Completed" : "Closed"} detail={historyDetail(task)} note={task.completionNotes} completedAt={task.completedAt} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function IntakeWorkflowCard({
  caseData,
  caseId,
  onWorkflowUpdated,
  mode = "full",
  shuttleControl,
}: {
  caseData: IntakeCaseDetail;
  caseId: string;
  onWorkflowUpdated?: () => void;
  mode?: "full" | "safeguarding-only";
  shuttleControl?: ShuttleControl;
}) {
  const { canEdit } = usePermissions();
  const { toast } = useToast();
  const { user } = useAuth();
  const primaryParty = caseData.partyA || caseData.parties?.[0];
  const claimFirstContactRef = useRef<HTMLDivElement>(null);
  const chaseStatusRef = useRef<HTMLDivElement>(null);
  const safeguardingRef = useRef<HTMLDivElement>(null);
  const closureRef = useRef<HTMLDivElement>(null);
  const [firstContactMethod, setFirstContactMethod] = useState<string>("Phone call");
  const [firstContactNotes, setFirstContactNotes] = useState("");
  const [safeguardingNotes, setSafeguardingNotes] = useState(caseData.safeguardingNotes || "");
  const [closureReason, setClosureReason] = useState<string>(caseData.closureReason || CASE_CLOSURE_REASONS[0]);
  const [intakeClosureDetails, setIntakeClosureDetails] = useState(caseData.closureDetails || "");
  const [chaseContactMethod, setChaseContactMethod] = useState<string>("Phone call");
  const [chaseNotes, setChaseNotes] = useState("");
  const [nextFollowUpDays, setNextFollowUpDays] = useState("1");
  const [nextFollowUpDate, setNextFollowUpDate] = useState(() => shiftCalendarDate(londonCalendarDate(), 1));
  const [followUpStartTime, setFollowUpStartTime] = useState("");
  const [followUpEndTime, setFollowUpEndTime] = useState("");
  const [followUpAssigneeIds, setFollowUpAssigneeIds] = useState<string[]>([]);
  const isOtherClosureReason = closureReason === "Other";
  const otherClosureExplanationMissing = isOtherClosureReason && !intakeClosureDetails.trim();

  const intakeTaskQuery = useQuery<IntakeWorkflowTaskResponse>({
    queryKey: ["/api/cases", caseId, "intake", "tasks"],
    queryFn: async () => {
      const res = await fetch(`/api/cases/${caseId}/intake/tasks`, { credentials: "include" });
      if (!res.ok) throw new Error("BFM could not load the intake history");
      const payload = await res.json();
      if (!payload || !Array.isArray(payload.items)) throw new Error("BFM could not load the intake history");
      return payload;
    },
    enabled: !!caseId && mode !== "safeguarding-only",
  });
  const staffUsersQuery = useQuery<Array<{ id: string; name: string; role: string; status: string }>>({
    queryKey: ["/api/users", "intake-follow-up-assignees"],
    queryFn: async () => {
      const response = await fetch("/api/users", { credentials: "include" });
      if (!response.ok) throw new Error("Could not load staff");
      return response.json();
    },
    enabled: mode !== "safeguarding-only",
  });
  const followUpAssignees = (staffUsersQuery.data ?? []).filter((person) => person.status === "active" && ["superadmin", "subadmin", "staff"].includes(person.role));
  const minimumFollowUpDate = shiftCalendarDate(londonCalendarDate(), 1);
  const followUpDaysNumber = Number(nextFollowUpDays);
  const followUpDateMatchesDays = Number.isInteger(followUpDaysNumber) && followUpDaysNumber > 0
    && nextFollowUpDate === shiftCalendarDate(londonCalendarDate(), followUpDaysNumber);
  const followUpTimeIsValid = (!followUpStartTime && !followUpEndTime)
    || (!!followUpStartTime && !!followUpEndTime && followUpEndTime > followUpStartTime);
  const followUpScheduleIsValid = followUpDateMatchesDays && nextFollowUpDate >= minimumFollowUpDate && followUpTimeIsValid;
  const followUpScheduleError = !Number.isInteger(followUpDaysNumber) || followUpDaysNumber < 1
    ? "Enter a positive whole number of days."
    : !nextFollowUpDate || nextFollowUpDate < minimumFollowUpDate
      ? "Choose a future follow-up date."
      : !followUpDateMatchesDays
        ? "The follow-up date and number of days must match."
        : (!!followUpStartTime !== !!followUpEndTime)
          ? "Enter both a start and end time, or leave both blank."
          : followUpStartTime && followUpEndTime && followUpEndTime <= followUpStartTime
            ? "The end time must be after the start time."
            : null;
  const changeFollowUpDays = (value: string) => {
    setNextFollowUpDays(value);
    const days = Number(value);
    if (Number.isInteger(days) && days > 0) setNextFollowUpDate(shiftCalendarDate(londonCalendarDate(), days));
  };
  const changeFollowUpDate = (value: string) => {
    setNextFollowUpDate(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const days = calendarDayDifference(londonCalendarDate(), value);
      if (days > 0) setNextFollowUpDays(String(days));
    }
  };
  const intakeTasks: IntakeWorkflowTask[] = (intakeTaskQuery.data?.items ?? []).map((task) => ({
    ...task,
    type: task.stage === "dynamic" ? "enquiry_dynamic_follow_up" : task.stage === "weekly"
      ? "enquiry_persistent_follow_up"
      : task.stage === "day0"
        ? "enquiry_follow_up"
        : "enquiry_chase",
    followUpDate: task.dueAt ?? null,
    completionNotes: task.contactMethod
      ? `Contact method: ${task.contactMethod}${task.outcomeNotes ? `\n\n${task.outcomeNotes}` : ""}`
      : task.outcomeNotes ?? null,
  }));
  const intakeTaskLoadState = deriveIntakeTaskLoadState({
    hasData: !!intakeTaskQuery.data,
    isError: intakeTaskQuery.isError,
    isFetching: intakeTaskQuery.isFetching,
  });
  const hasUsableIntakeTaskHistory = intakeTaskLoadState === "ready" || intakeTaskLoadState === "stale_error";

  const refreshCase = () => {
    onWorkflowUpdated?.();
    queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId] });
    queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
    queryClient.invalidateQueries({ queryKey: ["/api/enquiries"] });
    queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "activities"] });
    queryClient.invalidateQueries({ queryKey: ["/api/audit-logs"] });
    queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "intake", "tasks"] });
    queryClient.invalidateQueries({ queryKey: ["/api/tasks", caseId, "intake-chase"] });
    queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
    queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
  };

  const claimMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PATCH", `/api/cases/${caseId}/intake/claim`, {});
    },
    onSuccess: () => {
      refreshCase();
      toast({ title: "Enquiry claimed" });
    },
    onError: (err: Error) => {
      toast({ title: "Could not claim enquiry", description: err.message, variant: "destructive" });
    },
  });

  const firstContactMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PATCH", `/api/cases/${caseId}/intake/first-contact`, {
        contactMethod: firstContactMethod,
        notes: firstContactNotes,
        nextFollowUpDays: Number(nextFollowUpDays),
        nextFollowUpDate,
        assignedUserIds: followUpAssigneeIds,
        timeWindow: followUpStartTime || followUpEndTime ? { startTime: followUpStartTime, endTime: followUpEndTime } : null,
      });
    },
    onSuccess: () => {
      refreshCase();
      setFirstContactNotes("");
      toast({ title: "First contact recorded" });
    },
    onError: (err: Error) => {
      toast({ title: "Could not record first contact", description: err.message, variant: "destructive" });
    },
  });

  const safeguardingMutation = useMutation({
    mutationFn: async (status: "clear" | "concern") => {
      const res = await apiRequest("PATCH", `/api/cases/${caseId}/intake/safeguarding`, {
        status,
        notes: safeguardingNotes,
      });
      return res.json() as Promise<Case>;
    },
    onSuccess: (updated, status) => {
      queryClient.setQueryData<IntakeCaseDetail | undefined>(["/api/cases", caseId], (current) => (
        current ? { ...current, ...updated } : updated as IntakeCaseDetail
      ));
      refreshCase();
      toast({
        title: status === "clear" ? "No safeguarding concern recorded" : "Safeguarding concern raised",
        description: status === "clear"
          ? "Claim and contact actions are now available for this enquiry."
          : "Standard chase is stopped. Shuttle mediation can be enabled separately if needed.",
      });
    },
    onError: (err: Error) => {
      toast({ title: "Could not update safeguarding", description: err.message, variant: "destructive" });
    },
  });

  const notifyRebeccaMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PATCH", `/api/cases/${caseId}/intake/notify-rebecca`, {});
    },
    onSuccess: () => {
      refreshCase();
      toast({ title: "Rebecca notification stamped" });
    },
    onError: (err: Error) => {
      toast({ title: "Could not stamp notification", description: err.message, variant: "destructive" });
    },
  });

  const closeMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PATCH", `/api/cases/${caseId}/intake/close`, {
        closureReason,
        closureDetails: intakeClosureDetails,
      });
    },
    onSuccess: () => {
      refreshCase();
      toast({ title: "Enquiry closed from intake" });
    },
    onError: (err: Error) => {
      toast({ title: "Could not close enquiry intake", description: err.message, variant: "destructive" });
    },
  });

  const revokeClaimMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PATCH", `/api/cases/${caseId}/intake/revoke-claim`, {});
    },
    onSuccess: () => {
      refreshCase();
      toast({ title: "Claim revoked" });
    },
    onError: (err: Error) => {
      toast({ title: "Could not revoke claim", description: err.message, variant: "destructive" });
    },
  });

  const chaseCompletionMutation = useMutation({
    mutationFn: async (task: IntakeWorkflowTask) => {
      const res = await apiRequest("PATCH", `/api/cases/${caseId}/intake/chase-tasks/${task.id}/complete`, {
        contactMethod: chaseContactMethod,
        notes: chaseNotes,
        ...(task.stage === "dynamic" ? { nextFollowUpDays: Number(nextFollowUpDays), nextFollowUpDate, assignedUserIds: followUpAssigneeIds, timeWindow: followUpStartTime || followUpEndTime ? { startTime: followUpStartTime, endTime: followUpEndTime } : null } : {}),
      });
      return res.json();
    },
    onSuccess: () => {
      refreshCase();
      setChaseNotes("");
      toast({ title: "Chase contact recorded" });
    },
    onError: (err: Error) => {
      toast({ title: "Could not record chase contact", description: err.message, variant: "destructive" });
    },
  });

  const canEditCase = canEdit("cases") && caseData.status !== "Closed" && caseData.status !== "Archived";
  const isAdmin = user?.role === "superadmin" || user?.role === "subadmin";
  const isSuperadmin = user?.role === "superadmin";
  const safeguardingOnly = mode === "safeguarding-only";
  const isCurrentClaimant = !!user?.id && caseData.claimedBy === user.id;
  const isClaimedByOtherStaff = !!caseData.claimedBy && !isCurrentClaimant;
  const intakeClosed = normaliseIntakeStatus(caseData.intakeStatus) === "Closed" || caseData.status === "Closed" || caseData.status === "Archived";
  const safeguardingDecided = isSafeguardingDecidedStatus(caseData.safeguardingStatus);
  const safeguardingCleared = isSafeguardingClearStatus(caseData.safeguardingStatus);
  const activeSafeguardingConcern = caseData.safeguardingStatus === "concern";
  const canWorkSafeguarding = canEditCase && (isAdmin || !isClaimedByOtherStaff || isCurrentClaimant);
  const canWorkIntake = canEditCase && safeguardingDecided && (
    isAdmin || (safeguardingCleared && isCurrentClaimant)
  );
  const canCloseIntake = canEditCase && safeguardingDecided && (
    safeguardingCleared ? (isAdmin || isCurrentClaimant) : canWorkSafeguarding
  );
  const intakeLockMessage = !safeguardingDecided
    ? "Complete the safeguarding check before claiming or recording intake work."
    : activeSafeguardingConcern
      ? isAdmin
        ? "Safeguarding concern raised. You can record manual follow-up, but BFM will not send email or WhatsApp and voicemail remains restricted."
        : "Safeguarding concern raised. Standard chase and client follow-up messaging are stopped."
      : !caseData.claimedBy
        ? "Claim this enquiry before recording first contact or chase work."
        : isClaimedByOtherStaff && !isAdmin
          ? "This enquiry is claimed by another staff member."
          : null;
  const claimedLabel = caseData.claimedAt
    ? caseData.claimedByName
      ? `Claimed by ${caseData.claimedByName} on ${formatDateTime(caseData.claimedAt)}`
      : `Claimed on ${formatDateTime(caseData.claimedAt)}`
    : "Not claimed";
  const intakeTaskSelection = selectIntakeTasks(intakeTasks);
  const day5Task = intakeTaskSelection.day5 as IntakeWorkflowTask | undefined;
  const day10Task = intakeTaskSelection.day10 as IntakeWorkflowTask | undefined;
  const persistentChaseTask = intakeTaskSelection.weekly as IntakeWorkflowTask | undefined;
  const openChaseWorkloadCount = intakeClosed ? 0 : getOpenChaseWorkloadCount({ caseData, day5Task, day10Task, persistentChaseTask });
  const canRecordChase = (safeguardingCleared || (isAdmin && activeSafeguardingConcern))
    && ["superadmin", "subadmin", "staff"].includes(user?.role || "")
    && canWorkIntake;
  const intakeAction = deriveIntakeAction(caseData, intakeTasks, new Date(), { allowSafeguardingWork: isAdmin });
  const currentActionKind: IntakeActionKind = intakeAction.kind;
  const currentChaseTask = intakeAction.task as IntakeWorkflowTask | undefined;
  const currentChaseTaskId = currentChaseTask?.id || null;
  const intakeHistoryTasks = intakeTasks
    .filter((task) => !task.superseded && (task.type === "enquiry_chase" || task.type === "enquiry_persistent_follow_up"))
    .sort((a, b) => new Date(a.followUpDate || a.createdAt || 0).getTime() - new Date(b.followUpDate || b.createdAt || 0).getTime());
  const nextAction = deriveNextIntakeAction({ caseData, currentChaseTask, allowSafeguardingWork: isAdmin && activeSafeguardingConcern });
  const chaseTaskDetail = (task: IntakeWorkflowTask | undefined) => {
    if (!task) return caseData.firstContactAttemptedAt ? "Task has not been created." : "Not created yet.";
    if (intakeClosed && task.status !== "completed") return "No further chase required because intake is closed.";
    const due = task.followUpDate ? `Due ${formatDate(task.followUpDate)}` : "No due date set";
    const completed = task.completedAt ? `Completed ${formatDateTime(task.completedAt)}` : null;
    const taskStatus = `Task status: ${formatTaskStatus(task.status)}.`;
    return completed ? `${taskStatus} ${due}. ${completed}.` : `${taskStatus} ${due}.`;
  };
  const chaseStepStatus = (task: IntakeWorkflowTask | undefined) => (
    intakeClosed && task && task.status !== "completed" ? "Closed" : getChaseTiming(task)
  );
  const chaseHistoryTitle = (task: IntakeWorkflowTask) => {
    if (task.type === "enquiry_persistent_follow_up") return "Ongoing - Weekly follow-up";
    if (task.message?.includes("[day-10]") || task.title.includes("Day 10")) return "Day 10 - Final chase";
    return "Day 5 - Follow-up chase";
  };
  const focusIntakeSection = (target: IntakeProgressTarget) => {
    const targetRef = {
      claim: claimFirstContactRef,
      chase: chaseStatusRef,
      safeguarding: safeguardingRef,
      closure: closureRef,
    }[target];
    targetRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    targetRef.current?.focus({ preventScroll: true });
  };
  const canSubmitChase = hasUsableIntakeTaskHistory && canRecordChase && !!currentChaseTask && isOpenIntakeTask(currentChaseTask) && !!chaseContactMethod && !!chaseNotes.trim() && (currentActionKind !== "dynamic" || followUpScheduleIsValid);

  return (
    <>
      <Card data-testid={safeguardingOnly ? "card-case-safeguarding-gate" : "card-intake-workflow"}>
        {!safeguardingOnly && (
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <CardTitle className="text-base font-heading flex items-center gap-2">
                  <Inbox className="w-4 h-4 text-[#b8825a]" />
                  Intake workflow
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-1">Track ownership, first contact, chase, safeguarding, and closure from one workspace.</p>
              </div>
              <Badge variant={caseData.intakeStatus === "Safeguarding" ? "destructive" : caseData.intakeStatus === "Closed" ? "outline" : "secondary"}>
                {caseData.intakeStatus || "New"}
              </Badge>
            </div>
          </CardHeader>
        )}
        <CardContent className={safeguardingOnly ? "p-4" : "space-y-5"}>
          {!safeguardingOnly && (
            <FunctionalIntakeProgress
              caseData={caseData}
              day5Task={day5Task}
              day10Task={day10Task}
              persistentChaseTask={persistentChaseTask}
              openChaseWorkloadCount={openChaseWorkloadCount}
              onStageFocus={focusIntakeSection}
            />
          )}

          {!safeguardingOnly && (
            <div className="rounded-lg border border-[#a7baa4]/40 bg-[#a7baa4]/10 p-4" data-testid="intake-next-action-summary">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#5a7d58] text-white">
                  <Clock className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">Next action</p>
                  <p className="text-base font-semibold text-foreground mt-0.5">{nextAction.title}</p>
                  <p className="text-sm text-muted-foreground mt-1">{nextAction.detail}</p>
                </div>
              </div>
            </div>
          )}

          {!safeguardingOnly && (
            <div className="rounded-lg bg-muted/30 border p-4 space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <DetailRow label="Claimed" value={claimedLabel} />
                <DetailRow label="First contact due" value={caseData.firstContactDueAt ? formatDate(caseData.firstContactDueAt) : "Not set"} />
                <DetailRow label="Safeguarding" value={caseData.safeguardingStatus || "pending"} />
                <DetailRow label="Closure reason" value={caseData.closureReason || "Not closed"} />
              </div>
              <Separator />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <DetailRow label="Source enquiry" value={caseData.sourceEnquiry?.enquiryRef || (caseData.enquiryDate ? `Received ${formatDate(caseData.enquiryDate)}` : "Enquiry case shell")} />
                <DetailRow label="Contact method" value={caseData.sourceEnquiry?.contactMethod || "Not recorded"} />
                <DetailRow label="Address" value={[caseData.sourceEnquiry?.addressLine1 || primaryParty?.addressLine1, caseData.sourceEnquiry?.postcode || primaryParty?.postcode].filter(Boolean).join(", ") || "Not recorded"} />
              </div>
              <p className="text-xs text-muted-foreground">
                Optional demographic data can be completed after login and is not required to capture the enquiry.
              </p>
            </div>
          )}

          {!safeguardingOnly && !canEditCase && intakeClosed ? (
            <TerminalIntakeReadOnly caseData={caseData} intakeTasks={intakeTasks} />
          ) : !canEditCase ? null : (
            <div className="space-y-4">
              <SafeguardingGatePanel
                sectionRef={safeguardingRef}
                caseData={caseData}
                safeguardingNotes={safeguardingNotes}
                setSafeguardingNotes={setSafeguardingNotes}
                canWorkSafeguarding={canWorkSafeguarding}
                safeguardingMutation={safeguardingMutation}
                notifyRebeccaMutation={notifyRebeccaMutation}
                shuttleControl={safeguardingOnly ? shuttleControl : undefined}
              />

              {!safeguardingOnly && (
                <>
                  <div ref={claimFirstContactRef} tabIndex={-1} className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5a7d58]" data-testid="section-intake-claim-first-contact">
                    <div className="flex flex-col rounded-lg border bg-background p-4" data-testid="panel-claim-first-contact">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="flex min-w-0 items-start gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[#a7baa4]/20 text-[#5a7d58]">
                            <Phone className="h-4 w-4" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold">Claim and next intake action</p>
                            <p className="text-xs text-muted-foreground">{nextAction.detail}</p>
                          </div>
                        </div>
                        {isSuperadmin && caseData.claimedBy && currentActionKind !== "terminal" && (
                          <Button type="button" size="sm" variant="ghost" disabled={revokeClaimMutation.isPending} onClick={() => revokeClaimMutation.mutate()} data-testid="button-intake-revoke-claim">
                            Revoke
                          </Button>
                        )}
                      </div>

                      {intakeLockMessage && currentActionKind !== "terminal" && (
                        <div className="mt-4 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">{intakeLockMessage}</div>
                      )}

                      {intakeTaskLoadState === "loading" && (
                        <p className="mt-4 rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground" data-testid="intake-history-loading">
                          Loading intake history…
                        </p>
                      )}

                      {intakeTaskLoadState === "initial_error" && (
                        <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-700" data-testid="intake-history-load-error">
                          <p>BFM could not load the intake history. Follow-up actions are unavailable until it loads.</p>
                          <Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => void intakeTaskQuery.refetch()}>
                            Try again
                          </Button>
                        </div>
                      )}

                      {intakeTaskLoadState === "stale_error" && (
                        <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800" data-testid="intake-history-stale-warning">
                          <p>The saved intake history is shown, but BFM could not check for newer updates.</p>
                          <Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => void intakeTaskQuery.refetch()}>
                            Try again
                          </Button>
                        </div>
                      )}

                      {currentActionKind === "terminal" && (
                        <div className="mt-4 rounded-md border border-[#a7baa4]/50 bg-[#a7baa4]/10 px-3 py-3 text-sm" data-testid="intake-next-action-terminal">
                          <p className="font-medium">{intakeClosed ? "Intake closed" : "Standard chase stopped"}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {intakeClosed ? (caseData.closureReason ? `Closed as ${caseData.closureReason}.` : "No further intake action is required.") : "Safeguarding stopped standard intake follow-up."}
                          </p>
                        </div>
                      )}

                      {currentActionKind === "safeguarding" && (
                        <p className="mt-4 rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground" data-testid="intake-next-action-safeguarding">
                          Complete the safeguarding check above before ownership or contact work can be recorded.
                        </p>
                      )}

                      {currentActionKind === "claim" && (
                        <div className="mt-4">
                          <Button type="button" size="sm" disabled={claimMutation.isPending || !safeguardingCleared || (!isAdmin && isClaimedByOtherStaff)} onClick={() => claimMutation.mutate()} data-testid="button-intake-claim">
                            <UserPlus className="w-4 h-4 mr-2" /> Claim enquiry
                          </Button>
                        </div>
                      )}

                      {currentActionKind === "day0" && (
                        <>
                          {activeSafeguardingConcern && isAdmin && (
                            <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700" data-testid="text-safeguarding-manual-entry-help">
                              This records what you did. BFM will not send an email or WhatsApp message. Do not leave a voicemail.
                            </p>
                          )}
                          <div className="mt-4 grid flex-1 gap-4 md:grid-cols-[240px_minmax(0,1fr)]">
                            <div className="space-y-1.5">
                              <Label htmlFor="first-contact-method">First contact method *</Label>
                              <p className="text-xs text-muted-foreground">Channel used for the first attempt.</p>
                              <Select value={firstContactMethod} onValueChange={setFirstContactMethod} disabled={!canWorkIntake}>
                                <SelectTrigger id="first-contact-method" data-testid="select-first-contact-method"><SelectValue /></SelectTrigger>
                                <SelectContent>{ENQUIRY_CONTACT_METHODS.map(method => <SelectItem key={method} value={method}>{method}</SelectItem>)}</SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-1.5">
                              <Label htmlFor="first-contact-notes">First contact notes</Label>
                              <Textarea id="first-contact-notes" rows={5} className="min-h-[142px]" value={firstContactNotes} onChange={(event) => setFirstContactNotes(event.target.value)} placeholder="Channel, outcome, and next step" disabled={!canWorkIntake} data-testid="input-first-contact-notes" />
                            </div>
                          </div>
                          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="intake-dynamic-follow-up-schedule">
                            <div className="space-y-1.5"><Label htmlFor="next-follow-up-days">Next follow-up in (days) *</Label><Input id="next-follow-up-days" type="number" min="1" step="1" value={nextFollowUpDays} onChange={(event) => changeFollowUpDays(event.target.value)} /></div>
                            <div className="space-y-1.5"><Label htmlFor="next-follow-up-date">Follow-up date *</Label><Input id="next-follow-up-date" type="date" min={minimumFollowUpDate} value={nextFollowUpDate} onChange={(event) => changeFollowUpDate(event.target.value)} /></div>
                            <div className="space-y-1.5"><Label htmlFor="follow-up-start-time">Start time (optional)</Label><Input id="follow-up-start-time" type="time" value={followUpStartTime} onChange={(event) => setFollowUpStartTime(event.target.value)} /></div>
                            <div className="space-y-1.5"><Label htmlFor="follow-up-end-time">End time (optional)</Label><Input id="follow-up-end-time" type="time" value={followUpEndTime} onChange={(event) => setFollowUpEndTime(event.target.value)} /></div>
                          </div>
                          {followUpScheduleError && <p className="mt-2 text-xs text-destructive" role="alert">{followUpScheduleError}</p>}
                            <div className="mt-3 space-y-2"><Label>Assign follow-up to</Label><p className="text-xs text-muted-foreground">Optional. Leave blank to alert all administrators on the due day; no calendar event is created until staff are assigned.</p><div className="flex flex-wrap gap-3">{followUpAssignees.map((person) => <label key={person.id} className="flex items-center gap-2 text-sm"><Checkbox checked={followUpAssigneeIds.includes(person.id)} onCheckedChange={(checked) => setFollowUpAssigneeIds((ids) => checked ? Array.from(new Set([...ids, person.id])) : ids.filter((id) => id !== person.id))} />{person.name}</label>)}</div></div>
                          <div className="mt-4">
                            <Button type="button" className="w-full sm:w-auto" disabled={firstContactMutation.isPending || !canWorkIntake || !followUpScheduleIsValid} onClick={() => firstContactMutation.mutate()} data-testid="button-intake-first-contact">
                              <Phone className="w-4 h-4 mr-2" /> Record first contact
                            </Button>
                          </div>
                        </>
                      )}

                      {intakeAction.firstContact && currentActionKind !== "day0" && (
                        <div className="mt-4 rounded-md border bg-muted/30 px-3 py-3 text-xs" data-testid="intake-first-contact-summary">
                          <p className="font-medium text-sm">Day 0 - First contact recorded</p>
                          <div className="mt-2 grid gap-2 sm:grid-cols-3">
                            <DetailRow label="Recorded" value={formatDateTime(intakeAction.firstContact.attemptedAt)} />
                            <DetailRow label="Method" value={intakeAction.firstContact.method || "Not recorded"} />
                            <DetailRow label="Notes" value={intakeAction.firstContact.notes || "No notes recorded"} />
                          </div>
                        </div>
                      )}

                      {hasUsableIntakeTaskHistory && (
                        <CompletedIntakeFollowUpHistory
                          tasks={intakeTasks}
                          onViewFullHistory={() => focusIntakeSection("chase")}
                        />
                      )}

                      {hasUsableIntakeTaskHistory && currentChaseTask && (["day5", "day10", "weekly", "dynamic"] as IntakeActionKind[]).includes(currentActionKind) && (
                        <div className="mt-4" data-testid="intake-current-follow-up-form">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-sm font-semibold">{currentActionKind === "dynamic" ? "Follow-up" : currentActionKind === "weekly" ? "Weekly follow-up" : currentActionKind === "day10" ? "Day 10 follow-up" : "Day 5 follow-up"}</p>
                            <Badge variant={getChaseTiming(currentChaseTask) === "Overdue" ? "destructive" : "secondary"}>{getChaseTiming(currentChaseTask)}</Badge>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">{currentChaseTask.followUpDate ? `Scheduled due ${formatDate(currentChaseTask.followUpDate)}. You may record this follow-up early.` : "No scheduled due date."}</p>
                          {activeSafeguardingConcern && isAdmin && (
                            <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700" data-testid="text-safeguarding-manual-entry-help">
                              This records what you did. BFM will not send an email or WhatsApp message. Do not leave a voicemail.
                            </p>
                          )}
                          <div className="mt-3 grid gap-4 md:grid-cols-[240px_minmax(0,1fr)]">
                            <div className="space-y-1.5">
                              <Label htmlFor="chase-contact-method">Contact method *</Label>
                              <Select value={chaseContactMethod} onValueChange={setChaseContactMethod} disabled={!canRecordChase}>
                                <SelectTrigger id="chase-contact-method" data-testid="select-chase-contact-method"><SelectValue /></SelectTrigger>
                                <SelectContent>{ENQUIRY_CONTACT_METHODS.map(method => <SelectItem key={method} value={method}>{method}</SelectItem>)}</SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-1.5">
                              <Label htmlFor="chase-notes">Notes *</Label>
                              <Textarea id="chase-notes" rows={4} value={chaseNotes} onChange={(event) => setChaseNotes(event.target.value)} placeholder="Record what happened and the outcome" disabled={!canRecordChase} data-testid="input-chase-notes" />
                            </div>
                          </div>
                          {currentActionKind === "dynamic" && <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="intake-dynamic-follow-up-schedule">
                            <div className="space-y-1.5"><Label htmlFor="next-follow-up-days-complete">Next follow-up in (days) *</Label><Input id="next-follow-up-days-complete" type="number" min="1" step="1" value={nextFollowUpDays} onChange={(event) => changeFollowUpDays(event.target.value)} /></div>
                            <div className="space-y-1.5"><Label htmlFor="next-follow-up-date-complete">Follow-up date *</Label><Input id="next-follow-up-date-complete" type="date" min={minimumFollowUpDate} value={nextFollowUpDate} onChange={(event) => changeFollowUpDate(event.target.value)} /></div>
                            <div className="space-y-1.5"><Label htmlFor="follow-up-start-time-complete">Start time (optional)</Label><Input id="follow-up-start-time-complete" type="time" value={followUpStartTime} onChange={(event) => setFollowUpStartTime(event.target.value)} /></div>
                            <div className="space-y-1.5"><Label htmlFor="follow-up-end-time-complete">End time (optional)</Label><Input id="follow-up-end-time-complete" type="time" value={followUpEndTime} onChange={(event) => setFollowUpEndTime(event.target.value)} /></div>
                          </div>}
                          {currentActionKind === "dynamic" && followUpScheduleError && <p className="mt-2 text-xs text-destructive" role="alert">{followUpScheduleError}</p>}
                          {currentActionKind === "dynamic" && <div className="mt-3 space-y-2"><Label>Assign follow-up to</Label><p className="text-xs text-muted-foreground">Optional. Leave blank to alert all administrators on the due day; no calendar event is created until staff are assigned.</p><div className="flex flex-wrap gap-3">{followUpAssignees.map((person) => <label key={person.id} className="flex items-center gap-2 text-sm"><Checkbox checked={followUpAssigneeIds.includes(person.id)} onCheckedChange={(checked) => setFollowUpAssigneeIds((ids) => checked ? Array.from(new Set([...ids, person.id])) : ids.filter((id) => id !== person.id))} />{person.name}</label>)}</div></div>}
                          <Button type="button" className="mt-4" onClick={() => chaseCompletionMutation.mutate(currentChaseTask)} disabled={!canSubmitChase || chaseCompletionMutation.isPending} data-testid="button-submit-chase-contact">
                            Record {currentActionKind === "dynamic" ? "next" : currentActionKind === "weekly" ? "weekly" : currentActionKind === "day10" ? "Day 10" : "Day 5"} follow-up
                          </Button>
                        </div>
                      )}

                      {hasUsableIntakeTaskHistory && currentActionKind === "none" && (
                        <p className="mt-4 rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground" data-testid="intake-next-action-none">No follow-up currently required.</p>
                      )}
                    </div>
                  </div>

                  <div ref={chaseStatusRef} tabIndex={-1} className="rounded-lg border p-4 space-y-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5a7d58]" data-testid="section-intake-chase-status">
                    <div>
                      <p className="text-sm font-medium">Intake chase status</p>
                      <p className="text-xs text-muted-foreground">Track the Day 0 / Day 5 / Day 10 SOP chase path from this enquiry.</p>
                    </div>
                    {caseData.standardChaseStopped && (
                      <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                        Standard chase stopped due to safeguarding
                      </div>
                    )}
                    {intakeClosed && (
                      <div className="rounded-md border border-[#a7baa4]/50 bg-[#a7baa4]/10 px-3 py-3 text-sm" data-testid="intake-chase-closed-summary">
                        <p className="font-medium text-foreground">No further chase required</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {caseData.closureReason ? `Closed as ${caseData.closureReason}.` : "Intake has been closed."}
                          {caseData.closureDetails ? ` ${caseData.closureDetails}` : ""}
                        </p>
                        {caseData.closureDate && (
                          <p className="mt-1 text-xs text-muted-foreground">Closed {formatDateTime(caseData.closureDate)}</p>
                        )}
                      </div>
                    )}
                    <div className="grid gap-3 md:grid-cols-3">
                      <IntakeChaseStep
                        title="Day 0 - First contact"
                        status={caseData.firstContactAttemptedAt ? "Recorded" : "Pending"}
                        detail={caseData.firstContactAttemptedAt ? `Recorded on ${formatDateTime(caseData.firstContactAttemptedAt)}. First contact attempt logged on the case timeline.` : "No first contact attempt recorded yet."}
                      />
                      {intakeHistoryTasks.map((task) => (
                        <div key={task.id} data-testid={task.type === "enquiry_persistent_follow_up" ? "chase-step-persistent-follow-up" : undefined}>
                          <IntakeChaseStep
                            title={chaseHistoryTitle(task)}
                            status={chaseStepStatus(task)}
                            detail={chaseTaskDetail(task)}
                            note={task.completionNotes}
                            completedAt={task.completedAt}
                            highlighted={currentChaseTaskId === task.id}
                          />
                        </div>
                      ))}
                      {intakeHistoryTasks.length === 0 && caseData.firstContactAttemptedAt && (
                        <IntakeChaseStep title="Follow-up tasks" status="Not created yet" detail="No Day 5, Day 10, or weekly task is currently recorded." />
                      )}
                    </div>
                  </div>

                  <div ref={closureRef} tabIndex={-1} className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5a7d58]" data-testid="section-intake-closure">
                    <div className="flex flex-col rounded-lg border bg-background p-4" data-testid="panel-closure">
                      <div className="flex items-start gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                          <CheckCircle2 className="h-4 w-4" />
                        </div>
                        <div>
                          <p className="text-sm font-semibold">Closure</p>
                          <p className="text-xs text-muted-foreground">Close enquiry intake with a reason and supporting note.</p>
                        </div>
                      </div>
                      <div className="mt-4 space-y-3">
                        <Select value={closureReason} onValueChange={setClosureReason} disabled={!canCloseIntake}>
                          <SelectTrigger data-testid="select-closure-reason">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {CASE_CLOSURE_REASONS.map(reason => <SelectItem key={reason} value={reason}>{reason}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <div className="space-y-2">
                          {isOtherClosureReason && (
                            <Label htmlFor="intake-closure-details" className="text-xs font-medium text-muted-foreground">
                              Other closure reason explanation *
                            </Label>
                          )}
                          <Textarea
                            id="intake-closure-details"
                            rows={3}
                            value={intakeClosureDetails}
                            onChange={(event) => setIntakeClosureDetails(event.target.value)}
                            placeholder={isOtherClosureReason ? "Please explain the other closure reason" : "Supporting closure notes"}
                            disabled={!canCloseIntake}
                            data-testid="input-intake-closure-details"
                          />
                        </div>
                      </div>
                      <div className="mt-auto pt-4">
                        <Button type="button" variant="destructive" className="w-full" disabled={closeMutation.isPending || !safeguardingDecided || otherClosureExplanationMissing || !closureReason || !canCloseIntake} onClick={() => closeMutation.mutate()} data-testid="button-intake-close">
                          Close intake
                        </Button>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>

    </>
  );
}
