import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ExternalLink, Paperclip, X } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  WhatsappChatWorkspace,
  type WhatsappChatMessage,
  type WhatsappTemplate,
  type WhatsappTemplateSyncStatus,
} from "@/components/whatsapp/whatsapp-chat-workspace";

type Recipient = { partyId: string; clientId: string; name: string; role: string; phone: string; optInStatus: string; noWhatsappOrVoicemail: boolean; conversationId: string | null; conversationStatus: string; automationState: string | null; customerServiceWindowExpiresAt: string | null };
type CaseDocument = { id: string; fileName: string; title: string };
type UploadStatus = { id: string; fileName: string; mimeType?: string | null; status: string; retryCount: number; lastError: string | null };

async function json<T>(url: string): Promise<T> { const response = await fetch(url, { credentials: "include" }); if (!response.ok) throw new Error((await response.json().catch(() => ({}))).message || "Request failed"); return response.json(); }
async function fileData(file: File) { return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); }); }

function isHeaderCompatible(template: WhatsappTemplate | null, uploadStatuses: UploadStatus[] | undefined, mediaIds: string[]) {
  if (!template?.headerMediaType) return false;
  const first = uploadStatuses?.find((item) => item.id === mediaIds[0]);
  if (!first || first.status !== "clean") return false;
  if (template.headerMediaType === "image") return Boolean(first.mimeType?.startsWith("image/"));
  if (template.headerMediaType === "document") return !first.mimeType?.startsWith("image/");
  return false;
}

export function CaseWhatsappPanel({ caseId }: { caseId: string }) {
  const { toast } = useToast();
  const [partyId, setPartyId] = useState("");
  const [mediaIds, setMediaIds] = useState<string[]>([]);
  const recipients = useQuery<Recipient[]>({ queryKey: ["/api/cases", caseId, "whatsapp", "recipients"], queryFn: () => json(`/api/cases/${caseId}/whatsapp/recipients`) });
  const templates = useQuery<WhatsappTemplate[]>({ queryKey: ["/api/whatsapp/templates"], queryFn: () => json("/api/whatsapp/templates") });
  const templateSyncStatus = useQuery<WhatsappTemplateSyncStatus>({ queryKey: ["/api/whatsapp/templates/status"], queryFn: () => json("/api/whatsapp/templates/status") });
  const documents = useQuery<CaseDocument[]>({ queryKey: ["/api/cases", caseId, "documents"], queryFn: () => json(`/api/cases/${caseId}/documents`) });
  useEffect(() => { if (!partyId && recipients.data?.[0]) setPartyId(recipients.data[0].partyId); }, [partyId, recipients.data]);
  const recipient = recipients.data?.find((item) => item.partyId === partyId);
  const messages = useQuery<WhatsappChatMessage[]>({ queryKey: ["/api/cases", caseId, "whatsapp", "messages", partyId], queryFn: () => json(`/api/cases/${caseId}/whatsapp/messages?partyId=${encodeURIComponent(partyId)}`), enabled: Boolean(partyId), refetchInterval: 15_000 });
  const uploadStatuses = useQuery<UploadStatus[]>({ queryKey: ["/api/cases", caseId, "whatsapp", "uploads", partyId, mediaIds], queryFn: () => json(`/api/cases/${caseId}/whatsapp/uploads?partyId=${encodeURIComponent(partyId)}&ids=${encodeURIComponent(mediaIds.join(","))}`), enabled: Boolean(partyId && mediaIds.length), refetchInterval: (query) => query.state.data?.every((item) => ["clean", "blocked"].includes(item.status) || (item.status === "failed" && item.retryCount >= 6)) ? false : 3_000 });

  const preference = useMutation({ mutationFn: (status: "opted_in" | "opted_out") => apiRequest("POST", `/api/cases/${caseId}/whatsapp/preferences/${partyId}`, { status, source: "case_workspace" }), onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "whatsapp", "recipients"] }); toast({ title: "WhatsApp preference updated" }); } });
  const upload = useMutation({ mutationFn: async (payload: { file?: File; caseDocumentId?: string }) => { const response = await apiRequest("POST", `/api/cases/${caseId}/whatsapp/uploads`, payload.file ? { partyId, fileName: payload.file.name, mimeType: payload.file.type, fileData: await fileData(payload.file) } : { partyId, caseDocumentId: payload.caseDocumentId }); return response.json(); }, onSuccess: (item) => { setMediaIds((current) => [...current, item.id].slice(0, 5)); toast({ title: "Attachment queued for validation" }); }, onError: (error: Error) => toast({ title: "Failed to upload attachment", description: error.message, variant: "destructive" }) });
  const send = useMutation({ mutationFn: async (payload: { body?: string; template?: WhatsappTemplate; parameters?: Record<string, string> }) => {
    const headerMediaId = payload.template?.headerMediaType ? mediaIds[0] : undefined;
    const standaloneMediaIds = payload.template?.headerMediaType ? mediaIds.slice(1) : mediaIds;
    const response = await apiRequest("POST", `/api/cases/${caseId}/whatsapp/messages`, { partyId, body: payload.template ? undefined : payload.body, template: payload.template ? { name: payload.template.name, language: payload.template.language, parameters: payload.parameters || {}, headerMediaId } : undefined, mediaIds: standaloneMediaIds });
    return response.json();
  }, onSuccess: () => {
    setMediaIds([]);
    queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "whatsapp", "messages"] });
    queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "communications"], exact: false });
    toast({ title: "WhatsApp message queued" });
  }, onError: (error: Error) => toast({ title: "Unable to send", description: error.message, variant: "destructive" }) });
  const syncTemplates = useMutation({ mutationFn: async () => (await apiRequest("POST", "/api/whatsapp/templates/sync")).json(), onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/templates"] }); queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/templates/status"] }); toast({ title: "WhatsApp templates synced" }); }, onError: (error: Error) => toast({ title: "Template sync failed", description: error.message, variant: "destructive" }) });

  const attachmentsReady = mediaIds.length === 0 || (uploadStatuses.data?.length === mediaIds.length && uploadStatuses.data.every((item) => item.status === "clean"));
  const selectedHeaderReady = (template: WhatsappTemplate) => isHeaderCompatible(template, uploadStatuses.data, mediaIds);
  const disabledReason = recipient?.noWhatsappOrVoicemail
    ? "WhatsApp is restricted for this case."
    : recipient && recipient.optInStatus !== "opted_in"
      ? "Record WhatsApp opt-in before sending."
      : !recipient
        ? "Select a case client before sending."
        : null;

  const attachmentPanel = (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex cursor-pointer items-center rounded-md border px-3 py-2 text-sm">
          <Paperclip className="mr-2 h-4 w-4" />Upload file
          <input className="hidden" type="file" accept="image/jpeg,image/png,image/webp,application/pdf,.doc,.docx,text/plain" onChange={(event) => { const file = event.target.files?.[0]; if (file) upload.mutate({ file }); event.currentTarget.value = ""; }} />
        </label>
        <Select onValueChange={(caseDocumentId) => upload.mutate({ caseDocumentId })}>
          <SelectTrigger className="w-64"><SelectValue placeholder="Attach existing case document" /></SelectTrigger>
          <SelectContent>{documents.data?.map((document) => <SelectItem key={document.id} value={document.id}>{document.title || document.fileName}</SelectItem>)}</SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">{mediaIds.length}/5 selected; files send after validation</span>
      </div>
      {uploadStatuses.isError ? <div className="flex items-center gap-2 text-sm text-destructive"><span>Failed to load attachment status.</span><Button size="sm" variant="outline" onClick={() => uploadStatuses.refetch()}>Retry</Button></div> : null}
      {uploadStatuses.data?.length ? <div className="flex flex-wrap gap-2">{uploadStatuses.data.map((item) => <div key={item.id} className="flex items-center gap-1"><Badge variant={item.status === "blocked" || item.status === "failed" ? "destructive" : "outline"}>{item.fileName}: {item.status}{item.lastError ? " - validation/send unavailable" : ""}</Badge><Button size="icon" variant="ghost" aria-label="Remove attachment" title="Remove attachment" onClick={() => setMediaIds((current) => current.filter((id) => id !== item.id))}><X className="h-4 w-4" /></Button></div>)}</div> : null}
    </div>
  );

  return <div className="space-y-4" data-testid="case-whatsapp-workspace">
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
      <Select value={partyId} onValueChange={(value) => { setPartyId(value); setMediaIds([]); }}><SelectTrigger><SelectValue placeholder="Select a case client" /></SelectTrigger><SelectContent>{recipients.data?.map((item) => <SelectItem key={item.partyId} value={item.partyId}>{item.name || `Client ${item.role}`} - {item.phone || "no mobile"}</SelectItem>)}</SelectContent></Select>
      {recipient?.conversationId && <Button variant="outline" asChild><a href={`/whatsapp?conversation=${recipient.conversationId}`}><ExternalLink className="mr-2 h-4 w-4" />Global conversation</a></Button>}
    </div>
    {recipient && <div className="flex flex-wrap items-center gap-2 text-sm"><Badge variant={recipient.optInStatus === "opted_in" ? "default" : "outline"}>{recipient.optInStatus.replace("_", " ")}</Badge><Badge variant="outline">{recipient.conversationStatus.replace("_", " ")}{recipient.automationState ? ` - ${recipient.automationState.replaceAll("_", " ")}` : ""}</Badge>{recipient.noWhatsappOrVoicemail && <Badge variant="destructive">WhatsApp restricted</Badge>}<Button size="sm" variant="outline" onClick={() => preference.mutate(recipient.optInStatus === "opted_in" ? "opted_out" : "opted_in")}>{recipient.optInStatus === "opted_in" ? "Record opt-out" : "Record opt-in"}</Button></div>}
    <WhatsappChatWorkspace
      messages={messages.data || []}
      isLoading={messages.isLoading}
      isError={messages.isError}
      windowExpiresAt={recipient?.customerServiceWindowExpiresAt}
      templates={templates.data || []}
      templatesLoading={templates.isLoading}
      templateSyncStatus={templateSyncStatus.data}
      syncTemplatesPending={syncTemplates.isPending}
      sending={send.isPending}
      disabled={Boolean(disabledReason)}
      disabledReason={disabledReason}
      emptyMessage="No case-assigned WhatsApp messages for this client."
      attachmentPanel={attachmentPanel}
      hasAttachments={mediaIds.length > 0}
      attachmentsReady={attachmentsReady}
      isTemplateHeaderReady={selectedHeaderReady}
      onSyncTemplates={() => syncTemplates.mutate()}
      onSendText={(body) => send.mutate({ body })}
      onSendTemplate={({ template, parameters }) => send.mutate({ template, parameters })}
    />
  </div>;
}
