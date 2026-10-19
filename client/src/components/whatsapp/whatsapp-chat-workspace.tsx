import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertCircle, Check, Clock3, Loader2, RefreshCw, Send, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export type WhatsappTemplate = {
  id: string;
  name: string;
  language: string;
  category?: string | null;
  headerMediaType: string | null;
  components: Array<Record<string, unknown>>;
  parameterDefinitions: Array<{ key: string; component?: string }>;
};

export type WhatsappTemplateSyncStatus = {
  count: number;
  lastSyncedAt: string | null;
  stale: boolean;
  staleAfterHours?: number;
};

export type WhatsappChatMessage = {
  id: string;
  direction: string;
  body: string | null;
  type: string;
  status: string;
  createdAt: string;
  templateName?: string | null;
  errorPayload?: string | null;
};

type SendTemplatePayload = {
  template: WhatsappTemplate;
  parameters: Record<string, string>;
};

type WhatsappChatWorkspaceProps = {
  messages: WhatsappChatMessage[];
  isLoading?: boolean;
  isError?: boolean;
  windowExpiresAt?: string | null;
  templates: WhatsappTemplate[];
  templateSyncStatus?: WhatsappTemplateSyncStatus | null;
  templatesLoading?: boolean;
  syncTemplatesPending?: boolean;
  sending?: boolean;
  disabled?: boolean;
  disabledReason?: string | null;
  emptyMessage: string;
  attachmentPanel?: ReactNode;
  hasAttachments?: boolean;
  attachmentsReady?: boolean;
  isTemplateHeaderReady?: (template: WhatsappTemplate) => boolean;
  onSendText: (body: string) => void;
  onSendTemplate: (payload: SendTemplatePayload) => void;
  onSyncTemplates?: () => void;
  renderMessageActions?: (message: WhatsappChatMessage) => ReactNode;
};

function formatDate(value?: string | null) {
  if (!value) return "";
  return new Date(value).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function windowOpen(expiresAt?: string | null) {
  return Boolean(expiresAt && new Date(expiresAt).getTime() > Date.now());
}

function statusClass(status: string) {
  if (status === "failed") return "text-destructive";
  if (status === "read" || status === "delivered") return "text-emerald-700";
  return "text-muted-foreground";
}

function statusIcon(status: string) {
  if (status === "queued") return <Clock3 className="h-3.5 w-3.5" />;
  if (status === "failed") return <AlertCircle className="h-3.5 w-3.5" />;
  return <Check className="h-3.5 w-3.5" />;
}

function templateLabel(template: WhatsappTemplate) {
  return `${template.name} - ${template.language}`;
}

function renderTemplatePreviewText(text: string, parameters: Record<string, string>) {
  return text.replace(/{{\s*([^}]+)\s*}}/g, (_match, key: string) => {
    const normalizedKey = key.trim();
    const value = parameters[normalizedKey]?.trim();
    return value || `{{${normalizedKey}}}`;
  });
}

function renderTemplatePreviewContent(text: string, parameters: Record<string, string>) {
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const match of Array.from(text.matchAll(/{{\s*([^}]+)\s*}}/g))) {
    const matchIndex = match.index || 0;
    const normalizedKey = match[1].trim();
    const value = parameters[normalizedKey]?.trim();
    if (matchIndex > cursor) parts.push(text.slice(cursor, matchIndex));
    parts.push(value || <span key={`${normalizedKey}:${matchIndex}`} className="rounded bg-destructive/10 px-1 font-medium text-destructive">{`{{${normalizedKey}}}`}</span>);
    cursor = matchIndex + match[0].length;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts.length ? parts : text;
}

function templatePreviewComponentType(component: Record<string, unknown>) {
  return String(component.type || "").toUpperCase();
}

function templatePreviewText(component: Record<string, unknown>) {
  return typeof component.text === "string" ? component.text : "";
}

function templatePreviewFormat(component: Record<string, unknown>) {
  return typeof component.format === "string" ? component.format.toLowerCase() : null;
}

function templatePreviewButtons(component: Record<string, unknown>) {
  return Array.isArray(component.buttons) ? component.buttons.filter((button): button is Record<string, unknown> => Boolean(button && typeof button === "object")) : [];
}

function renderTemplateComponentPreview(component: Record<string, unknown>, parameters: Record<string, string>, index: number) {
  const type = templatePreviewComponentType(component);
  const text = templatePreviewText(component);
  const renderedText = text ? renderTemplatePreviewText(text, parameters) : "";

  if (type === "HEADER") {
    const format = templatePreviewFormat(component);
    return (
      <div key={`${type}:${index}`} className="rounded-md bg-muted/40 px-3 py-2">
        <p className="text-[11px] font-medium uppercase text-muted-foreground">Header</p>
        {renderedText ? <p className="mt-1 whitespace-pre-wrap text-sm font-medium">{renderTemplatePreviewContent(text, parameters)}</p> : <p className="mt-1 text-sm text-muted-foreground">Header media required{format ? `: ${format}` : ""}</p>}
      </div>
    );
  }

  if (type === "BODY") {
    return (
      <div key={`${type}:${index}`} className="space-y-1">
        <p className="text-[11px] font-medium uppercase text-muted-foreground">Body</p>
        <p className="whitespace-pre-wrap text-sm leading-6">{text ? renderTemplatePreviewContent(text, parameters) : "No body text saved for this template."}</p>
      </div>
    );
  }

  if (type === "FOOTER") {
    return (
      <div key={`${type}:${index}`}>
        <p className="text-[11px] font-medium uppercase text-muted-foreground">Footer</p>
        <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{renderTemplatePreviewContent(text, parameters)}</p>
      </div>
    );
  }

  if (type === "BUTTONS") {
    const buttons = templatePreviewButtons(component);
    if (!buttons.length) return null;
    return (
      <div key={`${type}:${index}`} className="space-y-2">
        <p className="text-[11px] font-medium uppercase text-muted-foreground">Buttons</p>
        <div className="flex flex-wrap gap-2">
          {buttons.map((button, buttonIndex) => {
            const label = typeof button.text === "string" ? button.text : typeof button.title === "string" ? button.title : String(button.type || "Button");
            return (
              <span key={`${label}:${buttonIndex}`} className="rounded-md border bg-background px-3 py-1 text-xs font-medium text-primary">
                {renderTemplatePreviewText(label, parameters)}
              </span>
            );
          })}
        </div>
      </div>
    );
  }

  if (!renderedText) return null;
  return (
    <div key={`${type || "component"}:${index}`}>
      <p className="text-[11px] font-medium uppercase text-muted-foreground">{type || "Component"}</p>
      <p className="mt-1 whitespace-pre-wrap text-sm">{renderTemplatePreviewContent(text, parameters)}</p>
    </div>
  );
}

export function WhatsappChatWorkspace({
  messages,
  isLoading = false,
  isError = false,
  windowExpiresAt,
  templates,
  templateSyncStatus,
  templatesLoading = false,
  syncTemplatesPending = false,
  sending = false,
  disabled = false,
  disabledReason,
  emptyMessage,
  attachmentPanel,
  hasAttachments = false,
  attachmentsReady = true,
  isTemplateHeaderReady,
  onSendText,
  onSendTemplate,
  onSyncTemplates,
  renderMessageActions,
}: WhatsappChatWorkspaceProps) {
  const isWindowOpen = windowOpen(windowExpiresAt);
  const messageEndRef = useRef<HTMLDivElement | null>(null);
  const [selectedMode, setSelectedMode] = useState<"text" | "template">(isWindowOpen ? "text" : "template");
  const [body, setBody] = useState("");
  const [templateId, setTemplateId] = useState("none");
  const [parameters, setParameters] = useState<Record<string, string>>({});
  const selectedTemplate = templates.find((item) => item.id === templateId) || null;
  const templateHeaderReady = selectedTemplate ? Boolean(isTemplateHeaderReady?.(selectedTemplate)) : false;
  const requiresTemplate = !isWindowOpen;
  const syncNeedsAttention = Boolean(templateSyncStatus && (templateSyncStatus.stale || templateSyncStatus.count === 0));
  const latestMessageScrollKey = useMemo(() => {
    const latestMessage = messages[messages.length - 1];
    return latestMessage ? `${latestMessage.id}:${latestMessage.createdAt}:${latestMessage.status}` : "empty";
  }, [messages]);

  useEffect(() => {
    if (!isWindowOpen && selectedMode === "text") {
      setSelectedMode("template");
    }
  }, [isWindowOpen, selectedMode]);

  useLayoutEffect(() => {
    if (isLoading || isError) return;
    messageEndRef.current?.scrollIntoView({ block: "end" });
  }, [isError, isLoading, latestMessageScrollKey, messages.length]);

  const missingTemplateParameters = useMemo(() => {
    if (!selectedTemplate) return [];
    return selectedTemplate.parameterDefinitions
      .map((item) => item.key)
      .filter((key) => !parameters[key]?.trim());
  }, [parameters, selectedTemplate]);

  const canSendText = selectedMode === "text" && isWindowOpen && attachmentsReady && (body.trim().length > 0 || hasAttachments);
  const canSendTemplate = selectedMode === "template" && attachmentsReady && !!selectedTemplate && missingTemplateParameters.length === 0 && (!selectedTemplate.headerMediaType || templateHeaderReady);
  const canSend = !disabled && !sending && (canSendText || canSendTemplate);

  const send = () => {
    if (canSendText) {
      onSendText(body.trim());
      setBody("");
      return;
    }
    if (canSendTemplate && selectedTemplate) {
      onSendTemplate({ template: selectedTemplate, parameters });
      setParameters({});
      setTemplateId("none");
    }
  };

  return (
    <div className="overflow-hidden rounded-md border bg-background" data-testid="whatsapp-chat-workspace">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/30 px-4 py-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={isWindowOpen ? "default" : "outline"}>{isWindowOpen ? `24-hour window open until ${formatDate(windowExpiresAt)}` : "24-hour window closed"}</Badge>
            {syncNeedsAttention && <Badge variant="outline">Template catalogue needs sync</Badge>}
          </div>
          <p className="text-xs text-muted-foreground">
            {templateSyncStatus?.lastSyncedAt ? `Approved templates last synced ${formatDate(templateSyncStatus.lastSyncedAt)}.` : "Approved templates have not been synced yet."}
          </p>
        </div>
        {onSyncTemplates && (
          <Button type="button" variant="outline" size="sm" onClick={onSyncTemplates} disabled={syncTemplatesPending}>
            {syncTemplatesPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Sync templates
          </Button>
        )}
      </div>

      <ScrollArea className="h-[420px] bg-[#efeae2]">
        <div className="space-y-3 p-4">
          {isLoading && <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin" /></div>}
          {isError && <div className="rounded-md border border-destructive/30 bg-background p-4 text-sm text-destructive">Unable to load WhatsApp messages.</div>}
          {!isLoading && !isError && messages.length === 0 && <p className="py-12 text-center text-sm text-muted-foreground">{emptyMessage}</p>}
          {messages.map((message) => {
            const outbound = message.direction === "outbound";
            const content = message.templateName
              ? `Template: ${message.templateName}`
              : message.body || `[${message.type}]`;
            return (
              <div key={message.id} className={`flex ${outbound ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[78%] rounded-lg px-3 py-2 text-sm shadow-sm ${outbound ? "bg-[#d9fdd3]" : "bg-white"}`}>
                  <p className="whitespace-pre-wrap break-words">{content}</p>
                  <div className={`mt-1 flex items-center justify-end gap-1 text-[11px] ${statusClass(message.status)}`}>
                    <span>{formatDate(message.createdAt)}</span>
                    <span aria-hidden="true">.</span>
                    <span>{message.status}</span>
                    {statusIcon(message.status)}
                  </div>
                  {message.errorPayload && <p className="mt-1 text-xs text-destructive">Delivery failed. Review the provider error before retrying.</p>}
                  {renderMessageActions?.(message)}
                </div>
              </div>
            );
          })}
          <div ref={messageEndRef} data-testid="whatsapp-chat-bottom-anchor" aria-hidden="true" />
        </div>
      </ScrollArea>

      <div className="space-y-3 border-t bg-background p-3">
        {requiresTemplate && (
          <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Meta only allows approved templates outside the 24-hour window. Send a pre-approved template first, then continue with free text after the client replies.</span>
          </div>
        )}
        {disabledReason && <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{disabledReason}</div>}
        {syncNeedsAttention && (
          <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
            The saved verified Meta template list is {templateSyncStatus?.count ? "stale" : "empty"}. Sync templates before relying on the catalogue.
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant={selectedMode === "text" ? "default" : "outline"} disabled={!isWindowOpen} onClick={() => setSelectedMode("text")}>Free text</Button>
          <Button type="button" size="sm" variant={selectedMode === "template" ? "default" : "outline"} onClick={() => setSelectedMode("template")}>Approved template</Button>
        </div>

        {selectedMode === "template" ? (
          <div className="space-y-3">
            <Select value={templateId} onValueChange={(value) => { setTemplateId(value); setParameters({}); }}>
              <SelectTrigger><SelectValue placeholder={templatesLoading ? "Loading approved templates" : "Select approved template"} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Select approved template</SelectItem>
                {templates.map((item) => <SelectItem key={item.id} value={item.id}>{templateLabel(item)}</SelectItem>)}
              </SelectContent>
            </Select>
            {selectedTemplate?.headerMediaType && !templateHeaderReady && (
              <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                This template requires a {selectedTemplate.headerMediaType} header. Select a validated matching attachment before sending.
              </p>
            )}
            {selectedTemplate?.parameterDefinitions.length ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {selectedTemplate.parameterDefinitions.map((definition) => (
                  <Input
                    key={`${definition.component || "body"}:${definition.key}`}
                    placeholder={`${definition.component || "body"} ${definition.key}`}
                    value={parameters[definition.key] || ""}
                    onChange={(event) => setParameters((current) => ({ ...current, [definition.key]: event.target.value }))}
                  />
                ))}
              </div>
            ) : null}
            {selectedTemplate && (
              <div data-testid="whatsapp-template-preview" className="space-y-3 rounded-md border bg-muted/20 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">Template preview</p>
                    <p className="text-xs text-muted-foreground">{selectedTemplate.name}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {selectedTemplate.category && <Badge variant="outline">{selectedTemplate.category}</Badge>}
                    <Badge variant="outline">{selectedTemplate.language}</Badge>
                  </div>
                </div>
                {selectedTemplate.headerMediaType && (
                  <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
                    Header media requirement: {selectedTemplate.headerMediaType}
                  </p>
                )}
                <div className="space-y-3 rounded-lg border bg-background p-3">
                  {selectedTemplate.components.length ? selectedTemplate.components.map((component, index) => renderTemplateComponentPreview(component, parameters, index)) : <p className="text-sm text-muted-foreground">No Meta components are saved for this template.</p>}
                </div>
                {missingTemplateParameters.length > 0 && (
                  <p className="text-xs text-destructive">
                    Missing value: {missingTemplateParameters.join(", ")}
                  </p>
                )}
              </div>
            )}
          </div>
        ) : (
          <Textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder={isWindowOpen ? "Type a WhatsApp message" : "Free text is available after the client replies"}
            rows={3}
            disabled={!isWindowOpen || disabled}
          />
        )}

        {attachmentPanel}

        <div className="flex justify-end">
          <Button type="button" onClick={send} disabled={!canSend}>
            {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}
