import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Bookmark, BookmarkPlus, Trash2, Star, Pencil } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { caseFiltersSchema, type CaseFilters, type CaseFilterPreset } from "@shared/schema";

interface Props {
  currentFilters: CaseFilters;
  onLoad: (filters: CaseFilters) => void;
}

export function CaseSavedViews({ currentFilters, onLoad }: Props) {
  const { toast } = useToast();
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [renameTarget, setRenameTarget] = useState<CaseFilterPreset | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const { data: presets = [] } = useQuery<CaseFilterPreset[]>({
    queryKey: ["/api/case-filter-presets"],
  });

  // Fail-closed load: validate the stored JSON before applying it. The server
  // also sanitises invalid blobs to {} and tags them with `_filtersInvalid`
  // so we can still surface the warning even after the safe-default coercion.
  const safeLoad = (preset: CaseFilterPreset) => {
    const tagged = preset as CaseFilterPreset & { _filtersInvalid?: boolean };
    if (tagged._filtersInvalid) {
      toast({
        title: "Saved view is out of date",
        description: `"${preset.name}" was saved with an older filter format. Loaded an empty filter set instead — please re-save.`,
        variant: "destructive",
      });
      onLoad({});
      return;
    }
    const parsed = caseFiltersSchema.safeParse(preset.filters ?? {});
    if (!parsed.success) {
      toast({
        title: "Saved view is invalid",
        description: `"${preset.name}" failed validation. Loaded an empty filter set instead.`,
        variant: "destructive",
      });
      onLoad({});
      return;
    }
    onLoad(parsed.data);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      // Fail-closed: validate the filter blob client-side before POSTing so a
      // bad shape never reaches the server (which also validates).
      const parsed = caseFiltersSchema.safeParse(currentFilters);
      if (!parsed.success) {
        throw new Error("Current filters are invalid — please reset and try again.");
      }
      const res = await apiRequest("POST", "/api/case-filter-presets", {
        name: name.trim(), filters: parsed.data, isDefault,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/case-filter-presets"] });
      toast({ title: "View saved", description: `"${name}" is now in your saved views.` });
      setSaveOpen(false); setName(""); setIsDefault(false);
    },
    onError: (err: Error) => {
      toast({ title: "Could not save view", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/case-filter-presets/${id}`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/case-filter-presets"] });
      toast({ title: "View deleted" });
    },
  });

  const setDefaultMutation = useMutation({
    mutationFn: async (preset: CaseFilterPreset) => {
      await apiRequest("PATCH", `/api/case-filter-presets/${preset.id}`, { isDefault: true });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/case-filter-presets"] });
    },
  });

  const renameMutation = useMutation({
    mutationFn: async (args: { id: string; name: string }) => {
      await apiRequest("PATCH", `/api/case-filter-presets/${args.id}`, { name: args.name });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/case-filter-presets"] });
      toast({ title: "View renamed" });
      setRenameTarget(null); setRenameValue("");
    },
    onError: (err: Error) => {
      toast({ title: "Could not rename", description: err.message, variant: "destructive" });
    },
  });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" data-testid="button-saved-views">
            <Bookmark className="w-4 h-4 mr-1.5" />
            Saved views
            {presets.length > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center text-xs rounded-full bg-muted px-1.5 py-0.5">
                {presets.length}
              </span>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuLabel>Your saved views</DropdownMenuLabel>
          {presets.length === 0 ? (
            <div className="px-2 py-3 text-xs text-muted-foreground">No saved views yet.</div>
          ) : (
            presets.map((p) => (
              <DropdownMenuItem
                key={p.id}
                onSelect={(e) => { e.preventDefault(); safeLoad(p); }}
                className="flex items-center justify-between gap-2"
                data-testid={`menu-load-preset-${p.id}`}
              >
                <span className="flex items-center gap-1.5 truncate">
                  {p.isDefault && <Star className="w-3 h-3 fill-amber-400 text-amber-400 shrink-0" />}
                  <span className="truncate">{p.name}</span>
                </span>
                <span className="flex items-center gap-1 shrink-0">
                  {!p.isDefault && (
                    <Button
                      variant="ghost" size="icon" className="h-6 w-6"
                      onClick={(e) => { e.stopPropagation(); setDefaultMutation.mutate(p); }}
                      data-testid={`button-set-default-preset-${p.id}`}
                      title="Set as default"
                    >
                      <Star className="w-3 h-3" />
                    </Button>
                  )}
                  <Button
                    variant="ghost" size="icon" className="h-6 w-6"
                    onClick={(e) => { e.stopPropagation(); setRenameTarget(p); setRenameValue(p.name); }}
                    data-testid={`button-rename-preset-${p.id}`}
                    title="Rename"
                  >
                    <Pencil className="w-3 h-3" />
                  </Button>
                  <Button
                    variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:text-destructive"
                    onClick={(e) => { e.stopPropagation(); deleteMutation.mutate(p.id); }}
                    data-testid={`button-delete-preset-${p.id}`}
                    title="Delete"
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </span>
              </DropdownMenuItem>
            ))
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setSaveOpen(true); }} data-testid="button-open-save-view">
            <BookmarkPlus className="w-4 h-4 mr-1.5" />
            Save current as view…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={!!renameTarget} onOpenChange={(o) => { if (!o) setRenameTarget(null); }}>
        <DialogContent data-testid="dialog-rename-view">
          <DialogHeader><DialogTitle>Rename view</DialogTitle></DialogHeader>
          <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} data-testid="input-rename-preset" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTarget(null)} data-testid="button-cancel-rename">Cancel</Button>
            <Button
              onClick={() => renameTarget && renameMutation.mutate({ id: renameTarget.id, name: renameValue.trim() })}
              disabled={!renameValue.trim() || renameMutation.isPending}
              data-testid="button-confirm-rename"
            >
              {renameMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent data-testid="dialog-save-view">
          <DialogHeader>
            <DialogTitle>Save current filters as a view</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="preset-name">Name</Label>
              <Input
                id="preset-name" value={name} onChange={(e) => setName(e.target.value)}
                placeholder="e.g. My active family cases"
                data-testid="input-preset-name"
              />
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox checked={isDefault} onCheckedChange={(v) => setIsDefault(!!v)} data-testid="checkbox-preset-default" />
              <span>Make this my default view</span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveOpen(false)} data-testid="button-cancel-save-view">Cancel</Button>
            <Button onClick={() => saveMutation.mutate()} disabled={!name.trim() || saveMutation.isPending} data-testid="button-confirm-save-view">
              {saveMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
