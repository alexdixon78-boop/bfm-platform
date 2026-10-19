import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Link } from "wouter";
import { ArrowRightCircle, ExternalLink, Pencil, Clock, ShieldCheck, FileCheck2, Send, FileText, UserCheck, XCircle } from "lucide-react";
import { STAGE_LABEL, type PipelineCard } from "./types";
import { InlineApplicantEdit } from "./inline-applicant-edit";
import { ApplicantCompliancePanel } from "./applicant-compliance-panel";
import { ApplicantContractPanel } from "./applicant-contract-panel";
import { ApplicantApplicationDialog } from "./applicant-application-dialog";
import { AcceptInterviewDialog } from "./accept-interview-dialog";
import { RejectApplicantDialog } from "./reject-applicant-dialog";
import { usePermissions } from "@/hooks/use-permissions";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

const COMPLIANCE_STAGES = new Set([
  "reference_credential_check",
  "contract_issued",
  "onboarded",
]);
// Task #208 — Contract panel only available from the "Contract issued"
// stage onwards (and pre-conversion). Reference & credential check stage
// is credentials-only.
const CONTRACT_STAGES = new Set([
  "contract_issued",
  "onboarded",
]);

// Task #244 — Resend form only at early application stages
const RESEND_FORM_STAGES = new Set(["recruitment_approach", "interview"]);

type Activity = { id: string; timestamp: string; action: string; details: string | null; userId: string | null };

export function CardDetailDrawer({
  card, open, onClose, onConvert,
}: {
  card: PipelineCard | null;
  open: boolean;
  onClose: () => void;
  onConvert: (card: PipelineCard) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [resendOpen, setResendOpen] = useState(false);
  const [appDialogOpen, setAppDialogOpen] = useState(false);
  const [acceptDialogOpen, setAcceptDialogOpen] = useState(false);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  useEffect(() => {
    if (!open) {
      setEditing(false);
      setResendOpen(false);
      setAppDialogOpen(false);
      setAcceptDialogOpen(false);
      setRejectDialogOpen(false);
    }
  }, [open]);
  const { canEdit } = usePermissions();
  const { toast } = useToast();
  const canEditMediators = canEdit("mediators");

  const { data: activity, refetch: refetchActivity } = useQuery<Activity[]>({
    queryKey: ["/api/mediator-pipeline", card?.kind, card?.id, "timeline"],
    enabled: !!card,
    queryFn: async () => {
      const res = await fetch(`/api/mediator-pipeline/${card!.kind}/${card!.id}/timeline`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const resendMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/mediator-applicants/${id}/resend-form`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { message?: string }).message ?? "Failed to send");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Form sent", description: "The applicant has been emailed a personalised link to review their application." });
      refetchActivity();
    },
    onError: (err: Error) => {
      toast({ title: "Failed to send", description: err.message, variant: "destructive" });
    },
  });

  return (
    <>
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="sm:max-w-lg overflow-y-auto" data-testid="sheet-pipeline-card">
        {card && (
          <>
            <SheetHeader>
              <SheetTitle data-testid="text-drawer-name">{card.firstName} {card.lastName}</SheetTitle>
              <SheetDescription>{card.email}</SheetDescription>
            </SheetHeader>

            <div className="mt-4 space-y-4 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{STAGE_LABEL[card.stage]}</Badge>
                <Badge variant="outline" className="text-[10px] uppercase">{card.kind}</Badge>
                {card.panelStatus && <Badge variant="outline">Panel: {card.panelStatus}</Badge>}
              </div>

              <div className="grid grid-cols-3 gap-x-3 gap-y-2">
                <span className="text-muted-foreground">Phone</span><span className="col-span-2">{card.phone ?? "—"}</span>
                <span className="text-muted-foreground">Accreditation</span><span className="col-span-2">{card.accreditationStatus ?? "—"}</span>
                <span className="text-muted-foreground">Practice areas</span>
                <span className="col-span-2">
                  {card.areaOfPractice.length === 0 ? "—" : (
                    <span className="flex flex-wrap gap-1">
                      {card.areaOfPractice.map((a) => (
                        <Badge key={a} variant="secondary" className="text-[11px]">{a}</Badge>
                      ))}
                    </span>
                  )}
                </span>
                <span className="text-muted-foreground">Credentials</span><span className="col-span-2 capitalize">{card.credentialStatus}</span>
                <span className="text-muted-foreground">Insurance</span><span className="col-span-2 capitalize">{card.insuranceStatus}</span>
                {card.updatedAt && (
                  <>
                    <span className="text-muted-foreground">Last updated</span>
                    <span className="col-span-2">{new Date(card.updatedAt).toLocaleString()}</span>
                  </>
                )}
              </div>

              {card.kind === "mediator" && (
                <div className="grid grid-cols-1 gap-2">
                  <Link href={`/mediators/${card.id}`}>
                    <Button variant="outline" size="sm" className="w-full" data-testid="button-open-mediator">
                      <ExternalLink className="w-4 h-4 mr-2" />Open mediator profile
                    </Button>
                  </Link>
                  <div className="grid grid-cols-2 gap-2">
                    <Link href={`/mediators/${card.id}?tab=credentials`}>
                      <Button variant="outline" size="sm" className="w-full" data-testid="button-open-credentials">
                        <ShieldCheck className="w-4 h-4 mr-1" />Credentials
                      </Button>
                    </Link>
                    <Link href={`/mediators/${card.id}?tab=compliance`}>
                      <Button variant="outline" size="sm" className="w-full" data-testid="button-open-compliance">
                        <FileCheck2 className="w-4 h-4 mr-1" />Compliance
                      </Button>
                    </Link>
                  </div>
                </div>
              )}

              <Separator />

              <div>
                <h4 className="text-xs uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1">
                  <Clock className="w-3 h-3" />Activity timeline
                </h4>
                {(!activity || activity.length === 0) && (
                  <p className="text-xs text-muted-foreground italic">No recorded activity yet.</p>
                )}
                <ul className="space-y-2">
                  {activity?.slice(0, 15).map((a) => {
                    let detailText = "";
                    if (a.details) {
                      try {
                        const obj = JSON.parse(a.details);
                        detailText = obj.toStage ? `→ ${STAGE_LABEL[obj.toStage as keyof typeof STAGE_LABEL] ?? obj.toStage}` : (obj.kind ?? "");
                      } catch { /* ignore */ }
                    }
                    return (
                      <li key={a.id} className="text-xs border-l-2 border-muted pl-3 py-1">
                        <p className="font-medium">{a.action.replace(/_/g, " ")} {detailText && <span className="text-muted-foreground font-normal">{detailText}</span>}</p>
                        <p className="text-muted-foreground">{new Date(a.timestamp).toLocaleString()}</p>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>

            {card.kind === "applicant" && editing && (
              <>
                <Separator className="my-4" />
                <h4 className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Edit applicant</h4>
                <InlineApplicantEdit card={card} onDone={() => setEditing(false)} />
              </>
            )}

            {card.kind === "applicant" && !editing && !card.convertedUserId && canEditMediators && COMPLIANCE_STAGES.has(card.stage as string) && (
              <>
                <Separator className="my-4" />
                <ApplicantCompliancePanel applicantId={card.id} />
              </>
            )}

            {card.kind === "applicant" && !editing && !card.convertedUserId && canEditMediators && CONTRACT_STAGES.has(card.stage as string) && (
              <>
                <Separator className="my-4" />
                <ApplicantContractPanel applicantId={card.id} />
              </>
            )}

            <SheetFooter className="mt-6 flex-row gap-2 sm:justify-end flex-wrap">
              {card.kind === "applicant" && !editing && (
                <>
                  {/* Task #243 — View full application at early application stages */}
                  {canEditMediators && RESEND_FORM_STAGES.has(card.stage as string) && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setAppDialogOpen(true)}
                      data-testid="button-view-application"
                    >
                      <FileText className="w-4 h-4 mr-1" />View Application
                    </Button>
                  )}

                  {/* Task #249 — Accept for interview (Applications stage only) */}
                  {canEditMediators && !card.convertedUserId && card.stage === "recruitment_approach" && (
                    <Button
                      size="sm"
                      onClick={() => setAcceptDialogOpen(true)}
                      className="bg-[#5a7d58] hover:bg-[#4a6d48] text-white"
                      data-testid="button-accept-for-interview"
                    >
                      <UserCheck className="w-4 h-4 mr-1" />Accept for interview
                    </Button>
                  )}

                  {/* Task #249 — Reject applicant (Applications + Interview stages) */}
                  {canEditMediators && !card.convertedUserId && RESEND_FORM_STAGES.has(card.stage as string) && (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => setRejectDialogOpen(true)}
                      data-testid="button-reject-applicant"
                    >
                      <XCircle className="w-4 h-4 mr-1" />Reject
                    </Button>
                  )}

                  {/* Task #244 — Resend pre-filled form to applicant at early stages */}
                  {canEditMediators && !card.convertedUserId && RESEND_FORM_STAGES.has(card.stage as string) && (
                    <AlertDialog open={resendOpen} onOpenChange={setResendOpen}>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={resendMutation.isPending}
                          data-testid="button-drawer-resend-form"
                        >
                          <Send className="w-4 h-4 mr-1" />
                          {resendMutation.isPending ? "Sending…" : "Resend form"}
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Resend application form?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will email <strong>{card.firstName} {card.lastName}</strong> a personalised link
                            to review and update their application details. The link is one-time use and expires in 7 days.
                            Any previously sent unused link will be replaced.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel data-testid="button-resend-cancel">Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => { resendMutation.mutate(card.id); setResendOpen(false); }}
                            data-testid="button-resend-confirm"
                          >
                            Send email
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}

                  <Button variant="outline" size="sm" onClick={() => setEditing(true)} data-testid="button-drawer-edit">
                    <Pencil className="w-4 h-4 mr-1" />Edit
                  </Button>
                  {card.stage !== "onboarding_portal_access" && !card.convertedUserId && (
                    <Button size="sm" onClick={() => onConvert(card)} data-testid="button-drawer-convert">
                      <ArrowRightCircle className="w-4 h-4 mr-1" />Convert to mediator
                    </Button>
                  )}
                </>
              )}
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>

    {card && appDialogOpen && (
      <ApplicantApplicationDialog
        applicantId={card.id}
        applicantName={`${card.firstName} ${card.lastName}`}
        open={appDialogOpen}
        onClose={() => setAppDialogOpen(false)}
      />
    )}

    {card && acceptDialogOpen && (
      <AcceptInterviewDialog
        applicantId={card.id}
        applicantName={`${card.firstName} ${card.lastName}`}
        applicantFirstName={card.firstName}
        open={acceptDialogOpen}
        onClose={() => setAcceptDialogOpen(false)}
        onSuccess={() => { setAcceptDialogOpen(false); onClose(); }}
      />
    )}

    {card && rejectDialogOpen && (
      <RejectApplicantDialog
        applicantId={card.id}
        applicantName={`${card.firstName} ${card.lastName}`}
        applicantFirstName={card.firstName}
        open={rejectDialogOpen}
        onClose={() => setRejectDialogOpen(false)}
        onSuccess={() => { setRejectDialogOpen(false); onClose(); }}
      />
    )}
    </>
  );
}
