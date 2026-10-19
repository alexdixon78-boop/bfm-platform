import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2, FileText, RefreshCw, RotateCcw, Upload, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient, refreshClientDashboardActions } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { DOCUMENT_REQUEST_CATALOGUE, MAX_DOCUMENT_REQUEST_UPLOAD_BYTES, validateDocumentRequestUpload } from "@shared/document-request";
import { useLocation } from "wouter";

type RequestParty = {
  id: string;
  role: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  userId?: string | null;
};

type Submission = {
  id: string;
  fileName: string;
  fileUrl: string;
  mimeType?: string | null;
  fileSizeBytes?: number | null;
  createdAt: string | Date;
};

type DocumentRequest = {
  id: string;
  partyId: string;
  documentType: string;
  documentName: string;
  instructions?: string | null;
  status: "outstanding" | "submitted" | "completed" | "cancelled";
  deliveryStatus: "not_attempted" | "sent" | "failed";
  deliveryError?: string | null;
  returnReason?: string | null;
  createdAt: string | Date;
  submissions: Submission[];
};

type Props = {
  caseId: string;
  parties: RequestParty[];
  canManage: boolean;
  canView: boolean;
};

function partyName(party?: RequestParty): string {
  if (!party) return "Client";
  return `${party.firstName || ""} ${party.lastName || ""}`.trim() || `Client ${party.role}`;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Unable to read file"));
    reader.readAsDataURL(file);
  });
}

export function CaseDocumentRequestsSection({ caseId, parties, canManage, canView }: Props) {
  const { toast } = useToast();
  const [location] = useLocation();
  const [documentType, setDocumentType] = useState("");
  const [customDocumentName, setCustomDocumentName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [selectedPartyIds, setSelectedPartyIds] = useState<string[]>([]);
  const [returnReasons, setReturnReasons] = useState<Record<string, string>>({});
  const [selectedFiles, setSelectedFiles] = useState<Record<string, File | undefined>>({});
  const highlightedRequestId = useMemo(
    () => new URLSearchParams(location.split("?")[1] || "").get("documentRequestId"),
    [location],
  );

  const { data, isLoading } = useQuery<{ ok: true; requests: DocumentRequest[] }>({
    queryKey: ["/api/cases", caseId, "document-requests"],
    queryFn: async () => {
      const response = await fetch(`/api/cases/${caseId}/document-requests`, { credentials: "include", cache: "no-store" });
      if (!response.ok) throw new Error("Unable to load document requests");
      return response.json();
    },
    enabled: canView,
  });
  const requests = data?.requests || [];

  useEffect(() => {
    if (!highlightedRequestId || !requests.some((request) => request.id === highlightedRequestId)) return;
    document.getElementById(`document-request-${highlightedRequestId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightedRequestId, requests]);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "document-requests"] });
    await refreshClientDashboardActions();
  };

  const createMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/cases/${caseId}/document-requests`, {
      partyIds: selectedPartyIds,
      documentType,
      customDocumentName: documentType === "other" ? customDocumentName : undefined,
      instructions: instructions.trim() || undefined,
    }),
    onSuccess: async () => {
      setSelectedPartyIds([]);
      setDocumentType("");
      setCustomDocumentName("");
      setInstructions("");
      await refresh();
      toast({ title: "Document request created" });
    },
    onError: (error: Error) => toast({ title: "Could not create request", description: error.message, variant: "destructive" }),
  });

  const actionMutation = useMutation({
    mutationFn: ({ requestId, action, body }: { requestId: string; action: string; body?: unknown }) =>
      apiRequest("POST", `/api/document-requests/${requestId}/${action}`, body),
    onSuccess: refresh,
    onError: (error: Error) => toast({ title: "Could not update request", description: error.message, variant: "destructive" }),
  });

  const submitMutation = useMutation({
    mutationFn: async ({ requestId, file }: { requestId: string; file: File }) => {
      const validation = validateDocumentRequestUpload({ fileName: file.name, mimeType: file.type, sizeBytes: file.size });
      if (!validation.ok) throw new Error(validation.error);
      return apiRequest("POST", `/api/document-requests/${requestId}/submit`, {
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        fileSizeBytes: file.size,
        fileData: await fileToDataUrl(file),
      });
    },
    onSuccess: async (_, variables) => {
      setSelectedFiles((current) => ({ ...current, [variables.requestId]: undefined }));
      await refresh();
      toast({ title: "Document uploaded" });
    },
    onError: (error: Error) => toast({ title: "Could not upload document", description: error.message, variant: "destructive" }),
  });

  if (!canView) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" />Document Requests</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {canManage && (
          <div className="space-y-4 rounded-md border p-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Requested document</Label>
                <Select value={documentType} onValueChange={setDocumentType}>
                  <SelectTrigger><SelectValue placeholder="Select a document" /></SelectTrigger>
                  <SelectContent>
                    {DOCUMENT_REQUEST_CATALOGUE.map((item) => <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {documentType === "other" && (
                <div className="space-y-2">
                  <Label htmlFor="custom-document-name">Document name</Label>
                  <Input id="custom-document-name" value={customDocumentName} onChange={(event) => setCustomDocumentName(event.target.value)} required />
                </div>
              )}
            </div>
            <div className="space-y-2">
              <Label>Clients</Label>
              <div className="grid gap-2 md:grid-cols-2">
                {parties.map((party) => {
                  const linked = Boolean(party.userId && party.email);
                  return (
                    <label key={party.id} className={cn("flex items-start gap-3 rounded-md border p-3", !linked && "opacity-60")}>
                      <Checkbox
                        checked={selectedPartyIds.includes(party.id)}
                        disabled={!linked}
                        onCheckedChange={(checked) => setSelectedPartyIds((current) => checked ? [...current, party.id] : current.filter((id) => id !== party.id))}
                      />
                      <span className="text-sm">
                        <span className="block font-medium">{partyName(party)}</span>
                        <span className="text-muted-foreground">{linked ? party.email : "Invite/link this client to a portal account first."}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">Every selected client receives an independent request.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="document-request-instructions">Instructions (optional)</Label>
              <Textarea id="document-request-instructions" value={instructions} onChange={(event) => setInstructions(event.target.value)} />
            </div>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={!documentType || selectedPartyIds.length === 0 || (documentType === "other" && !customDocumentName.trim()) || createMutation.isPending}
            >Create request</Button>
          </div>
        )}

        {isLoading && <p className="text-sm text-muted-foreground">Loading document requests…</p>}
        {!isLoading && requests.length === 0 && <p className="text-sm text-muted-foreground">No document requests have been created.</p>}
        {requests.map((request) => {
          const party = parties.find((item) => item.id === request.partyId);
          const latest = request.submissions[0];
          const highlighted = highlightedRequestId === request.id;
          const reason = returnReasons[request.id] || "";
          const selectedFile = selectedFiles[request.id];
          return (
            <section
              id={`document-request-${request.id}`}
              key={request.id}
              className={cn("space-y-3 rounded-md border p-4 transition", highlighted && "border-primary ring-2 ring-primary/30")}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-medium">{request.documentName}</h3>
                  {canManage && <p className="text-sm text-muted-foreground">Recipient: {partyName(party)}</p>}
                  {request.instructions && <p className="mt-1 text-sm">{request.instructions}</p>}
                </div>
                <div className="flex gap-2"><Badge variant="outline">{request.status}</Badge>{canManage && <Badge variant={request.deliveryStatus === "failed" ? "destructive" : "secondary"}>Email: {request.deliveryStatus}</Badge>}</div>
              </div>

              {request.returnReason && <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-900"><strong>Returned:</strong> {request.returnReason}</div>}
              {latest && <p className="text-sm">Latest submission: <a className="text-primary underline" href={latest.fileUrl}>{latest.fileName}</a></p>}
              {request.submissions.length > 0 && (
                <details className="text-sm">
                  <summary className="cursor-pointer font-medium">Previous submissions</summary>
                  <ul className="mt-2 space-y-1 pl-5">
                    {request.submissions.map((submission) => <li key={submission.id}><a className="text-primary underline" href={submission.fileUrl}>{submission.fileName}</a></li>)}
                  </ul>
                </details>
              )}

              {!canManage && request.status === "outstanding" && (
                <div className="space-y-2">
                  <Input
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx,.csv"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file && file.size > MAX_DOCUMENT_REQUEST_UPLOAD_BYTES) {
                        toast({ title: "File is too large", description: "Choose one file that is 25MB or smaller.", variant: "destructive" });
                        event.target.value = "";
                        return;
                      }
                      setSelectedFiles((current) => ({ ...current, [request.id]: file }));
                    }}
                  />
                  <p className="text-xs text-muted-foreground">Upload one PDF, JPEG/PNG, Word, Excel, or CSV file that is 25MB or smaller.</p>
                  <Button disabled={!selectedFile || submitMutation.isPending} onClick={() => selectedFile && submitMutation.mutate({ requestId: request.id, file: selectedFile })}>
                    <Upload className="mr-2 h-4 w-4" />Upload document
                  </Button>
                </div>
              )}

              {canManage && (
                <div className="space-y-3">
                  {request.deliveryStatus === "failed" && request.deliveryError && <p className="text-sm text-destructive">{request.deliveryError}</p>}
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => actionMutation.mutate({ requestId: request.id, action: "resend" })}><RefreshCw className="mr-2 h-4 w-4" />Resend email</Button>
                    {request.status === "submitted" && <Button size="sm" onClick={() => actionMutation.mutate({ requestId: request.id, action: "complete" })}><CheckCircle2 className="mr-2 h-4 w-4" />Mark complete</Button>}
                    {(request.status === "outstanding" || request.status === "submitted") && <Button variant="destructive" size="sm" onClick={() => actionMutation.mutate({ requestId: request.id, action: "cancel" })}><XCircle className="mr-2 h-4 w-4" />Cancel</Button>}
                  </div>
                  {request.status === "submitted" && (
                    <div className="space-y-2 rounded-md bg-muted p-3">
                      <Label htmlFor={`return-reason-${request.id}`}>Return reason</Label>
                      <Textarea id={`return-reason-${request.id}`} value={reason} onChange={(event) => setReturnReasons((current) => ({ ...current, [request.id]: event.target.value }))} />
                      {!reason.trim() && <p className="text-xs text-muted-foreground">A return reason is required.</p>}
                      <Button variant="outline" size="sm" disabled={!reason.trim()} onClick={() => actionMutation.mutate({ requestId: request.id, action: "return", body: { reason } })}><RotateCcw className="mr-2 h-4 w-4" />Return for another upload</Button>
                    </div>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </CardContent>
    </Card>
  );
}
