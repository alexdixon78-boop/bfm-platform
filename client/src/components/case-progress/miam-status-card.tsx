import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2 } from "lucide-react";
import { MIAM_MILESTONES, deriveMiamCellState, partyHeading, type PartyLike } from "./derivation";
import { MiamCellPill } from "./cell-pills";

export function MiamStatusCard({ parties, stageIdx }: { parties: PartyLike[]; stageIdx: number }) {
  const sorted = parties.slice().sort((a, b) => (a.role || "").localeCompare(b.role || ""));
  if (sorted.length === 0) return null;
  return (
    <Card data-testid="card-miam-status">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-heading flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-[#5a7d58]" />
          MIAM Status
        </CardTitle>
        <p className="text-xs text-muted-foreground">Per-party MIAM progress. Status reflects the case stage for Client A and Client B.</p>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-separate border-spacing-0 min-w-max" data-testid="table-miam-status">
            <thead>
              <tr>
                <th className="text-left text-[11px] uppercase tracking-wider text-muted-foreground font-semibold pb-2 pr-4 border-b">Milestone</th>
                {sorted.map((p) => (
                  <th
                    key={p.id}
                    className="text-left text-[11px] uppercase tracking-wider text-muted-foreground font-semibold pb-2 px-3 border-b min-w-[140px]"
                    data-testid={`th-miam-party-${p.id}`}
                  >
                    {partyHeading(p)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MIAM_MILESTONES.map((m) => (
                <tr key={m} data-testid={`row-miam-${m.toLowerCase()}`}>
                  <td className="py-2 pr-4 text-sm font-medium text-foreground border-b border-muted/40">{m}</td>
                  {sorted.map((p) => (
                    <td key={p.id} className="py-2 px-3 border-b border-muted/40">
                      <MiamCellPill
                        state={deriveMiamCellState(m, p.role, stageIdx)}
                        partyId={p.id}
                        milestone={m}
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
