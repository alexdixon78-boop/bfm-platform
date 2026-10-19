import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  Briefcase, Calendar, Phone, Mail, MessageSquare, StickyNote, Clock,
  CheckCircle2, XCircle, AlertTriangle, ArrowRight, Plus, Send,
  PhoneCall, MessageCircle, ArrowUpRight, ArrowDownLeft, Loader2,
  ListChecks, UserCheck, RefreshCw, FileText,
} from "lucide-react";
import type { CaseActivity } from "@shared/schema";

type ActorType = "staff" | "client" | "mediator" | "system";

type CaseActivityWithActor = Omit<CaseActivity, "actorType" | "actorChannel"> & {
  actorType?: string | null;
  actorChannel?: string | null;
  actorRoleLabel?: string | null;
};

const ACTOR_TAG_STYLES: Record<ActorType, { fallbackLabel: string; cls: string }> = {
  staff:    { fallbackLabel: "Staff",    cls: "bg-[#a7baa4]/20 text-[#3f5b3d] border border-[#a7baa4]/40" },
  mediator: { fallbackLabel: "Mediator", cls: "bg-[#dcae96]/20 text-[#7a4f2f] border border-[#dcae96]/50" },
  client:   { fallbackLabel: "Client",   cls: "bg-[#b8825a]/15 text-[#7a4f2f] border border-[#b8825a]/30" },
  system:   { fallbackLabel: "System",   cls: "bg-muted text-muted-foreground border border-border" },
};

function ActorLine({ name, type, channel, roleLabel }: { name?: string | null; type?: ActorType | null; channel?: string | null; roleLabel?: string | null }) {
  const resolvedType: ActorType = type || "system";
  const tag = ACTOR_TAG_STYLES[resolvedType];
  const displayName = name?.trim() || (resolvedType === "system" ? "System" : "Unknown");
  const tagText = roleLabel?.trim() || tag.fallbackLabel;
  return (
    <p className="text-xs text-foreground/80 mt-1 flex flex-wrap items-center gap-1.5" data-testid="activity-actor">
      <span className="text-muted-foreground">by</span>
      <span className="font-medium">{displayName}</span>
      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide ${tag.cls}`}>
        {tagText}
      </span>
      {channel && (
        <span className="text-[11px] text-muted-foreground italic">— {channel}</span>
      )}
    </p>
  );
}

const TYPE_CONFIG: Record<string, { icon: typeof Briefcase; color: string; bg: string }> = {
  enquiry_created: { icon: Mail, color: "text-blue-600", bg: "bg-blue-50 border-blue-200" },
  case_created: { icon: Briefcase, color: "text-[#5a7d58]", bg: "bg-[#a7baa4]/10 border-[#a7baa4]/30" },
  appointment_held: { icon: Clock, color: "text-amber-600", bg: "bg-amber-50 border-amber-200" },
  appointment_confirmed: { icon: CheckCircle2, color: "text-[#5a7d58]", bg: "bg-[#a7baa4]/10 border-[#a7baa4]/30" },
  appointment_cancelled: { icon: XCircle, color: "text-red-600", bg: "bg-red-50 border-red-200" },
  appointment_expired: { icon: AlertTriangle, color: "text-orange-600", bg: "bg-orange-50 border-orange-200" },
  appointment_completed: { icon: CheckCircle2, color: "text-[#5a7d58]", bg: "bg-[#a7baa4]/10 border-[#a7baa4]/30" },
  email_sent: { icon: Send, color: "text-blue-600", bg: "bg-blue-50 border-blue-200" },
  call_logged: { icon: PhoneCall, color: "text-purple-600", bg: "bg-purple-50 border-purple-200" },
  whatsapp_logged: { icon: MessageCircle, color: "text-green-600", bg: "bg-green-50 border-green-200" },
  note_added: { icon: StickyNote, color: "text-amber-600", bg: "bg-amber-50 border-amber-200" },
  miam_submitted: { icon: FileText, color: "text-blue-600", bg: "bg-blue-50 border-blue-200" },
  miam_approved: { icon: CheckCircle2, color: "text-[#5a7d58]", bg: "bg-[#a7baa4]/10 border-[#a7baa4]/30" },
  miam_rejected: { icon: XCircle, color: "text-red-600", bg: "bg-red-50 border-red-200" },
  miam_flagged: { icon: AlertTriangle, color: "text-orange-600", bg: "bg-orange-50 border-orange-200" },
  draft_financial_schedule_saved: { icon: FileText, color: "text-blue-600", bg: "bg-blue-50 border-blue-200" },
  draft_financial_schedule_confirmed: { icon: CheckCircle2, color: "text-[#5a7d58]", bg: "bg-[#a7baa4]/10 border-[#a7baa4]/30" },
  stage_changed: { icon: ArrowRight, color: "text-[#b8825a]", bg: "bg-[#dcae96]/10 border-[#dcae96]/30" },
  task_created: { icon: ListChecks, color: "text-blue-600", bg: "bg-blue-50 border-blue-200" },
  task_assigned: { icon: UserCheck, color: "text-purple-600", bg: "bg-purple-50 border-purple-200" },
  task_status_changed: { icon: RefreshCw, color: "text-[#b8825a]", bg: "bg-[#dcae96]/10 border-[#dcae96]/30" },
  task_completed: { icon: CheckCircle2, color: "text-[#5a7d58]", bg: "bg-[#a7baa4]/10 border-[#a7baa4]/30" },
  mediation_session_proposal_link_resent: { icon: Send, color: "text-blue-600", bg: "bg-blue-50 border-blue-200" },
};

function formatActivityDate(date: string | Date): string {
  const d = new Date(date);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function formatFullDate(date: string | Date): string {
  const d = new Date(date);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) +
    " at " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
}

interface ActivityTimelineProps {
  caseId: string;
  isStaff: boolean;
  compact?: boolean;
  maxItems?: number;
}

export function ActivityTimeline({ caseId, isStaff, compact = false, maxItems }: ActivityTimelineProps) {
  const [showForm, setShowForm] = useState(false);

  const queryLimit = maxItems || 100;
  const { data, isLoading, isError } = useQuery<{ data: CaseActivityWithActor[]; total: number }>({
    queryKey: ["/api/cases", caseId, "activities", { limit: queryLimit }],
    queryFn: async () => {
      const res = await fetch(`/api/cases/${caseId}/activities?limit=${queryLimit}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch activities");
      return res.json();
    },
  });

  const activities = data?.data || [];
  const total = data?.total || 0;

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center" data-testid="activity-timeline-error">
        <Calendar className="w-10 h-10 text-red-400/60 mb-3" />
        <p className="text-sm font-medium text-muted-foreground">Failed to load activity</p>
        <p className="text-xs text-muted-foreground mt-1">Please try refreshing the page</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: compact ? 3 : 5 }).map((_, i) => (
          <div key={i} className="flex gap-3">
            <Skeleton className="w-8 h-8 rounded-full flex-shrink-0" />
            <div className="flex-1 space-y-1">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="activity-timeline">
      {isStaff && !compact && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {total} event{total !== 1 ? "s" : ""} recorded
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowForm(!showForm)}
            data-testid="button-log-communication"
          >
            <Plus className="w-4 h-4 mr-1" />
            Log Communication
          </Button>
        </div>
      )}

      {showForm && isStaff && (
        <LogCommunicationForm caseId={caseId} onClose={() => setShowForm(false)} />
      )}

      {activities.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <Calendar className="w-10 h-10 text-muted-foreground/40 mb-3" />
          <p className="text-sm font-medium text-muted-foreground">No activity recorded yet</p>
          <p className="text-xs text-muted-foreground mt-1">Events will appear here as the case progresses</p>
        </div>
      ) : (
        <div className="relative">
          <div className="absolute left-4 top-0 bottom-0 w-px bg-border" />
          <div className="space-y-0">
            {activities.map((activity, index) => {
              const config = TYPE_CONFIG[activity.type] || TYPE_CONFIG.case_created;
              const Icon = config.icon;
              const isLast = index === activities.length - 1;

              return (
                <div
                  key={activity.id}
                  className={`relative flex gap-3 ${isLast ? "" : "pb-4"}`}
                  data-testid={`activity-item-${activity.id}`}
                >
                  <div className={`relative z-10 w-8 h-8 rounded-full border flex items-center justify-center flex-shrink-0 ${config.bg}`}>
                    <Icon className={`w-3.5 h-3.5 ${config.color}`} />
                  </div>
                  <div className="flex-1 min-w-0 pt-0.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground leading-tight" data-testid={`activity-title-${activity.id}`}>
                          {activity.title}
                          {activity.direction && (
                            <span className="inline-flex items-center ml-1.5">
                              {activity.direction === "inbound" ? (
                                <ArrowDownLeft className="w-3 h-3 text-blue-500" />
                              ) : (
                                <ArrowUpRight className="w-3 h-3 text-green-600" />
                              )}
                            </span>
                          )}
                        </p>
                        {activity.description && (
                          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed line-clamp-2">
                            {activity.description}
                          </p>
                        )}
                        <ActorLine
                          name={activity.performedByName}
                          type={(activity.actorType as ActorType | null | undefined) ?? null}
                          channel={activity.actorChannel ?? null}
                          roleLabel={activity.actorRoleLabel ?? null}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground whitespace-nowrap flex-shrink-0" title={formatFullDate(activity.occurredAt)}>
                        {formatActivityDate(activity.occurredAt)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!compact && total > activities.length && (
        <p className="text-xs text-muted-foreground text-center pt-2">
          Showing {activities.length} of {total} events
        </p>
      )}
    </div>
  );
}

function LogCommunicationForm({ caseId, onClose }: { caseId: string; onClose: () => void }) {
  const { toast } = useToast();
  const [type, setType] = useState<string>("");
  const [direction, setDirection] = useState<string>("");
  const [summary, setSummary] = useState("");
  const [contactName, setContactName] = useState("");
  const [occurredAt, setOccurredAt] = useState("");

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/cases/${caseId}/activities`, {
        type, direction, summary, contactName: contactName || undefined,
        occurredAt: occurredAt || undefined,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "activities"], exact: false });
      toast({ title: "Communication logged" });
      onClose();
    },
    onError: (err: Error) => {
      toast({ title: "Failed to log communication", description: err.message, variant: "destructive" });
    },
  });

  const isValid = type && direction && summary.trim();

  return (
    <Card className="border-dashed" data-testid="form-log-communication">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-[#b8825a]" />
          Log Communication
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Select value={type} onValueChange={setType}>
            <SelectTrigger data-testid="select-comm-type">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="call_logged">Phone Call</SelectItem>
              <SelectItem value="whatsapp_logged">WhatsApp</SelectItem>
              <SelectItem value="email_sent">Email</SelectItem>
            </SelectContent>
          </Select>

          <Select value={direction} onValueChange={setDirection}>
            <SelectTrigger data-testid="select-comm-direction">
              <SelectValue placeholder="Direction" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="inbound">Inbound</SelectItem>
              <SelectItem value="outbound">Outbound</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Input
            placeholder="Contact name (optional)"
            value={contactName}
            onChange={e => setContactName(e.target.value)}
            data-testid="input-comm-contact"
          />
          <Input
            type="datetime-local"
            value={occurredAt}
            onChange={e => setOccurredAt(e.target.value)}
            data-testid="input-comm-date"
          />
        </div>

        <Textarea
          placeholder="Summary of communication..."
          value={summary}
          onChange={e => setSummary(e.target.value)}
          rows={3}
          data-testid="input-comm-summary"
        />

        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} data-testid="button-cancel-comm">
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => mutation.mutate()}
            disabled={!isValid || mutation.isPending}
            data-testid="button-save-comm"
          >
            {mutation.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Send className="w-4 h-4 mr-1" />}
            Save
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
