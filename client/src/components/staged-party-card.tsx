import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { UserPlus, Search, Plus, Loader2, Link2, Clock, Unlink, Info, Lock } from "lucide-react";

interface ClientSearchResult {
  id: string;
  name: string;
  email: string;
}

export interface StagedParty {
  userId?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
}

interface StagedPartyCardProps {
  recordId: string;
  caseId: string;
  nextRoleLetter: string;
  pendingParty: StagedParty | null;
  canStage?: boolean;
}

export function StagedPartyCard({ recordId, caseId, nextRoleLetter, pendingParty, canStage = true }: StagedPartyCardProps) {
  const { toast } = useToast();
  const [searchEmail, setSearchEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [searchResults, setSearchResults] = useState<ClientSearchResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [mode, setMode] = useState<"search" | "create">("search");

  const hasPending = !!(pendingParty?.firstName || pendingParty?.userId);
  const pendingName = [pendingParty?.firstName, pendingParty?.lastName].filter(Boolean).join(" ");

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/miam-records/case", caseId] });
  };

  const searchMutation = useMutation({
    mutationFn: async (emailQuery: string) => {
      const res = await fetch(`/api/clients/search-by-email?email=${encodeURIComponent(emailQuery)}`, { credentials: "include" });
      if (!res.ok) throw new Error("Search failed");
      return res.json() as Promise<ClientSearchResult[]>;
    },
    onSuccess: (results: ClientSearchResult[]) => {
      setSearchResults(results);
      setSearched(true);
      if (results.length === 0) {
        setMode("create");
        setEmail(searchEmail);
      }
    },
    onError: () => {
      toast({ title: "Search failed", variant: "destructive" });
    },
  });

  const stageLinkMutation = useMutation({
    mutationFn: async (userId: string) => {
      const res = await apiRequest("PATCH", `/api/miam-records/${recordId}/pending-party`, { userId });
      return res.json();
    },
    onSuccess: () => {
      invalidate();
      toast({ title: `Party ${nextRoleLetter} staged`, description: "They will be added when this MIAM record is submitted." });
      setSearchResults([]);
      setSearched(false);
      setSearchEmail("");
    },
    onError: (err: Error) => {
      toast({ title: "Failed to stage party", description: err.message || "An error occurred", variant: "destructive" });
    },
  });

  const stageNewMutation = useMutation({
    mutationFn: async (data: { firstName: string; lastName: string; email?: string }) => {
      const res = await apiRequest("PATCH", `/api/miam-records/${recordId}/pending-party`, data);
      return res.json();
    },
    onSuccess: () => {
      invalidate();
      toast({ title: `Party ${nextRoleLetter} staged`, description: "They will be added when this MIAM record is submitted." });
      setFirstName("");
      setLastName("");
      setEmail("");
      setMode("search");
    },
    onError: (err: Error) => {
      toast({ title: "Failed to stage party", description: err.message || "An error occurred", variant: "destructive" });
    },
  });

  const unlinkMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", `/api/miam-records/${recordId}/pending-party`);
      return res.json();
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "Staged party removed", description: "Section 5 is ready for a different selection." });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to remove staged party", description: err.message || "An error occurred", variant: "destructive" });
    },
  });

  const handleSearch = () => {
    if (searchEmail.trim().length < 3) return;
    searchMutation.mutate(searchEmail.trim());
  };

  const handleStageNew = () => {
    if (!firstName.trim() || !lastName.trim()) {
      toast({ title: "First and last name are required", variant: "destructive" });
      return;
    }
    stageNewMutation.mutate({ firstName: firstName.trim(), lastName: lastName.trim(), email: email.trim() || undefined });
  };

  const switchToCreate = () => {
    setMode("create");
    setEmail(searchEmail);
  };

  const isPending = stageLinkMutation.isPending || stageNewMutation.isPending;

  // When the MIAM record is locked (not editable), show read-only view if a party is staged,
  // or nothing at all if there's no staged party.
  if (!canStage) {
    if (!hasPending) return null;
    return (
      <Card data-testid={`card-staged-party-${nextRoleLetter.toLowerCase()}-readonly`} className="border-amber-200 bg-amber-50/40">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-amber-600" />
            <CardTitle className="text-base font-heading">Party {nextRoleLetter} — staged</CardTitle>
            <Badge variant="outline" className="font-mono text-[10px] ml-1 border-amber-300 text-amber-700">Pending submit</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-start gap-3 p-3 rounded-md border border-amber-200 bg-white">
            <UserPlus className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate" data-testid="text-staged-party-name-readonly">{pendingName}</p>
              {pendingParty?.email && (
                <p className="text-xs text-muted-foreground truncate">{pendingParty.email}</p>
              )}
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-2 italic">
            This MIAM record is locked. The staged party will be added on next valid submission.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (hasPending) {
    return (
      <Card data-testid={`card-staged-party-${nextRoleLetter.toLowerCase()}`} className="border-amber-200 bg-amber-50/40">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-amber-600" />
            <CardTitle className="text-base font-heading">Party {nextRoleLetter} — staged</CardTitle>
            <Badge variant="outline" className="font-mono text-[10px] ml-1 border-amber-300 text-amber-700">Pending submit</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="flex items-start gap-3 p-3 rounded-md border border-amber-200 bg-white">
              <UserPlus className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate" data-testid="text-staged-party-name">{pendingName}</p>
                {pendingParty?.email && (
                  <p className="text-xs text-muted-foreground truncate" data-testid="text-staged-party-email">{pendingParty.email}</p>
                )}
              </div>
              <Button
                data-testid="button-unlink-staged-party"
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive shrink-0"
                onClick={() => unlinkMutation.mutate()}
                disabled={unlinkMutation.isPending}
              >
                {unlinkMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Unlink className="w-3 h-3 mr-1" />}
                Unlink
              </Button>
            </div>
            <div className="flex items-start gap-2 p-2 rounded-md bg-amber-50 border border-amber-100">
              <Info className="w-3.5 h-3.5 text-amber-600 mt-0.5 shrink-0" />
              <p className="text-xs text-amber-700">
                <strong>{pendingName}</strong> will be added as <strong>Party {nextRoleLetter}</strong> when this MIAM record is submitted.
                You can unlink them above if you change your mind.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid={`card-stage-party-${nextRoleLetter.toLowerCase()}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <UserPlus className="w-5 h-5 text-muted-foreground" />
          <CardTitle className="text-base font-heading">Stage another party</CardTitle>
          <Badge variant="outline" className="font-mono text-[10px] ml-1">Party {nextRoleLetter}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2 mb-4 flex items-start gap-2 p-2 rounded-md bg-muted/40 border">
          <Info className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
          <p className="text-xs text-muted-foreground">
            Select the person you want to add as <strong>Party {nextRoleLetter}</strong>.
            They will not be added to the case until this MIAM record is <strong>submitted</strong>.
          </p>
        </div>

        {mode === "search" ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Search for an existing client by email address, or enter their details as a new person.
            </p>
            <div className="flex gap-2">
              <Input
                data-testid="input-stage-search-email"
                placeholder="Enter email address..."
                value={searchEmail}
                onChange={(e) => setSearchEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                className="flex-1"
              />
              <Button
                data-testid="button-stage-search"
                variant="outline"
                onClick={handleSearch}
                disabled={searchMutation.isPending || searchEmail.trim().length < 3}
              >
                {searchMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              </Button>
            </div>

            {searched && searchResults.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium">Matching clients:</p>
                {searchResults.map((r, i) => (
                  <div key={r.id} className="flex items-center justify-between p-3 rounded-md border bg-muted/30" data-testid={`stage-search-result-${i}`}>
                    <div>
                      <p className="text-sm font-medium">{r.name}</p>
                      <p className="text-xs text-muted-foreground">{r.email}</p>
                    </div>
                    <Button
                      data-testid={`button-stage-link-${i}`}
                      size="sm"
                      onClick={() => stageLinkMutation.mutate(r.id)}
                      disabled={isPending}
                    >
                      {stageLinkMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Link2 className="w-3 h-3 mr-1" />}
                      Stage as Party {nextRoleLetter}
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {searched && searchResults.length === 0 && (
              <div className="p-3 rounded-md border border-dashed text-center">
                <p className="text-sm text-muted-foreground">No existing clients found for this email.</p>
              </div>
            )}

            <div className="flex justify-end">
              <Button
                data-testid="button-stage-switch-to-create"
                variant="outline"
                size="sm"
                onClick={switchToCreate}
              >
                <Plus className="w-3 h-3 mr-1" /> Enter details manually
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Enter the person's details. They will be created as Party {nextRoleLetter} on submission.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label htmlFor={`stage-party-${nextRoleLetter.toLowerCase()}-firstname`} className="text-xs">First name *</Label>
                <Input
                  id={`stage-party-${nextRoleLetter.toLowerCase()}-firstname`}
                  data-testid="input-stage-firstname"
                  placeholder="First name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor={`stage-party-${nextRoleLetter.toLowerCase()}-lastname`} className="text-xs">Last name *</Label>
                <Input
                  id={`stage-party-${nextRoleLetter.toLowerCase()}-lastname`}
                  data-testid="input-stage-lastname"
                  placeholder="Last name"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                />
              </div>
            </div>
            <div>
              <Label htmlFor={`stage-party-${nextRoleLetter.toLowerCase()}-email`} className="text-xs">Email address (optional)</Label>
              <Input
                id={`stage-party-${nextRoleLetter.toLowerCase()}-email`}
                data-testid="input-stage-email"
                type="email"
                placeholder="email@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button
                data-testid="button-stage-back-to-search"
                variant="ghost"
                size="sm"
                onClick={() => setMode("search")}
                disabled={isPending}
              >
                Back to search
              </Button>
              <Button
                data-testid="button-stage-party"
                size="sm"
                onClick={handleStageNew}
                disabled={isPending || !firstName.trim() || !lastName.trim()}
              >
                {stageNewMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Clock className="w-3 h-3 mr-1" />}
                Stage as Party {nextRoleLetter}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
