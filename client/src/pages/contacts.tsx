import { useQuery, useMutation } from "@tanstack/react-query";
import { useMemo } from "react";
import { Link } from "wouter";
import {
  Users, Plus, Pencil, Trash2, Send, Mail, Phone,
  ShieldCheck, ShieldAlert, ShieldQuestion, ShieldX, ExternalLink, Unlink,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { type ClientRepresentative } from "@shared/schema";
import {
  MasterRepDialog,
  AttachToCaseDialog,
  REP_TYPE_LABELS as TYPE_LABELS,
  type AttachableCase,
} from "@/components/master-rep-dialogs";

/** Server payload from `GET /api/representatives/mine` after Task #202 reshape. */
type MineAttachment = {
  attachmentId: string;
  caseId: string;
  caseRef: string;
  caseStatus: string;
  issueType: string | null;
  partyId: string;
  partyRole: string;
  consentStatus: string;
  notes: string | null;
  preferredChannel: string | null;
  otherParties: Array<{ role: string; name: string }>;
};
type MineMaster = { master: ClientRepresentative; attachments: MineAttachment[] };
type MineResponse = { masters: MineMaster[]; myCases: AttachableCase[]; ownClientId: string };

function statusBadge(status: string) {
  const map: Record<string, { label: string; cls: string; Icon: typeof ShieldCheck }> = {
    pending:   { label: "Not yet requested", cls: "bg-stone-100 text-stone-700 border-stone-300", Icon: ShieldQuestion },
    sent:      { label: "Awaiting response",  cls: "bg-amber-50 text-amber-700 border-amber-300",  Icon: ShieldAlert },
    granted:   { label: "Consent granted",    cls: "bg-emerald-50 text-emerald-700 border-emerald-300", Icon: ShieldCheck },
    withdrawn: { label: "Consent withdrawn",  cls: "bg-stone-100 text-stone-700 border-stone-300", Icon: ShieldX },
    refused:   { label: "Consent refused",    cls: "bg-red-50 text-red-700 border-red-300",        Icon: ShieldX },
  };
  const s = map[status] || map.pending;
  return (
    <Badge variant="outline" className={`text-xs ${s.cls}`} data-testid={`badge-rep-status-${status}`}>
      <s.Icon className="w-3 h-3 mr-1" /> {s.label}
    </Badge>
  );
}

// MasterRepDialog and AttachToCaseDialog were extracted to
// `client/src/components/master-rep-dialogs.tsx` so the staff client-detail
// Sheet (clients.tsx) can reuse the exact same forms. Keeping them in one
// place prevents portal/staff drift on the form schema.

function MasterCard({
  master, attachments, myCases, ownClientId,
}: {
  master: ClientRepresentative;
  attachments: MineAttachment[];
  myCases: AttachableCase[];
  ownClientId: string;
}) {
  const { toast } = useToast();
  const sendConsent = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/representatives/${id}/send-consent`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/representatives/mine"] });
      toast({ title: "Consent request sent" });
    },
    onError: (err: Error) => toast({ variant: "destructive", title: "Could not send", description: err.message }),
  });
  const detach = useMutation({
    mutationFn: (attachmentId: string) => apiRequest("DELETE", `/api/representatives/${attachmentId}`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/representatives/mine"] });
      toast({ title: "Detached from case", description: "They remain in your contacts." });
    },
    onError: (err: Error) => toast({ variant: "destructive", title: "Could not detach", description: err.message }),
  });
  const deleteMaster = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/client-representatives/${master.id}`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/representatives/mine"] });
      toast({ title: "Representative deleted" });
    },
    onError: (err: Error) =>
      toast({ variant: "destructive", title: "Could not delete", description: err.message || "Detach from all cases first." }),
  });

  const alreadyAttachedCaseIds = useMemo(
    () => new Set(attachments.map((a) => a.caseId)),
    [attachments],
  );

  return (
    <Card className="border-stone-200" data-testid={`card-contacts-master-${master.id}`}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <CardTitle className="text-base font-heading flex items-center gap-2 flex-wrap">
              <span data-testid={`text-rep-name-${master.id}`}>{master.fullName}</span>
              <Badge variant="secondary" className="text-xs">{TYPE_LABELS[master.type] || master.type}</Badge>
            </CardTitle>
            {(master.roleTitle || master.organisation) && (
              <p className="text-xs text-stone-600 mt-1">
                {[master.roleTitle, master.organisation].filter(Boolean).join(" — ")}
              </p>
            )}
            <div className="flex flex-wrap gap-3 mt-1 text-xs text-stone-500">
              {master.email && (
                <span className="inline-flex items-center gap-1"><Mail className="w-3 h-3" />{master.email}</span>
              )}
              {master.phone && (
                <span className="inline-flex items-center gap-1"><Phone className="w-3 h-3" />{master.phone}</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <AttachToCaseDialog
              master={master}
              cases={myCases}
              alreadyAttachedCaseIds={alreadyAttachedCaseIds}
            />
            <MasterRepDialog
              clientId={ownClientId}
              existing={master}
              trigger={
                <Button variant="ghost" size="sm" data-testid={`button-edit-master-${master.id}`}>
                  <Pencil className="w-3 h-3 mr-1" /> Edit
                </Button>
              }
            />
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost" size="sm"
                  className="text-red-600 hover:text-red-700"
                  data-testid={`button-delete-master-${master.id}`}
                >
                  <Trash2 className="w-3 h-3 mr-1" /> Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this representative entirely?</AlertDialogTitle>
                  <AlertDialogDescription>
                    {attachments.length > 0
                      ? `${master.fullName} is currently attached to ${attachments.length} case${attachments.length === 1 ? "" : "s"}. Detach them from each case first.`
                      : `This will permanently remove ${master.fullName} from your contacts. This action is audit-logged.`}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-red-600 hover:bg-red-700 text-white"
                    disabled={attachments.length > 0}
                    onClick={() => deleteMaster.mutate()}
                  >Delete</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {attachments.length === 0 && (
          <p className="text-sm text-muted-foreground" data-testid={`text-no-attachments-${master.id}`}>
            Not attached to any case yet.
          </p>
        )}
        {attachments.map((att) => (
          <div
            key={att.attachmentId}
            className="border border-stone-200 rounded-md p-3 hover-elevate"
            data-testid={`attachment-card-${att.attachmentId}`}
          >
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <Link href={`/cases/${att.caseId}`}>
                    <button
                      className="text-sm font-medium text-[#5a7d58] hover:underline inline-flex items-center gap-1"
                      data-testid={`link-open-case-${att.caseId}`}
                    >
                      Case {att.caseRef}
                      <ExternalLink className="w-3 h-3" />
                    </button>
                  </Link>
                  <Badge variant="outline" className="text-xs">{att.caseStatus}</Badge>
                  <Badge variant="secondary" className="text-xs">Client {att.partyRole}</Badge>
                  {statusBadge(att.consentStatus)}
                </div>
                {att.otherParties.length > 0 && (
                  <p className="text-xs text-stone-600 mt-0.5">
                    With: {att.otherParties.map(p => `${p.name}${p.role ? ` (Party ${p.role})` : ""}`).join(", ")}
                  </p>
                )}
                {att.notes && (<p className="text-xs text-stone-600 mt-2 whitespace-pre-wrap">{att.notes}</p>)}
              </div>
              <div className="flex flex-col gap-1 flex-shrink-0">
                {master.email && att.consentStatus !== "granted" && (
                  <Button
                    variant="ghost" size="sm"
                    onClick={() => sendConsent.mutate(att.attachmentId)}
                    disabled={sendConsent.isPending}
                    data-testid={`button-send-consent-${att.attachmentId}`}
                  >
                    <Send className="w-3 h-3 mr-1" />
                    {att.consentStatus === "sent" ? "Resend" : "Request consent"}
                  </Button>
                )}
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="sm" className="text-red-600 hover:text-red-700" data-testid={`button-detach-${att.attachmentId}`}>
                      <Unlink className="w-3 h-3 mr-1" /> Remove from case
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Remove from this case?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will detach {master.fullName} from case {att.caseRef}. Their contact details will
                        remain in your master contacts list and can be re-attached at any time.
                        This action is audit-logged.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        className="bg-red-600 hover:bg-red-700 text-white"
                        onClick={() => detach.mutate(att.attachmentId)}
                      >Detach</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export default function ContactsPage() {
  const { data, isLoading } = useQuery<MineResponse>({ queryKey: ["/api/representatives/mine"] });
  const masters = data?.masters ?? [];
  const myCases = data?.myCases ?? [];
  const ownClientId = data?.ownClientId ?? "";

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6 max-w-5xl mx-auto" data-testid="contacts-page">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-md bg-[#dcae96]/15">
            <Users className="w-5 h-5 text-[#b8825a]" />
          </div>
          <div>
            <h1 className="text-2xl font-heading font-semibold" data-testid="text-contacts-title">My Contacts</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Manage your representatives — solicitors, HR contacts, advocates, or anyone supporting you through mediation.
              Each rep is saved once and can be attached to any of your cases. They need to give GDPR consent before BFM
              staff can share information with them.
            </p>
          </div>
        </div>
        {ownClientId && (
          <MasterRepDialog
            clientId={ownClientId}
            trigger={
              <Button data-testid="button-add-master-rep">
                <Plus className="w-4 h-4 mr-1" /> Add representative
              </Button>
            }
          />
        )}
      </div>

      {isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      )}

      {!isLoading && !ownClientId && (
        <Card data-testid="card-no-client-record">
          <CardContent className="py-12 text-center">
            <Users className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm font-medium">We can't find a client record matching your account yet.</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
              Once BFM staff link your account to your case, your representatives will appear here
              and you'll be able to add new ones. If you've already had an enquiry or case opened,
              please ask BFM to link your account.
            </p>
          </CardContent>
        </Card>
      )}

      {!isLoading && ownClientId && masters.length === 0 && (
        <Card data-testid="card-no-reps">
          <CardContent className="py-12 text-center">
            <Users className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm font-medium">You haven't added any representatives yet.</p>
            <p className="text-xs text-muted-foreground mt-1">
              {myCases.length === 0
                ? "Once a case is opened for you, you'll be able to add representatives here."
                : "Add your first solicitor, HR contact, or advocate to get started."}
            </p>
          </CardContent>
        </Card>
      )}

      {!isLoading && masters.map((m) => (
        <MasterCard
          key={m.master.id}
          master={m.master}
          attachments={m.attachments}
          myCases={myCases}
          ownClientId={ownClientId}
        />
      ))}
    </div>
  );
}
