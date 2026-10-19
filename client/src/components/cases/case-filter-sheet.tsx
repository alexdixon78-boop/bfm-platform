import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  type CaseFilters,
  MEDIATION_CATEGORIES,
  FAMILY_CASE_SUBTYPES,
  WORKPLACE_CASE_SUBTYPES,
  CIVIL_CASE_SUBTYPES,
  COMMERCIAL_CASE_SUBTYPES,
  OTHER_CASE_SUBTYPES,
  FUNDING_SOURCES,
  CASE_STAGES,
  CASE_STATUSES,
  VOUCHER_SCHEME_OPTIONS,
  COURT_PROCEEDINGS_STATUSES,
  CAFCASS_OPTIONS,
} from "@shared/schema";

// All filter vocabularies are sourced from shared/schema.ts so the SQL
// equality predicates written by refreshCaseFilterCache always match what the
// UI offers — preventing string-drift false-zero results.
const FAMILY_SUB_TYPES = [...FAMILY_CASE_SUBTYPES];
const WORKPLACE_SUB_TYPES = [...WORKPLACE_CASE_SUBTYPES];
const VOUCHER_STATUSES = [...VOUCHER_SCHEME_OPTIONS];
const COURT_STATUSES = [...COURT_PROCEEDINGS_STATUSES];
const CAFCASS_STATUSES = [...CAFCASS_OPTIONS];

interface MediatorOption { id: string; name: string }

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: CaseFilters;
  onApply: (next: CaseFilters) => void;
  isAdmin: boolean;
}

function CheckboxGroup({
  options, selected, onChange, testIdPrefix,
}: {
  options: readonly string[];
  selected: string[] | undefined;
  onChange: (next: string[] | undefined) => void;
  testIdPrefix: string;
}) {
  const set = new Set(selected ?? []);
  return (
    <div className="grid grid-cols-1 gap-1.5">
      {options.map(opt => {
        const checked = set.has(opt);
        return (
          <label key={opt} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/50 px-2 py-1 rounded">
            <Checkbox
              checked={checked}
              onCheckedChange={(v) => {
                const next = new Set(set);
                if (v) next.add(opt); else next.delete(opt);
                const arr = Array.from(next);
                onChange(arr.length ? arr : undefined);
              }}
              data-testid={`${testIdPrefix}-${opt.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
            />
            <span>{opt}</span>
          </label>
        );
      })}
    </div>
  );
}

export function CaseFilterSheet({ open, onOpenChange, value, onApply, isAdmin }: Props) {
  const [draft, setDraft] = useState<CaseFilters>(value);
  useEffect(() => { if (open) setDraft(value); }, [open, value]);

  const { data: mediators } = useQuery<MediatorOption[]>({
    queryKey: ["/api/users", { role: "mediator" }],
    queryFn: async () => {
      const res = await fetch("/api/users?role=mediator", { credentials: "include" });
      if (!res.ok) return [];
      const list = await res.json();
      return list.map((u: { id: string; name: string }) => ({ id: u.id, name: u.name }));
    },
    enabled: open && isAdmin,
  });

  const set = <K extends keyof CaseFilters>(k: K, v: CaseFilters[K]) =>
    setDraft(prev => ({ ...prev, [k]: v }));

  const apply = () => { onApply(draft); onOpenChange(false); };
  const clear = () => { setDraft({}); };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl flex flex-col" data-testid="sheet-case-filters">
        <SheetHeader>
          <SheetTitle>Filter cases</SheetTitle>
          <SheetDescription>All filters AND together. Empty = all values allowed.</SheetDescription>
        </SheetHeader>

        <ScrollArea className="flex-1 -mx-6 px-6">
          <div className="space-y-5 py-4 pr-2">
            <section>
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Search</Label>
              <Input
                value={draft.search ?? ""}
                onChange={(e) => set("search", e.target.value || undefined)}
                placeholder="Case ref, party name, mediator, issue, stage..."
                data-testid="input-filter-search"
              />
            </section>

            <Separator />

            <section>
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Status</Label>
              <CheckboxGroup options={CASE_STATUSES} selected={draft.statuses} onChange={(v) => set("statuses", v)} testIdPrefix="filter-status" />
            </section>

            <section>
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">CIM eligibility</Label>
              <label className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/50 px-2 py-1 rounded">
                <Checkbox
                  checked={draft.cimEligible === true}
                  onCheckedChange={(v) => set("cimEligible", v ? true : undefined)}
                  data-testid="filter-cim-eligible"
                />
                <span>CIM eligible cases only</span>
              </label>
            </section>

            <Separator />

            <section>
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Stage</Label>
              <div className="max-h-48 overflow-y-auto border rounded-md p-2">
                <CheckboxGroup options={CASE_STAGES} selected={draft.stages} onChange={(v) => set("stages", v)} testIdPrefix="filter-stage" />
              </div>
            </section>

            <Separator />

            <section>
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Mediation category</Label>
              <CheckboxGroup
                options={MEDIATION_CATEGORIES}
                selected={draft.mediationCategories}
                onChange={(v) => {
                  // When a category is removed, also clear its sub-type filter so
                  // we don't keep filtering by stale sub-types the user can't see.
                  setDraft((prev) => {
                    const next = { ...prev, mediationCategories: v as CaseFilters["mediationCategories"] };
                    const sel = new Set(v ?? []);
                    if (!sel.has("Family")) delete next.familySubTypes;
                    if (!sel.has("Workplace")) delete next.workplaceSubTypes;
                    if (!sel.has("Civil")) delete next.civilSubTypes;
                    if (!sel.has("Commercial")) delete next.commercialSubTypes;
                    if (!sel.has("Other")) delete next.otherSubTypes;
                    return next;
                  });
                }}
                testIdPrefix="filter-category"
              />
            </section>

            {(draft.mediationCategories?.includes("Family")) && (
              <section data-testid="section-family-sub">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">Family sub-type</Label>
                <CheckboxGroup options={FAMILY_SUB_TYPES} selected={draft.familySubTypes} onChange={(v) => set("familySubTypes", v)} testIdPrefix="filter-family" />
              </section>
            )}

            {(draft.mediationCategories?.includes("Workplace")) && (
              <section data-testid="section-workplace-sub">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">Workplace sub-type</Label>
                <CheckboxGroup options={WORKPLACE_SUB_TYPES} selected={draft.workplaceSubTypes} onChange={(v) => set("workplaceSubTypes", v)} testIdPrefix="filter-workplace" />
              </section>
            )}

            {(draft.mediationCategories?.includes("Civil")) && (
              <section data-testid="section-civil-sub">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">Civil sub-type</Label>
                <CheckboxGroup options={CIVIL_CASE_SUBTYPES} selected={draft.civilSubTypes} onChange={(v) => set("civilSubTypes", v)} testIdPrefix="filter-civil" />
              </section>
            )}

            {(draft.mediationCategories?.includes("Commercial")) && (
              <section data-testid="section-commercial-sub">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">Commercial sub-type</Label>
                <CheckboxGroup options={COMMERCIAL_CASE_SUBTYPES} selected={draft.commercialSubTypes} onChange={(v) => set("commercialSubTypes", v)} testIdPrefix="filter-commercial" />
              </section>
            )}

            {(draft.mediationCategories?.includes("Other")) && (
              <section data-testid="section-other-sub">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">Other sub-type</Label>
                <CheckboxGroup options={OTHER_CASE_SUBTYPES} selected={draft.otherSubTypes} onChange={(v) => set("otherSubTypes", v)} testIdPrefix="filter-other" />
              </section>
            )}

            <Separator />

            {isAdmin && mediators && mediators.length > 0 && (
              <>
                <MediatorPicker
                  label="Assigned mediator"
                  mediators={mediators}
                  selectedIds={draft.assignedMediatorIds}
                  onChange={(ids) => set("assignedMediatorIds", ids)}
                  testIdPrefix="filter-assigned-mediator"
                />
                <MediatorPicker
                  label="MIAM mediator"
                  mediators={mediators}
                  selectedIds={draft.miamMediatorIds}
                  onChange={(ids) => set("miamMediatorIds", ids)}
                  testIdPrefix="filter-miam-mediator"
                />
                <Separator />
              </>
            )}

            <section>
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Funding source</Label>
              <CheckboxGroup options={FUNDING_SOURCES} selected={draft.fundingSources} onChange={(v) => set("fundingSources", v)} testIdPrefix="filter-funding" />
            </section>

            <section>
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">MOJ Voucher status</Label>
              <CheckboxGroup options={VOUCHER_STATUSES} selected={draft.voucherStatuses} onChange={(v) => set("voucherStatuses", v)} testIdPrefix="filter-voucher" />
            </section>

            <section>
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">In court / proceedings</Label>
              <CheckboxGroup options={COURT_STATUSES} selected={draft.inCourtStatuses} onChange={(v) => set("inCourtStatuses", v)} testIdPrefix="filter-court" />
            </section>

            <section>
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">CAFCASS involved</Label>
              <CheckboxGroup options={CAFCASS_STATUSES} selected={draft.cafcassStatuses} onChange={(v) => set("cafcassStatuses", v)} testIdPrefix="filter-cafcass" />
            </section>

            <Separator />

            <section className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">Enquiry from</Label>
                <Input type="date" value={draft.enquiryDateFrom ?? ""} onChange={(e) => set("enquiryDateFrom", e.target.value || undefined)} data-testid="input-filter-enquiry-from" />
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">Enquiry to</Label>
                <Input type="date" value={draft.enquiryDateTo ?? ""} onChange={(e) => set("enquiryDateTo", e.target.value || undefined)} data-testid="input-filter-enquiry-to" />
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">MIAM completed from</Label>
                <Input type="date" value={draft.miamCompletedDateFrom ?? ""} onChange={(e) => set("miamCompletedDateFrom", e.target.value || undefined)} data-testid="input-filter-miam-from" />
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">MIAM completed to</Label>
                <Input type="date" value={draft.miamCompletedDateTo ?? ""} onChange={(e) => set("miamCompletedDateTo", e.target.value || undefined)} data-testid="input-filter-miam-to" />
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">Closure from</Label>
                <Input type="date" value={draft.closureDateFrom ?? ""} onChange={(e) => set("closureDateFrom", e.target.value || undefined)} data-testid="input-filter-closure-from" />
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">Closure to</Label>
                <Input type="date" value={draft.closureDateTo ?? ""} onChange={(e) => set("closureDateTo", e.target.value || undefined)} data-testid="input-filter-closure-to" />
              </div>
            </section>
          </div>
        </ScrollArea>

        <SheetFooter className="border-t pt-4 flex-row justify-between sm:justify-between gap-2">
          <Button variant="ghost" onClick={clear} data-testid="button-filter-clear-draft">Clear all</Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-filter-cancel">Cancel</Button>
            <Button onClick={apply} data-testid="button-filter-apply">Apply</Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function MediatorPicker({
  label, mediators, selectedIds, onChange, testIdPrefix,
}: {
  label: string;
  mediators: MediatorOption[];
  selectedIds: string[] | undefined;
  onChange: (ids: string[] | undefined) => void;
  testIdPrefix: string;
}) {
  const [q, setQ] = useState("");
  const set = new Set(selectedIds ?? []);
  const filtered = mediators.filter((m) => m.name.toLowerCase().includes(q.toLowerCase().trim()));
  return (
    <section>
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">{label}</Label>
      <Input
        value={q} onChange={(e) => setQ(e.target.value)}
        placeholder="Search mediators…"
        className="mb-2"
        data-testid={`${testIdPrefix}-search`}
      />
      <div className="max-h-48 overflow-y-auto border rounded-md p-2">
        {filtered.length === 0 ? (
          <p className="text-xs text-muted-foreground px-2 py-1">No matches</p>
        ) : filtered.map((m) => {
          const checked = set.has(m.id);
          return (
            <label key={m.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/50 px-2 py-1 rounded">
              <Checkbox
                checked={checked}
                onCheckedChange={(v) => {
                  const next = new Set(set);
                  if (v) next.add(m.id); else next.delete(m.id);
                  const arr = Array.from(next);
                  onChange(arr.length ? arr : undefined);
                }}
                data-testid={`${testIdPrefix}-${m.id}`}
              />
              <span>{m.name}</span>
            </label>
          );
        })}
      </div>
    </section>
  );
}

export function countActiveFilters(f: CaseFilters): number {
  let n = 0;
  for (const v of Object.values(f)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) { if (v.length) n += 1; continue; }
    if (typeof v === "string" && v.trim().length === 0) continue;
    n += 1;
  }
  return n;
}
