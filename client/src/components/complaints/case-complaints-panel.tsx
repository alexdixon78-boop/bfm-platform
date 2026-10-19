import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ComplaintForm } from "./complaint-form";

type ComplaintStatus = { id: string; complaintRef: string; status: string; receivedAt: string; responseDueAt: string; caseRef?: string };
const formatDate = (value: string) => new Date(value).toLocaleDateString("en-GB", { dateStyle: "medium" });

export function CaseComplaintsPanel({ caseId }: { caseId: string }) {
  const { user } = useAuth();
  const [showForm, setShowForm] = useState(false);
  const isSuperadmin = user?.role === "superadmin";
  const endpoint = isSuperadmin ? `/api/cases/${caseId}/complaints` : `/api/complaints/mine?caseId=${encodeURIComponent(caseId)}`;
  const { data = [], isLoading } = useQuery<ComplaintStatus[]>({ queryKey: isSuperadmin ? ["/api/cases", caseId, "complaints"] : ["/api/complaints/mine", caseId], queryFn: async () => { const response = await fetch(endpoint, { credentials: "include" }); if (!response.ok) throw new Error("Unable to load complaints"); return response.json(); } });
  return <div className="space-y-4">
    <div className="flex items-start justify-between gap-4"><div><h2 className="text-xl font-semibold">Complaints</h2><p className="text-sm text-muted-foreground">Confidential complaint records are separate from case notes and activities.</p></div><Button onClick={() => setShowForm((value) => !value)}>{showForm ? "Cancel" : "Raise complaint"}</Button></div>
    {showForm && <Card><CardHeader><CardTitle className="text-base">New confidential complaint</CardTitle></CardHeader><CardContent><ComplaintForm caseId={caseId} onCreated={() => setShowForm(false)} /></CardContent></Card>}
    <Card><CardHeader><CardTitle className="text-base">{isSuperadmin ? "Case complaint log" : "My complaint status"}</CardTitle></CardHeader><CardContent className="space-y-3">{isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : data.length === 0 ? <p className="text-sm text-muted-foreground">No complaints to show.</p> : data.map((item) => <Link key={item.id} href={`/complaints/${item.id}`} className="block rounded-md border p-3 hover:bg-muted/50"><div className="flex items-center justify-between"><span className="font-medium">{item.complaintRef}</span><Badge variant="outline">{item.status.replaceAll("_", " ")}</Badge></div><p className="mt-1 text-xs text-muted-foreground">Received {formatDate(item.receivedAt)} · Response target {formatDate(item.responseDueAt)}</p></Link>)}</CardContent></Card>
  </div>;
}
