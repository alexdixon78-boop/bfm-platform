import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { UserPlus, Search, Plus, Loader2, Link2 } from "lucide-react";
import type { Party } from "@shared/schema";

interface ClientSearchResult {
  id: string;
  name: string;
  email: string;
}

interface AddPartyResponse {
  party: Party;
  role: string;
}

interface AddPartyCardProps {
  caseId: string;
  nextRoleLetter: string;
  onPartyAdded?: (party: { id: string; role: string }) => void;
}

export function AddPartyCard({ caseId, nextRoleLetter, onPartyAdded }: AddPartyCardProps) {
  const { toast } = useToast();
  const [searchEmail, setSearchEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [searchResults, setSearchResults] = useState<ClientSearchResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [mode, setMode] = useState<"search" | "create">("search");

  const partyLabel = nextRoleLetter === "B" ? "Client B" : `Party ${nextRoleLetter}`;

  const invalidate = (newParty?: { id: string; role: string }) => {
    queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId] });
    queryClient.invalidateQueries({ queryKey: ["/api/demographic-data/case", caseId] });
    queryClient.invalidateQueries({ queryKey: ["/api/miam-records/case", caseId] });
    if (newParty) onPartyAdded?.(newParty);
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

  const createMutation = useMutation({
    mutationFn: async (data: { firstName: string; lastName: string; email: string }) => {
      const res = await apiRequest("POST", `/api/cases/${caseId}/parties`, data);
      return res.json() as Promise<AddPartyResponse>;
    },
    onSuccess: (result) => {
      invalidate({ id: result.party.id, role: result.role });
      const lbl = result.role === "B" ? "Client B" : `Party ${result.role}`;
      toast({ title: `${lbl} added`, description: `${lbl} has been added to this case.` });
    },
    onError: (err: Error) => {
      toast({ title: `Failed to add ${partyLabel}`, description: err.message || "An error occurred", variant: "destructive" });
    },
  });

  const linkMutation = useMutation({
    mutationFn: async (userId: string) => {
      const res = await apiRequest("POST", `/api/cases/${caseId}/parties`, { userId });
      return res.json() as Promise<AddPartyResponse>;
    },
    onSuccess: (result) => {
      invalidate({ id: result.party.id, role: result.role });
      const lbl = result.role === "B" ? "Client B" : `Party ${result.role}`;
      toast({ title: `${lbl} linked`, description: `Existing client linked as ${lbl}.` });
    },
    onError: (err: Error) => {
      toast({ title: `Failed to link ${partyLabel}`, description: err.message || "An error occurred", variant: "destructive" });
    },
  });

  const handleSearch = () => {
    if (searchEmail.trim().length < 3) return;
    searchMutation.mutate(searchEmail.trim());
  };

  const handleCreate = () => {
    if (!firstName.trim() || !lastName.trim() || !email.trim()) {
      toast({ title: "All fields are required", variant: "destructive" });
      return;
    }
    createMutation.mutate({ firstName: firstName.trim(), lastName: lastName.trim(), email: email.trim() });
  };

  const switchToCreate = () => {
    setMode("create");
    setEmail(searchEmail);
  };

  const isPending = createMutation.isPending || linkMutation.isPending;
  const headingLabel = nextRoleLetter === "B" ? "Add Client B" : "Add another party";

  return (
    <Card data-testid={`card-add-party-${nextRoleLetter.toLowerCase()}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <UserPlus className="w-5 h-5 text-muted-foreground" />
          <CardTitle className="text-base font-heading">{headingLabel}</CardTitle>
          <Badge variant="outline" className="font-mono text-[10px] ml-1">Party {nextRoleLetter}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        {mode === "search" ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Search for an existing client by email address, or create a new client to add as Party {nextRoleLetter}.
            </p>
            <div className="flex gap-2">
              <Input
                data-testid="input-search-client-email"
                placeholder="Enter email address..."
                value={searchEmail}
                onChange={(e) => setSearchEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                className="flex-1"
              />
              <Button
                data-testid="button-search-client"
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
                  <div key={r.id} className="flex items-center justify-between p-3 rounded-md border bg-muted/30" data-testid={`search-result-${i}`}>
                    <div>
                      <p className="text-sm font-medium">{r.name}</p>
                      <p className="text-xs text-muted-foreground">{r.email}</p>
                    </div>
                    <Button
                      data-testid={`button-link-client-${i}`}
                      size="sm"
                      onClick={() => linkMutation.mutate(r.id)}
                      disabled={isPending}
                    >
                      {linkMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Link2 className="w-3 h-3 mr-1" />}
                      Link as Party {nextRoleLetter}
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
                data-testid="button-switch-to-create"
                variant="outline"
                size="sm"
                onClick={switchToCreate}
              >
                <Plus className="w-3 h-3 mr-1" /> Create new client
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Enter the details for the new Party {nextRoleLetter}.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label htmlFor={`party-${nextRoleLetter.toLowerCase()}-firstname`} className="text-xs">First name *</Label>
                <Input
                  id={`party-${nextRoleLetter.toLowerCase()}-firstname`}
                  data-testid="input-party-firstname"
                  placeholder="First name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor={`party-${nextRoleLetter.toLowerCase()}-lastname`} className="text-xs">Last name *</Label>
                <Input
                  id={`party-${nextRoleLetter.toLowerCase()}-lastname`}
                  data-testid="input-party-lastname"
                  placeholder="Last name"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                />
              </div>
            </div>
            <div>
              <Label htmlFor={`party-${nextRoleLetter.toLowerCase()}-email`} className="text-xs">Email address *</Label>
              <Input
                id={`party-${nextRoleLetter.toLowerCase()}-email`}
                data-testid="input-party-email"
                type="email"
                placeholder="email@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button
                data-testid="button-back-to-search"
                variant="ghost"
                size="sm"
                onClick={() => setMode("search")}
                disabled={isPending}
              >
                Back to search
              </Button>
              <Button
                data-testid="button-create-party"
                size="sm"
                onClick={handleCreate}
                disabled={isPending || !firstName.trim() || !lastName.trim() || !email.trim()}
              >
                {createMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <UserPlus className="w-3 h-3 mr-1" />}
                Create Party {nextRoleLetter}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
