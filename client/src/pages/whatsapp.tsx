import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { MessageCircle, Pause, Play, ShieldCheck, Timer } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  WhatsappChatWorkspace,
  type WhatsappChatMessage,
  type WhatsappTemplate,
  type WhatsappTemplateSyncStatus,
} from "@/components/whatsapp/whatsapp-chat-workspace";

type ConversationListItem = {
  id: string;
  status: string;
  flowType: string;
  automationState: string;
  automationPaused: boolean;
  caseId: string | null;
  enquiryId: string | null;
  customerServiceWindowExpiresAt: string | null;
  lastInboundAt: string | null;
  phoneNumber: string | null;
  displayName: string | null;
  verificationStatus: string | null;
  lastMessage: { body: string | null; direction: string; createdAt: string; templateName?: string | null } | null;
};

type ConversationDetail = ConversationListItem & {
  contact: { phoneNumber: string | null; displayName: string | null; verificationStatus: string | null } | null;
  messages: Array<WhatsappChatMessage & { caseId: string | null; partyId: string | null; clientId: string | null }>;
};

type CaseOption = { id: string; caseRef: string };
type CaseParty = { id: string; clientId: string; role: string; firstName?: string | null; lastName?: string | null };

function formatDate(value?: string | null) {
  if (!value) return "No activity";
  return new Date(value).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function windowLabel(value?: string | null) {
  if (!value) return "24-hour closed";
  const expires = new Date(value).getTime();
  if (expires <= Date.now()) return "24-hour closed";
  return `24-hour open until ${formatDate(value)}`;
}

export default function WhatsAppPage() {
  const { toast } = useToast();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [assigningMessageId, setAssigningMessageId] = useState<string | null>(null);
  const [assignmentCaseId, setAssignmentCaseId] = useState("");
  const [assignmentPartyId, setAssignmentPartyId] = useState("");

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("conversation");
    if (requested) setSelectedId(requested);
  }, []);

  const conversationsQuery = useQuery<ConversationListItem[]>({
    queryKey: ["/api/whatsapp/conversations"],
    refetchInterval: 15000,
  });

  const conversations = conversationsQuery.data || [];
  const activeId = selectedId || conversations[0]?.id || null;

  const detailQuery = useQuery<ConversationDetail>({
    queryKey: [`/api/whatsapp/conversations/${activeId}`],
    enabled: Boolean(activeId),
    refetchInterval: 10000,
  });

  const templates = useQuery<WhatsappTemplate[]>({ queryKey: ["/api/whatsapp/templates"] });
  const templateSyncStatus = useQuery<WhatsappTemplateSyncStatus>({ queryKey: ["/api/whatsapp/templates/status"] });
  const detail = detailQuery.data;
  const sortedMessages = useMemo(() => detail?.messages || [], [detail?.messages]);
  const casesQuery = useQuery<{ data?: CaseOption[] } | CaseOption[]>({ queryKey: ["/api/cases", { limit: 100 }], queryFn: async () => { const response = await fetch("/api/cases?limit=100", { credentials: "include" }); if (!response.ok) return []; return response.json(); } });
  const caseOptions = Array.isArray(casesQuery.data) ? casesQuery.data : casesQuery.data?.data || [];
  const assignmentCaseQuery = useQuery<{ parties?: CaseParty[] }>({ queryKey: ["/api/cases", assignmentCaseId], queryFn: async () => { const response = await fetch(`/api/cases/${assignmentCaseId}`, { credentials: "include" }); if (!response.ok) throw new Error("Case unavailable"); return response.json(); }, enabled: Boolean(assignmentCaseId) });

  const sendMutation = useMutation({
    mutationFn: async (payload: { body?: string; template?: WhatsappTemplate; parameters?: Record<string, string> }) => {
      if (!activeId) throw new Error("Select a conversation first");
      const res = await apiRequest("POST", `/api/whatsapp/conversations/${activeId}/messages`, payload.template ? { template: { name: payload.template.name, language: payload.template.language, parameters: payload.parameters || {} } } : { body: payload.body });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/conversations"] });
      if (activeId) queryClient.invalidateQueries({ queryKey: [`/api/whatsapp/conversations/${activeId}`] });
      toast({ title: "WhatsApp message queued" });
    },
    onError: (err: Error) => toast({ title: "Could not send", description: err.message, variant: "destructive" }),
  });

  const syncTemplates = useMutation({ mutationFn: async () => (await apiRequest("POST", "/api/whatsapp/templates/sync")).json(), onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/templates"] }); queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/templates/status"] }); toast({ title: "WhatsApp templates synced" }); }, onError: (error: Error) => toast({ title: "Template sync failed", description: error.message, variant: "destructive" }) });

  const automationMutation = useMutation({
    mutationFn: async (paused: boolean) => {
      if (!activeId) throw new Error("Select a conversation first");
      const res = await apiRequest("PATCH", `/api/whatsapp/conversations/${activeId}/automation`, { paused });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/conversations"] });
      if (activeId) queryClient.invalidateQueries({ queryKey: [`/api/whatsapp/conversations/${activeId}`] });
    },
    onError: (err: Error) => toast({ title: "Automation update failed", description: err.message, variant: "destructive" }),
  });

  const assignmentMutation = useMutation({ mutationFn: async () => { const party = assignmentCaseQuery.data?.parties?.find((item) => item.id === assignmentPartyId); if (!assigningMessageId || !party) throw new Error("Select a case client"); const response = await apiRequest("POST", `/api/whatsapp/messages/${assigningMessageId}/assign-case`, { caseId: assignmentCaseId, partyId: party.id, clientId: party.clientId }); return response.json(); }, onSuccess: () => { setAssigningMessageId(null); setAssignmentCaseId(""); setAssignmentPartyId(""); if (activeId) queryClient.invalidateQueries({ queryKey: [`/api/whatsapp/conversations/${activeId}`] }); toast({ title: "Message assigned to case" }); }, onError: (error: Error) => toast({ title: "Assignment failed", description: error.message, variant: "destructive" }) });

  return (
    <div className="h-full flex flex-col bg-background">
      <div className="px-6 py-4 border-b bg-background">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-normal flex items-center gap-2">
              <MessageCircle className="h-6 w-6 text-emerald-700" />
              WhatsApp
            </h1>
            <p className="text-sm text-muted-foreground mt-1">Staff inbox for Meta WhatsApp conversations, OTP verification, templates, and manual follow-up.</p>
          </div>
          <Badge variant="outline" className="gap-1">
            <Timer className="h-3.5 w-3.5" />
            Polling live
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[340px_minmax(0,1fr)_300px] flex-1 min-h-0">
        <aside className="border-r min-h-0">
          <ScrollArea className="h-full">
            <div className="p-3 space-y-2">
              {conversationsQuery.isLoading && Array.from({ length: 6 }).map((_, idx) => <Skeleton key={idx} className="h-20 w-full" />)}
              {!conversationsQuery.isLoading && conversations.length === 0 && (
                <div className="text-sm text-muted-foreground p-4">No WhatsApp conversations yet.</div>
              )}
              {conversations.map((conversation) => (
                <button
                  key={conversation.id}
                  onClick={() => setSelectedId(conversation.id)}
                  className={`w-full text-left rounded-md border p-3 transition-colors ${activeId === conversation.id ? "bg-muted border-foreground/20" : "hover:bg-muted/60"}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium truncate">{conversation.displayName || conversation.phoneNumber || "WhatsApp client"}</span>
                    <Badge variant={conversation.automationPaused ? "secondary" : "outline"}>{conversation.status}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 truncate">{conversation.phoneNumber}</p>
                  <p className="text-sm mt-2 line-clamp-2">{conversation.lastMessage?.body || conversation.lastMessage?.templateName || conversation.automationState}</p>
                  <p className="text-xs text-muted-foreground mt-2">{formatDate(conversation.lastInboundAt || conversation.lastMessage?.createdAt)}</p>
                </button>
              ))}
            </div>
          </ScrollArea>
        </aside>

        <section className="flex flex-col min-h-0">
          <div className="border-b px-4 py-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium truncate">{detail?.contact?.displayName || detail?.contact?.phoneNumber || "Select a conversation"}</p>
              <p className="text-xs text-muted-foreground">{detail ? windowLabel(detail.customerServiceWindowExpiresAt) : "No conversation selected"}</p>
            </div>
            {detail && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => automationMutation.mutate(!detail.automationPaused)}
                disabled={automationMutation.isPending}
              >
                {detail.automationPaused ? <Play className="h-4 w-4 mr-2" /> : <Pause className="h-4 w-4 mr-2" />}
                Automation
              </Button>
            )}
          </div>

          <div className="min-h-0 flex-1 p-4">
            <WhatsappChatWorkspace
              messages={sortedMessages}
              isLoading={detailQuery.isLoading}
              isError={detailQuery.isError}
              windowExpiresAt={detail?.customerServiceWindowExpiresAt}
              templates={templates.data || []}
              templatesLoading={templates.isLoading}
              templateSyncStatus={templateSyncStatus.data}
              syncTemplatesPending={syncTemplates.isPending}
              sending={sendMutation.isPending}
              disabled={!detail}
              disabledReason={!detail ? "Select a conversation before sending." : null}
              emptyMessage="No WhatsApp messages yet."
              onSyncTemplates={() => syncTemplates.mutate()}
              onSendText={(body) => sendMutation.mutate({ body })}
              onSendTemplate={({ template, parameters }) => sendMutation.mutate({ template, parameters })}
              renderMessageActions={(message) => {
                const caseMessage = message as ConversationDetail["messages"][number];
                return caseMessage.caseId || caseMessage.direction !== "inbound" ? null : <Button variant="ghost" size="sm" className="mt-1 h-7 px-1 text-xs" onClick={() => setAssigningMessageId(caseMessage.id)}>Assign to case</Button>;
              }}
            />
          </div>
        </section>

        <aside className="border-l bg-muted/30 min-h-0">
          <div className="p-4 space-y-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-emerald-700" />
                  CRM Link
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-2">
                <div className="flex justify-between gap-3"><span className="text-muted-foreground">Verified</span><span>{detail?.contact?.verificationStatus || "unverified"}</span></div>
                <Separator />
                <div className="flex justify-between gap-3"><span className="text-muted-foreground">Case</span><span className="truncate">{detail?.caseId || "Not linked"}</span></div>
                <div className="flex justify-between gap-3"><span className="text-muted-foreground">Enquiry</span><span className="truncate">{detail?.enquiryId || "Not linked"}</span></div>
                <div className="flex justify-between gap-3"><span className="text-muted-foreground">Flow</span><span>{detail?.flowType || "-"}</span></div>
                <div className="flex justify-between gap-3"><span className="text-muted-foreground">State</span><span className="text-right">{detail?.automationState || "-"}</span></div>
              </CardContent>
            </Card>

            {assigningMessageId && <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Assign inbound message</CardTitle></CardHeader><CardContent className="space-y-3"><Select value={assignmentCaseId} onValueChange={(value) => { setAssignmentCaseId(value); setAssignmentPartyId(""); }}><SelectTrigger><SelectValue placeholder="Select case" /></SelectTrigger><SelectContent>{caseOptions.map((item) => <SelectItem key={item.id} value={item.id}>{item.caseRef}</SelectItem>)}</SelectContent></Select><Select value={assignmentPartyId} onValueChange={setAssignmentPartyId} disabled={!assignmentCaseId}><SelectTrigger><SelectValue placeholder="Select client" /></SelectTrigger><SelectContent>{assignmentCaseQuery.data?.parties?.map((party) => <SelectItem key={party.id} value={party.id}>{`${party.firstName || ""} ${party.lastName || ""}`.trim() || `Client ${party.role}`}</SelectItem>)}</SelectContent></Select><div className="flex gap-2"><Button size="sm" onClick={() => assignmentMutation.mutate()} disabled={!assignmentPartyId || assignmentMutation.isPending}>Assign</Button><Button size="sm" variant="ghost" onClick={() => setAssigningMessageId(null)}>Cancel</Button></div></CardContent></Card>}

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">24-hour Window</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                {detail ? windowLabel(detail.customerServiceWindowExpiresAt) : "Select a conversation to see Meta window status."}
              </CardContent>
            </Card>
          </div>
        </aside>
      </div>
    </div>
  );
}
