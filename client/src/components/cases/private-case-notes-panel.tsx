import { useMutation, useQuery } from "@tanstack/react-query";
import { Download, LockKeyhole, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";

type Attachment = {
  id: string;
  fileName: string | null;
  status: string;
  retryCount: number;
  detectedMimeType: string | null;
  redactedAt: string | null;
};

type PrivateNote = {
  id: string;
  body: string | null;
  authorNameSnapshot: string;
  authorRoleSnapshot: string;
  completedAt: string | null;
  textRedactedAt: string | null;
  attachments: Attachment[];
};

function statusText(status: string, retryCount: number): string {
  if (["queued", "downloading", "quarantined", "scanning"].includes(status)) return "Attachment is being checked";
  if (status === "blocked") return "Attachment was blocked because its type or size is not allowed";
  if (status === "redacted") return "Attachment was redacted";
  if (status === "failed" && retryCount >= 6) return "Attachment processing failed";
  if (status === "failed") return "Attachment is temporarily unavailable";
  return status;
}

export function PrivateCaseNotesPanel({ caseId }: { caseId: string }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const isAdmin = user?.role === "superadmin" || user?.role === "subadmin";
  const notes = useQuery<PrivateNote[]>({
    queryKey: ["/api/cases", caseId, "private-notes"],
    queryFn: async () => {
      const response = await fetch(`/api/cases/${caseId}/private-notes`, { credentials: "include" });
      if (!response.ok) throw new Error("Private notes are not available");
      return response.json();
    },
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: 10_000,
  });
  const retryAttachment = useMutation({
    mutationFn: async ({ noteId, attachmentId }: { noteId: string; attachmentId: string }) => {
      const response = await fetch(`/api/cases/${caseId}/private-notes/${noteId}/attachments/${attachmentId}/retry`, {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) throw new Error("Attachment could not be retried");
    },
    onSuccess: async () => {
      await notes.refetch();
      toast({ title: "Attachment queued for processing" });
    },
    onError: () => toast({ title: "Failed to retry attachment", variant: "destructive" }),
  });

  if (notes.isLoading) return <p className="text-sm text-muted-foreground">Loading private notes…</p>;
  if (notes.isError) {
    return (
      <Card data-testid="private-notes-error">
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="font-medium">Failed to load private notes</p>
          <p className="text-sm text-muted-foreground">Please try again. Your private note permissions have not changed.</p>
          <Button variant="outline" onClick={() => notes.refetch()}>Retry</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4" data-testid="private-case-notes">
      <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        <LockKeyhole className="mr-2 inline h-4 w-4" />
        Private WhatsApp notes are isolated from general case notes and communication previews.
      </div>
      {notes.data?.length ? notes.data.map((note) => (
        <Card key={note.id}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              {note.authorNameSnapshot} <Badge variant="outline" className="ml-2">{note.authorRoleSnapshot}</Badge>
            </CardTitle>
            <p className="text-xs text-muted-foreground">{note.completedAt ? new Date(note.completedAt).toLocaleString() : "Received"}</p>
          </CardHeader>
          <CardContent className="space-y-3">
            {note.textRedactedAt ? <p className="italic text-muted-foreground">Note text redacted</p> : <p className="whitespace-pre-wrap text-sm">{note.body}</p>}
            <div className="flex flex-wrap gap-2">
              {note.attachments.map((file) => file.status === "clean" ? (
                <Button key={file.id} size="sm" variant="outline" asChild>
                  <a href={`/api/cases/${caseId}/private-notes/${note.id}/attachments/${file.id}/download`}>
                    <Download className="mr-2 h-4 w-4" />{file.fileName || "Attachment"}
                  </a>
                </Button>
              ) : (
                <div key={file.id} className="flex items-center gap-2">
                  <Badge variant={file.status === "blocked" ? "destructive" : "outline"}>
                    {file.fileName || "Attachment"}: {statusText(file.status, file.retryCount)}
                  </Badge>
                  {isAdmin && file.status === "failed" && file.retryCount >= 6 ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={retryAttachment.isPending}
                      onClick={() => retryAttachment.mutate({ noteId: note.id, attachmentId: file.id })}
                    >
                      <RotateCcw className="mr-2 h-4 w-4" />Retry
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )) : (
        <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          No private WhatsApp notes are available to you for this case. Only notes you submit through WhatsApp will appear here.
        </div>
      )}
    </div>
  );
}
