import { useQuery } from "@tanstack/react-query";
import { Archive, ChevronDown } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";

type LegacyHistoryEntry = {
  id: string; legacyReference: string; sourceRecordId: string | null; sourceRowNumber: number;
  caseId: string | null; caseRef: string | null;
  sourceRole: string; enquiryDate: string | null; leadSource: string | null; mediationType: string | null;
  customMediationType: string | null; legacyStatus: string | null; closureOutcome: string | null;
  closedAt: string | null; reopenedAt: string | null; mediatorName: string | null;
  mediatorEmail: string | null; mediatorCompany: string | null;
  recordOriginalValues: Record<string, unknown>; recordReviewedValues: Record<string, unknown>;
  originalValues: Record<string, unknown>; reviewedValues: Record<string, unknown>;
  legacyOnlyValues: Record<string, unknown>; correctedAt: string | null;
  importReceipt: { id: string; fileName: string; importedAt: string };
};

function visiblePairs(values: Record<string, unknown>) {
  return Object.entries(values).filter(([, value]) => value != null && value !== "");
}

export function LegacyCrmHistoryPanel({ clientId }: { clientId: string }) {
  const { data = [], isLoading, isError } = useQuery<LegacyHistoryEntry[]>({
    queryKey: ["/api/clients", clientId, "legacy-history"],
    queryFn: async () => (await apiRequest("GET", `/api/clients/${clientId}/legacy-history`)).json(),
    enabled: !!clientId,
    staleTime: 30_000,
  });

  if (isLoading) return <div className="rounded-lg border p-4 text-sm text-muted-foreground">Loading legacy CRM history…</div>;
  if (isError) return <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">Legacy CRM history could not be loaded.</div>;
  if (!data.length) return null;

  return (
    <div className="rounded-lg bg-muted/30 border p-4 space-y-3" data-testid="legacy-history-panel">
      <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold flex items-center gap-2"><Archive className="h-4 w-4" />Legacy CRM history ({data.length})</p>
      <div className="space-y-2">{data.map((entry) => <details key={entry.id} className="group rounded-md border bg-background p-3">
        <summary className="list-none cursor-pointer flex items-start justify-between gap-3">
          <div><div className="flex items-center gap-2"><span className="font-medium text-sm">{entry.legacyReference}</span><Badge variant="outline">{entry.sourceRole === "client_1" ? "Client 1" : "Client 2"}</Badge>{entry.legacyStatus && <Badge variant="secondary">{entry.legacyStatus}</Badge>}{entry.caseRef && <Badge variant="outline">Linked BFM case {entry.caseRef}</Badge>}</div><p className="text-xs text-muted-foreground mt-1">{[entry.enquiryDate, entry.mediationType, entry.leadSource, `Source row ${entry.sourceRowNumber}`].filter(Boolean).join(" · ")}</p></div>
          <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
        </summary>
        <div className="mt-4 border-t pt-4 space-y-4 text-sm">
          <div className="grid md:grid-cols-2 gap-3"><div><p className="text-xs text-muted-foreground">Linked BFM case</p><p>{entry.caseRef || "—"}</p></div><div><p className="text-xs text-muted-foreground">Closure outcome</p><p>{entry.closureOutcome || "—"}</p></div><div><p className="text-xs text-muted-foreground">Closure / reopened dates</p><p>{entry.closedAt || "—"} / {entry.reopenedAt || "—"}</p></div><div><p className="text-xs text-muted-foreground">Assessment date</p><p>{String(entry.legacyOnlyValues.assessmentDate || "—")}</p></div><div><p className="text-xs text-muted-foreground">Old mediator</p><p>{entry.mediatorName || "—"}{entry.mediatorCompany ? ` · ${entry.mediatorCompany}` : ""}{entry.mediatorEmail ? ` · ${entry.mediatorEmail}` : ""}</p></div><div><p className="text-xs text-muted-foreground">Import receipt</p><p>{entry.importReceipt.id} · {entry.importReceipt.fileName} · {new Date(entry.importReceipt.importedAt).toLocaleDateString("en-GB")}</p></div></div>
          <div className="grid lg:grid-cols-2 gap-3"><div className="rounded-md bg-muted/40 p-3"><p className="text-xs font-semibold mb-2">Original source</p>{visiblePairs({ ...entry.recordOriginalValues, ...entry.originalValues }).map(([key, value]) => <div key={key} className="grid grid-cols-2 gap-2 text-xs py-1"><span className="text-muted-foreground">{key}</span><span className="break-words">{String(value)}</span></div>)}</div><div className="rounded-md bg-muted/40 p-3"><p className="text-xs font-semibold mb-2">Reviewed import</p>{visiblePairs({ ...entry.recordReviewedValues, ...entry.reviewedValues }).map(([key, value]) => <div key={key} className="grid grid-cols-2 gap-2 text-xs py-1"><span className="text-muted-foreground">{key}</span><span className="break-words">{String(value)}</span></div>)}</div></div>
        </div>
      </details>)}</div>
    </div>
  );
}
