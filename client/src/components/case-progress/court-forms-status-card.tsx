import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { COURT_FORMS, deriveCourtFormState, partyHeading, type PartyLike } from "./derivation";
import { CourtFormCellPill } from "./cell-pills";

type Template = { id: string; formType: string; isCurrent: boolean };
type Generation = { id: string; partyId: string; templateId: string; status: string; deliveryStatus: string };
type CourtFormsPayload = { templates: Template[]; generations: Generation[] };

function generationState(generation: Generation | undefined, fallback: ReturnType<typeof deriveCourtFormState>) {
  if (!generation) return fallback;
  if (generation.status === "sent" || generation.deliveryStatus === "sent") return "Sent";
  if (generation.status === "saved" || generation.status === "generated") return "Signed";
  return fallback;
}

export function CourtFormsStatusCard({ caseId, parties, stageIdx }: { caseId?: string; parties: PartyLike[]; stageIdx: number }) {
  const sorted = parties.slice().sort((a, b) => (a.role || "").localeCompare(b.role || ""));
  const { data } = useQuery<CourtFormsPayload>({
    queryKey: ["/api/cases", caseId, "court-forms", "overview"],
    queryFn: async () => {
      const res = await fetch(`/api/cases/${caseId}/court-forms`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load court form generation status");
      return res.json();
    },
    enabled: Boolean(caseId),
  });
  if (sorted.length === 0) return null;
  const templates = data?.templates ?? [];
  const generations = data?.generations ?? [];
  return (
    <Card data-testid="card-court-forms-status">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-heading flex items-center gap-2">
          <FileText className="w-4 h-4 text-[#5a7d58]" />
          Court Forms
        </CardTitle>
        <p className="text-xs text-muted-foreground">Per-party court form status. Send and track from the Documents tab.</p>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-separate border-spacing-0 min-w-max" data-testid="table-court-forms-status">
            <thead>
              <tr>
                <th className="text-left text-[11px] uppercase tracking-wider text-muted-foreground font-semibold pb-2 pr-4 border-b">Form</th>
                {sorted.map((p) => (
                  <th
                    key={p.id}
                    className="text-left text-[11px] uppercase tracking-wider text-muted-foreground font-semibold pb-2 px-3 border-b min-w-[140px]"
                    data-testid={`th-court-forms-party-${p.id}`}
                  >
                    {partyHeading(p)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COURT_FORMS.map((f) => (
                <tr key={f.id} data-testid={`row-court-form-${f.id.toLowerCase()}`}>
                  <td className="py-2 pr-4 text-sm font-medium text-foreground border-b border-muted/40">{f.name}</td>
                  {sorted.map((p) => (
                    <td key={p.id} className="py-2 px-3 border-b border-muted/40">
                      <CourtFormCellPill
                        state={generationState(
                          generations.find((generation) => {
                            const template = templates.find((t) => t.id === generation.templateId);
                            return generation.partyId === p.id && template?.formType === f.id;
                          }),
                          deriveCourtFormState(f.id, p.role, stageIdx),
                        )}
                        partyId={p.id}
                        formId={f.id}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
