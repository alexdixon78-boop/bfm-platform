import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Archive, Check, Copy, Download, ExternalLink, Flag, Inbox, Mail, PanelRightOpen, RefreshCw, RotateCcw, Search, Trash2, X } from "lucide-react";
import { Link } from "wouter";
import { apiRequest, getApiErrorMessage, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { DeleteDialog } from "@/components/shared/delete-dialog";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import {
  ENQUIRY_CONTACT_METHODS,
  ISSUE_TYPES,
  LEAD_SOURCES,
  REFERRAL_TYPES,
  type InsertEnquiry,
} from "@shared/schema";

type PreviewMessage = {
  gmailMessageId: string;
  gmailThreadId: string | null;
  fromName: string | null;
  fromEmail: string;
  toEmails: string | null;
  subject: string | null;
  receivedAt: string | null;
  snippet: string | null;
  alreadyImported?: boolean;
  importedMailId?: string | null;
  importedStatus?: string | null;
};

type ImportedMessage = PreviewMessage & {
  id: string;
  ccEmails: string | null;
  textBody: string | null;
  sanitizedHtmlBody: string | null;
  status: string;
  importedAt: string;
  linkedEnquiryId: string | null;
  linkedCaseId: string | null;
  linkedCaseEmailMessageId: string | null;
  convertedAt: string | null;
  bodyRefreshWarning?: string;
};

type PreviewMode = "search" | "recent";
type MailStatusFilter = "unconverted" | "needs_action" | "converted" | "archived" | "deleted" | "all";
type MailWorkflowAction = "archive" | "restore" | "delete" | "needs_action" | "clear_needs_action";
type BodyView = "html" | "text";

type EnquiryDraft = Omit<InsertEnquiry, "consentFollowUpDate" | "dateOfBirth"> & {
  dateOfBirth?: string;
  consentFollowUpDate?: string;
};

type BfmConnectionStatus = {
  connected: boolean;
  hasWriteScope: boolean;
  hasGmailReadonlyScope: boolean;
  email?: string | null;
};

const defaultEnquiryDraft: EnquiryDraft = {
  firstName: "",
  middleName: "",
  lastName: "",
  email: "",
  mobileTelephone: "",
  phoneCode: "+44",
  landlineTelephone: "",
  contactMethod: "Direct email",
  issueType: "",
  referralType: "Self-referral",
  shuttleMediation: false,
  addressLine1: "",
  addressLine2: "",
  postcode: "",
  consentFollowUp: false,
  consentAnonymisedData: false,
  privacyConsent: false,
  leadSource: "Other (please specify)",
  leadSourceOther: "Email",
  issueTypeOther: "",
  metadata: "",
  notes: "",
};

function formatDate(value: string | null | undefined) {
  if (!value) return "Unknown date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return date.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function splitName(name: string | null | undefined, fallbackEmail: string) {
  const raw = (name || fallbackEmail.split("@")[0] || "Email").replace(/[._-]+/g, " ").trim();
  const parts = raw.split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || "Email",
    lastName: parts.slice(1).join(" ") || "Contact",
  };
}

function buildNotes(message: ImportedMessage) {
  const body = (message.textBody || message.snippet || "").replace(/\s+/g, " ").trim();
  const excerpt = body.length > 1400 ? `${body.slice(0, 1400)}...` : body;
  return [
    "Converted from Gmail message.",
    `Subject: ${message.subject || "No subject"}`,
    `From: ${message.fromName ? `${message.fromName} <${message.fromEmail}>` : message.fromEmail}`,
    `Received: ${formatDate(message.receivedAt)}`,
    "",
    excerpt,
  ].join("\n");
}

function createDraftFromMessage(message: ImportedMessage): EnquiryDraft {
  const name = splitName(message.fromName, message.fromEmail);
  return {
    ...defaultEnquiryDraft,
    firstName: name.firstName,
    lastName: name.lastName,
    email: message.fromEmail,
    metadata: JSON.stringify({
      source: "gmail_mail_inbox",
      gmailMessageId: message.gmailMessageId,
      gmailThreadId: message.gmailThreadId,
      importedMailId: message.id,
    }),
    notes: buildNotes(message),
  };
}

function messageTitle(message: Pick<PreviewMessage, "subject" | "fromEmail">) {
  return message.subject?.trim() || `(No subject from ${message.fromEmail})`;
}

const statusLabels: Record<string, string> = {
  imported: "Imported",
  needs_action: "Needs Action",
  converted: "Converted",
  case_linked: "Case reply",
  archived: "Archived",
  deleted: "Deleted",
};

function mailStatusLabel(status: string) {
  return statusLabels[status] || status;
}

function previewImportBadgeLabel(message: PreviewMessage) {
  if (!message.alreadyImported) return null;
  if (message.importedStatus === "deleted") return "Imported then deleted";
  if (message.importedStatus === "archived") return "Already archived";
  if (message.importedStatus === "converted") return "Already converted";
  if (message.importedStatus === "case_linked") return "Already linked to case";
  return "Already in CRM";
}

function workflowEndpoint(action: MailWorkflowAction) {
  if (action === "needs_action") return "needs-action";
  if (action === "clear_needs_action") return "clear-needs-action";
  return action;
}

function mailListKey(statusFilter: MailStatusFilter, importedSearch: string) {
  const params = new URLSearchParams({ status: statusFilter });
  if (importedSearch.trim()) params.set("search", importedSearch.trim());
  return `/api/mail/messages?${params.toString()}`;
}

export default function MailInboxPage() {
  const { toast } = useToast();
  const [mode, setMode] = useState<PreviewMode>("recent");
  const [searchQuery, setSearchQuery] = useState("");
  const [recentLimit, setRecentLimit] = useState(10);
  const [previewMessages, setPreviewMessages] = useState<PreviewMessage[]>([]);
  const [selectedPreviewIds, setSelectedPreviewIds] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<MailStatusFilter>("all");
  const [importedSearch, setImportedSearch] = useState("");
  const [selectedImportedIds, setSelectedImportedIds] = useState<Set<string>>(new Set());
  const [selectedMessage, setSelectedMessage] = useState<ImportedMessage | null>(null);
  const [bodyView, setBodyView] = useState<BodyView>("html");
  const [convertOpen, setConvertOpen] = useState(false);
  const [pullOpen, setPullOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ImportedMessage | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [enquiryDraft, setEnquiryDraft] = useState<EnquiryDraft>(defaultEnquiryDraft);
  const currentMailListKey = mailListKey(statusFilter, importedSearch);

  const importedQuery = useQuery<{ messages: ImportedMessage[] }>({
    queryKey: [currentMailListKey],
  });
  const bfmStatusQuery = useQuery<BfmConnectionStatus>({
    queryKey: ["/api/calendar/bfm/status"],
  });

  const importedMessages = importedQuery.data?.messages ?? [];
  const bfmStatus = bfmStatusQuery.data;
  const gmailReady = !!bfmStatus?.connected && !!bfmStatus?.hasGmailReadonlyScope;

  async function invalidateMailQueries() {
    await queryClient.invalidateQueries({
      predicate: (query) => String(query.queryKey[0] || "").startsWith("/api/mail/messages"),
    });
  }

  const previewMutation = useMutation({
    mutationFn: async () => {
      const payload = mode === "search"
        ? { mode, searchQuery: searchQuery.trim(), recentLimit }
        : { mode, recentLimit };
      const res = await apiRequest("POST", "/api/mail/gmail/preview", payload);
      return await res.json() as { messages: PreviewMessage[] };
    },
    onSuccess: (data) => {
      setPreviewMessages(data.messages);
      setSelectedPreviewIds(new Set());
      toast({ title: "Gmail preview loaded", description: `${data.messages.length} message${data.messages.length === 1 ? "" : "s"} found.` });
    },
    onError: (error: Error) => {
      toast({ title: "Unable to preview Gmail", description: getApiErrorMessage(error, "preview"), variant: "destructive" });
    },
  });

  const importMutation = useMutation({
    mutationFn: async (gmailMessageIds?: string[]) => {
      const res = await apiRequest("POST", "/api/mail/gmail/import", {
        gmailMessageIds: gmailMessageIds ?? Array.from(selectedPreviewIds),
      });
      return await res.json() as { messages: ImportedMessage[] };
    },
    onSuccess: async (data) => {
      setSelectedPreviewIds(new Set());
      await invalidateMailQueries();
      toast({ title: "Messages imported", description: `${data.messages.length} message${data.messages.length === 1 ? "" : "s"} saved to CRM.` });
    },
    onError: (error: Error) => {
      toast({ title: "Import failed", description: getApiErrorMessage(error, "import"), variant: "destructive" });
    },
  });

  const convertMutation = useMutation({
    mutationFn: async (payload: EnquiryDraft) => {
      if (!selectedMessage) throw new Error("No mail message selected");
      const enquiryRes = await apiRequest("POST", "/api/enquiries", payload);
      const enquiryData = await enquiryRes.json() as { enquiry: { id: string }; newCase?: { id: string } | null };
      await apiRequest("POST", `/api/mail/messages/${selectedMessage.id}/convert`, {
        enquiryId: enquiryData.enquiry.id,
        caseId: enquiryData.newCase?.id ?? null,
      });
      return enquiryData;
    },
    onSuccess: async () => {
      setConvertOpen(false);
      setSelectedMessage(null);
      await invalidateMailQueries();
      await queryClient.invalidateQueries({ queryKey: ["/api/enquiries"] });
      toast({ title: "Converted to enquiry", description: "The email is now linked to the new enquiry." });
    },
    onError: (error: Error) => {
      toast({ title: "Conversion failed", description: getApiErrorMessage(error, "convert"), variant: "destructive" });
    },
  });

  const mailActionMutation = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: MailWorkflowAction }) => {
      const res = await apiRequest("POST", `/api/mail/messages/${id}/${workflowEndpoint(action)}`);
      return await res.json() as { message: ImportedMessage };
    },
    onSuccess: async (data, variables) => {
      setDeleteTarget(null);
      setSelectedMessage((current) => {
        if (current?.id !== data.message.id) return current;
        return variables.action === "delete" ? null : data.message;
      });
      await invalidateMailQueries();
      toast({ title: "Mail updated", description: `${mailStatusLabel(data.message.status)} status saved.` });
    },
    onError: (error: Error) => {
      toast({ title: "Mail action failed", description: getApiErrorMessage(error, "mailAction"), variant: "destructive" });
    },
  });

  const bulkActionMutation = useMutation({
    mutationFn: async (action: MailWorkflowAction) => {
      const res = await apiRequest("POST", "/api/mail/messages/bulk", {
        action,
        ids: Array.from(selectedImportedIds),
      });
      return await res.json() as { messages: ImportedMessage[]; failedIds: string[] };
    },
    onSuccess: async (data) => {
      setBulkDeleteOpen(false);
      setSelectedImportedIds(new Set());
      if (selectedMessage && data.messages.some((message) => message.id === selectedMessage.id)) {
        setSelectedMessage(null);
      }
      await invalidateMailQueries();
      toast({ title: "Bulk action complete", description: `${data.messages.length} message${data.messages.length === 1 ? "" : "s"} updated.` });
    },
    onError: (error: Error) => {
      toast({ title: "Bulk action failed", description: getApiErrorMessage(error, "mailAction"), variant: "destructive" });
    },
  });

  const selectedCount = selectedPreviewIds.size;
  const selectedImportedCount = selectedImportedIds.size;
  const selectedImported = useMemo(() => {
    if (!selectedMessage) return null;
    return importedMessages.find((message) => message.id === selectedMessage.id) ?? selectedMessage;
  }, [importedMessages, selectedMessage]);

  function togglePreview(id: string, checked: boolean) {
    setSelectedPreviewIds((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleImported(id: string, checked: boolean) {
    setSelectedImportedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function runMailAction(message: ImportedMessage, action: MailWorkflowAction) {
    if (action === "delete") {
      setDeleteTarget(message);
      return;
    }
    mailActionMutation.mutate({ id: message.id, action });
  }

  function runBulkAction(action: MailWorkflowAction) {
    if (selectedImportedCount === 0) return;
    if (action === "delete") {
      setBulkDeleteOpen(true);
      return;
    }
    bulkActionMutation.mutate(action);
  }

  async function importAndOpen(message: PreviewMessage) {
    try {
      const res = await apiRequest("POST", "/api/mail/gmail/import", {
        gmailMessageIds: [message.gmailMessageId],
      });
      const data = await res.json() as { messages: ImportedMessage[] };
      await invalidateMailQueries();
      const imported = data.messages[0];
      if (imported) await selectImportedMessage(imported);
      setPullOpen(false);
      toast({ title: "Message imported", description: "The email is open in the reading pane." });
    } catch (error) {
      toast({ title: "Import failed", description: getApiErrorMessage(error, "import"), variant: "destructive" });
    }
  }

  async function copySenderEmail(message: ImportedMessage) {
    try {
      await navigator.clipboard.writeText(message.fromEmail);
      toast({ title: "Sender email copied" });
    } catch {
      toast({ title: "Could not copy sender email", variant: "destructive" });
    }
  }

  async function selectImportedMessage(message: ImportedMessage) {
    setSelectedMessage(message);
    setBodyView("html");
    try {
      const res = await apiRequest("GET", `/api/mail/messages/${message.id}`);
      const data = await res.json() as { message: ImportedMessage; bodyRefreshWarning?: string };
      setSelectedMessage({ ...data.message, bodyRefreshWarning: data.bodyRefreshWarning });
      setBodyView(data.message.sanitizedHtmlBody ? "html" : "text");
      if (data.message.textBody || data.message.sanitizedHtmlBody) {
        await invalidateMailQueries();
      }
    } catch (error) {
      toast({
        title: "Unable to load email detail",
        description: getApiErrorMessage(error, "detail"),
        variant: "destructive",
      });
    }
  }

  function openConvert(message: ImportedMessage) {
    setSelectedMessage(message);
    setEnquiryDraft(createDraftFromMessage(message));
    setConvertOpen(true);
  }

  function updateDraft<K extends keyof EnquiryDraft>(key: K, value: EnquiryDraft[K]) {
    setEnquiryDraft((current) => ({ ...current, [key]: value }));
  }

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Mail Inbox"
        subtitle="Pull messages from the BFM Gmail inbox, import them into CRM, and convert enquiry emails."
        icon={Mail}
        iconColor="text-blue-700"
        iconBg="bg-blue-50"
      />

      {!gmailReady && !bfmStatusQuery.isLoading && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-amber-950">BFM Gmail access needs reconnecting</p>
              <p className="text-sm text-amber-900">
                Reconnect the BFM Google account so it grants Gmail readonly access for mail preview and import.
              </p>
            </div>
            <Button asChild variant="outline" className="border-amber-300 bg-white text-amber-950 hover:bg-amber-100">
              <a href="/api/auth/google/bfm">Reconnect BFM Google</a>
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="rounded-lg border bg-background">
        <div className="flex flex-col gap-3 border-b p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-1 flex-col gap-3 md:flex-row md:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={importedSearch}
                onChange={(event) => setImportedSearch(event.target.value)}
                placeholder="Search imported mail"
                className="pl-9"
              />
            </div>
            <Select value={statusFilter} onValueChange={(value: MailStatusFilter) => setStatusFilter(value)}>
              <SelectTrigger className="w-full md:w-[170px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unconverted">Unconverted</SelectItem>
                <SelectItem value="needs_action">Needs Action</SelectItem>
                <SelectItem value="converted">Converted</SelectItem>
                <SelectItem value="archived">Archived</SelectItem>
                <SelectItem value="deleted">Deleted</SelectItem>
                <SelectItem value="all">All mail</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-wrap gap-2">
            {selectedImportedCount > 0 && (
              <>
                <Button type="button" variant="outline" size="sm" onClick={() => runBulkAction("archive")} disabled={bulkActionMutation.isPending} className="gap-2">
                  <Archive className="h-4 w-4" />
                  Archive selected
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => runBulkAction("restore")} disabled={bulkActionMutation.isPending} className="gap-2">
                  <RotateCcw className="h-4 w-4" />
                  Restore selected
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => runBulkAction("delete")} disabled={bulkActionMutation.isPending} className="gap-2 text-red-700">
                  <Trash2 className="h-4 w-4" />
                  Delete selected
                </Button>
              </>
            )}
            <Sheet open={pullOpen} onOpenChange={setPullOpen}>
              <SheetTrigger asChild>
                <Button type="button" className="gap-2">
                  <PanelRightOpen className="h-4 w-4" />
                  Open Gmail Pull
                </Button>
              </SheetTrigger>
              <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
                <SheetHeader>
                  <SheetTitle>Pull from Gmail</SheetTitle>
                  <SheetDescription>Preview recent inbox messages or search Gmail, then import selected mail into CRM.</SheetDescription>
                </SheetHeader>
                <div className="mt-6 space-y-5">
                  <Select value={mode} onValueChange={(value: PreviewMode) => setMode(value)}>
                    <SelectTrigger data-testid="select-mail-preview-mode">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="recent">Recent inbox messages</SelectItem>
                      <SelectItem value="search">Search Gmail</SelectItem>
                    </SelectContent>
                  </Select>

                  {mode === "search" ? (
                    <div className="space-y-2">
                      <Label htmlFor="searchQuery">Search Gmail</Label>
                      <Input
                        id="searchQuery"
                        value={searchQuery}
                        onChange={(event) => setSearchQuery(event.target.value)}
                        placeholder="Name, partial email, subject, or Gmail search query"
                      />
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Label htmlFor="recentLimit">Recent message count</Label>
                      <Input
                        id="recentLimit"
                        type="number"
                        min={1}
                        max={25}
                        value={recentLimit}
                        onChange={(event) => setRecentLimit(Number(event.target.value))}
                      />
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      onClick={() => previewMutation.mutate()}
                      disabled={previewMutation.isPending || (mode === "search" && !searchQuery.trim())}
                      className="gap-2"
                    >
                      <RefreshCw className="h-4 w-4" />
                      Preview
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => importMutation.mutate(undefined)}
                      disabled={importMutation.isPending || selectedCount === 0}
                      className="gap-2"
                    >
                      <Download className="h-4 w-4" />
                      Import selected {selectedCount || ""}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        setPreviewMessages([]);
                        setSelectedPreviewIds(new Set());
                      }}
                      className="gap-2"
                    >
                      <X className="h-4 w-4" />
                      Clear preview
                    </Button>
                  </div>

                  <div className="space-y-2">
                    <h3 className="text-sm font-medium">Gmail Preview</h3>
                    {previewMessages.length === 0 ? (
                      <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">Preview recent Gmail messages or search Gmail before importing.</div>
                    ) : previewMessages.map((message) => {
                      const importBadgeLabel = previewImportBadgeLabel(message);
                      return (
                      <div key={message.gmailMessageId} className="rounded-md border bg-background p-3">
                        <div className="flex items-start gap-3">
                          <Checkbox
                            checked={selectedPreviewIds.has(message.gmailMessageId)}
                            onCheckedChange={(checked) => togglePreview(message.gmailMessageId, checked === true)}
                            aria-label={`Select ${messageTitle(message)}`}
                            disabled={message.alreadyImported}
                          />
                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex items-start justify-between gap-2">
                              <p className="truncate text-sm font-medium">{messageTitle(message)}</p>
                              {importBadgeLabel && <Badge variant="secondary">{importBadgeLabel}</Badge>}
                            </div>
                            <p className="truncate text-xs text-muted-foreground">{message.fromName || message.fromEmail} · {formatDate(message.receivedAt)}</p>
                            {message.snippet && <p className="line-clamp-2 text-xs text-muted-foreground">{message.snippet}</p>}
                            <Button type="button" size="sm" variant="outline" onClick={() => void importAndOpen(message)} disabled={!!message.alreadyImported} className="mt-2 gap-2">
                              <Download className="h-4 w-4" />
                              Import and open
                            </Button>
                          </div>
                        </div>
                      </div>
                      );
                    })}
                  </div>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>

        <div className="grid min-h-[680px] lg:grid-cols-[minmax(340px,460px)_1fr]">
          <Card className="min-h-[620px]">
            <CardHeader className="border-b">
              <CardTitle className="flex items-center gap-2 text-base">
                <Inbox className="h-4 w-4" />
                Imported CRM Mail
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {importedQuery.isLoading ? (
                <p className="text-sm text-muted-foreground">Loading imported mail...</p>
              ) : importedMessages.length === 0 ? (
                <p className="text-sm text-muted-foreground">No imported messages match this filter.</p>
              ) : importedMessages.map((message) => (
                <div key={message.id} className={`flex gap-3 border-b py-3 last:border-0 ${selectedImported?.id === message.id ? "bg-primary/5 -mx-3 px-3" : ""}`}>
                  <Checkbox
                    checked={selectedImportedIds.has(message.id)}
                    onCheckedChange={(checked) => toggleImported(message.id, checked === true)}
                    aria-label={`Select imported ${messageTitle(message)}`}
                    className="mt-1"
                  />
                  <button
                    type="button"
                    onClick={() => void selectImportedMessage(message)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{messageTitle(message)}</p>
                        <p className="truncate text-xs text-muted-foreground">{message.fromName || message.fromEmail}</p>
                      </div>
                      <Badge variant={message.status === "needs_action" ? "destructive" : "secondary"}>{mailStatusLabel(message.status)}</Badge>
                    </div>
                    {message.snippet && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{message.snippet}</p>}
                    <p className="mt-2 text-xs text-muted-foreground">{formatDate(message.receivedAt)}</p>
                    {(message.linkedEnquiryId || message.linkedCaseId) && <p className="mt-1 text-xs text-primary">Linked enquiry/case</p>}
                  </button>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="min-h-[620px] rounded-none border-0 border-l">
            <CardHeader className="border-b">
              <CardTitle className="text-base">Message Detail</CardTitle>
            </CardHeader>
            <CardContent className="p-5">
              {!selectedImported ? (
                <div className="flex min-h-[520px] items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">Select an imported email to view its contents.</div>
              ) : (
                <div className="space-y-5">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-xl font-semibold">{messageTitle(selectedImported)}</h2>
                      <Badge variant={selectedImported.status === "needs_action" ? "destructive" : "secondary"}>{mailStatusLabel(selectedImported.status)}</Badge>
                    </div>
                    {(selectedImported.status === "converted" || selectedImported.status === "case_linked") && (selectedImported.linkedEnquiryId || selectedImported.linkedCaseId) && (
                      <div className="flex flex-wrap gap-2 rounded-md border bg-muted/40 p-3">
                        {selectedImported.linkedEnquiryId && (
                          <Button asChild variant="outline" size="sm" className="gap-2">
                            <Link href={`/enquiries/${selectedImported.linkedEnquiryId}`}>
                              <ExternalLink className="h-4 w-4" />
                              View enquiry
                            </Link>
                          </Button>
                        )}
                        {selectedImported.linkedCaseId && (
                          <Button asChild variant="outline" size="sm" className="gap-2">
                            <Link href={`/cases/${selectedImported.linkedCaseId}`}>
                              <ExternalLink className="h-4 w-4" />
                              View case
                            </Link>
                          </Button>
                        )}
                      </div>
                    )}
                    <div className="grid gap-1 text-sm text-muted-foreground">
                      <p>From {selectedImported.fromName ? `${selectedImported.fromName} <${selectedImported.fromEmail}>` : selectedImported.fromEmail}</p>
                      <p>To {selectedImported.toEmails || "Unknown"}</p>
                      {selectedImported.ccEmails && <p>Cc {selectedImported.ccEmails}</p>}
                      <p>Received {formatDate(selectedImported.receivedAt)}</p>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 border-y py-3">
                    {selectedImported.status !== "converted" && selectedImported.status !== "case_linked" && !selectedImported.linkedCaseEmailMessageId ? (
                      <Button type="button" onClick={() => openConvert(selectedImported)} size="sm" className="gap-2">
                        <Check className="h-4 w-4" />
                        Convert to enquiry
                      </Button>
                    ) : null}
                    <Button type="button" variant="outline" size="sm" onClick={() => void copySenderEmail(selectedImported)} className="gap-2">
                      <Copy className="h-4 w-4" />
                      Copy sender email
                    </Button>
                    {selectedImported.status === "needs_action" ? (
                      <Button type="button" variant="outline" size="sm" onClick={() => runMailAction(selectedImported, "clear_needs_action")} className="gap-2">
                        <Flag className="h-4 w-4" />
                        Clear needs action
                      </Button>
                    ) : (
                      <Button type="button" variant="outline" size="sm" onClick={() => runMailAction(selectedImported, "needs_action")} className="gap-2">
                        <Flag className="h-4 w-4" />
                        Mark needs action
                      </Button>
                    )}
                    {selectedImported.status === "archived" ? (
                      <Button type="button" variant="outline" size="sm" onClick={() => runMailAction(selectedImported, "restore")} className="gap-2">
                        <RotateCcw className="h-4 w-4" />
                        Restore
                      </Button>
                    ) : (
                      <Button type="button" variant="outline" size="sm" onClick={() => runMailAction(selectedImported, "archive")} className="gap-2">
                        <Archive className="h-4 w-4" />
                        Archive
                      </Button>
                    )}
                    <Button type="button" variant="outline" size="sm" onClick={() => runMailAction(selectedImported, "delete")} className="gap-2 text-red-700">
                      <Trash2 className="h-4 w-4" />
                      Delete
                    </Button>
                  </div>

                  {selectedImported.bodyRefreshWarning && (
                    <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                      {selectedImported.bodyRefreshWarning}
                    </div>
                  )}

                  <div className="space-y-3">
                    {selectedImported.sanitizedHtmlBody && selectedImported.textBody && (
                      <div className="flex justify-end">
                        <div className="inline-flex rounded-md border bg-muted p-1">
                          <Button
                            type="button"
                            variant={bodyView === "html" ? "secondary" : "ghost"}
                            size="sm"
                            onClick={() => setBodyView("html")}
                          >
                            HTML
                          </Button>
                          <Button
                            type="button"
                            variant={bodyView === "text" ? "secondary" : "ghost"}
                            size="sm"
                            onClick={() => setBodyView("text")}
                          >
                            Plain text
                          </Button>
                        </div>
                      </div>
                    )}

                    <div className="rounded-md border bg-background p-4">
                      {selectedImported.sanitizedHtmlBody && bodyView === "html" ? (
                        <div
                          className="prose prose-sm max-w-none break-words [&_img]:max-w-full [&_table]:max-w-full [&_td]:align-top"
                          dangerouslySetInnerHTML={{ __html: selectedImported.sanitizedHtmlBody }}
                        />
                      ) : selectedImported.textBody ? (
                      <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-6 text-foreground">
                        {selectedImported.textBody}
                      </pre>
                      ) : selectedImported.snippet ? (
                        <div className="space-y-2">
                          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Only the Gmail snippet is available</p>
                          <p className="whitespace-pre-wrap break-words text-sm leading-6 text-foreground">{selectedImported.snippet}</p>
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">No message body available.</p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={convertOpen} onOpenChange={setConvertOpen}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Convert to enquiry</DialogTitle>
            <DialogDescription>
              Review the prefilled enquiry details before creating the normal enquiry record.
            </DialogDescription>
          </DialogHeader>

          <form
            className="grid gap-4 md:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              convertMutation.mutate(enquiryDraft);
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="firstName">First name</Label>
              <Input id="firstName" value={enquiryDraft.firstName} onChange={(event) => updateDraft("firstName", event.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lastName">Last name</Label>
              <Input id="lastName" value={enquiryDraft.lastName} onChange={(event) => updateDraft("lastName", event.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={enquiryDraft.email} onChange={(event) => updateDraft("email", event.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="mobileTelephone">Mobile telephone</Label>
              <Input id="mobileTelephone" value={enquiryDraft.mobileTelephone} onChange={(event) => updateDraft("mobileTelephone", event.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contactMethod">Contact method</Label>
              <Select value={enquiryDraft.contactMethod} onValueChange={(value) => updateDraft("contactMethod", value as EnquiryDraft["contactMethod"])}>
                <SelectTrigger id="contactMethod"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ENQUIRY_CONTACT_METHODS.map((method) => <SelectItem key={method} value={method}>{method}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="referralType">Referral type</Label>
              <Select value={enquiryDraft.referralType} onValueChange={(value) => updateDraft("referralType", value)}>
                <SelectTrigger id="referralType"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {REFERRAL_TYPES.map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="issueType">Mediation type</Label>
              <Select value={enquiryDraft.issueType} onValueChange={(value) => updateDraft("issueType", value)}>
                <SelectTrigger id="issueType"><SelectValue placeholder="Select mediation type" /></SelectTrigger>
                <SelectContent>
                  {ISSUE_TYPES.map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="leadSource">Lead source</Label>
              <Select value={enquiryDraft.leadSource} onValueChange={(value) => updateDraft("leadSource", value)}>
                <SelectTrigger id="leadSource"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LEAD_SOURCES.map((source) => <SelectItem key={source} value={source}>{source}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {enquiryDraft.leadSource === "Other (please specify)" && (
              <div className="space-y-2">
                <Label htmlFor="leadSourceOther">Lead source detail</Label>
                <Input id="leadSourceOther" value={enquiryDraft.leadSourceOther || ""} onChange={(event) => updateDraft("leadSourceOther", event.target.value)} />
              </div>
            )}
            {enquiryDraft.issueType === "Other (please give details below)" && (
              <div className="space-y-2">
                <Label htmlFor="issueTypeOther">Mediation type detail</Label>
                <Input id="issueTypeOther" value={enquiryDraft.issueTypeOther || ""} onChange={(event) => updateDraft("issueTypeOther", event.target.value)} />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="addressLine1">Address line 1</Label>
              <Input id="addressLine1" value={enquiryDraft.addressLine1} onChange={(event) => updateDraft("addressLine1", event.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="postcode">Postcode</Label>
              <Input id="postcode" value={enquiryDraft.postcode} onChange={(event) => updateDraft("postcode", event.target.value)} required />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea id="notes" value={enquiryDraft.notes || ""} onChange={(event) => updateDraft("notes", event.target.value)} rows={8} />
            </div>
            <div className="flex justify-end gap-2 md:col-span-2">
              <Button type="button" variant="outline" onClick={() => setConvertOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={convertMutation.isPending}>
                {convertMutation.isPending ? "Creating..." : "Create enquiry"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <DeleteDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="Delete imported email from active inbox views?"
        description="This only removes the imported CRM copy from active inbox views. The original email stays in Gmail, and this imported record can be restored from Deleted mail."
        onConfirm={() => {
          if (deleteTarget) {
            mailActionMutation.mutate({ id: deleteTarget.id, action: "delete" });
          }
        }}
        confirmLabel="Delete"
        cancelTestId="button-cancel-delete-imported-mail"
        confirmTestId="button-confirm-delete-imported-mail"
        isPending={mailActionMutation.isPending}
      />

      <DeleteDialog
        open={bulkDeleteOpen}
        onOpenChange={setBulkDeleteOpen}
        title="Delete selected imported emails from active inbox views?"
        description="This only removes the selected imported CRM copies from active inbox views. The original emails stay in Gmail, and these imported records can be restored from Deleted mail."
        onConfirm={() => bulkActionMutation.mutate("delete")}
        confirmLabel="Delete"
        cancelTestId="button-cancel-bulk-delete-imported-mail"
        confirmTestId="button-confirm-bulk-delete-imported-mail"
        isPending={bulkActionMutation.isPending}
      />
    </div>
  );
}
