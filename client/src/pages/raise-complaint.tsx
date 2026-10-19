import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ComplaintForm } from "@/components/complaints/complaint-form";
import { useSearch } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";

export default function RaiseComplaintPage() {
  const search = useSearch();
  const { user } = useAuth();
  const caseId = new URLSearchParams(search).get("caseId") || undefined;
  const staffLookup = user?.role === "staff" || !caseId;
  const { data: mine = [] } = useQuery<Array<{ id: string; complaintRef: string; caseRef: string; status: string; receivedAt: string; responseDueAt: string }>>({ queryKey: ["/api/complaints/mine"], queryFn: async () => { const response = await fetch("/api/complaints/mine", { credentials: "include" }); if (!response.ok) throw new Error("Unable to load complaint status"); return response.json(); } });
  return <div className="mx-auto max-w-3xl space-y-5 p-4 md:p-8"><div><h1 className="text-2xl font-semibold">Raise a confidential complaint</h1><p className="text-sm text-muted-foreground">{staffLookup ? "Enter the exact case reference. No case or client details will be shown." : "This complaint will be linked securely to the selected case."}</p></div><Card><CardHeader><CardTitle>Complaint details</CardTitle></CardHeader><CardContent><ComplaintForm caseId={staffLookup ? undefined : caseId} requireCaseRef={staffLookup} /></CardContent></Card>{mine.length > 0 && <Card><CardHeader><CardTitle>My complaint status</CardTitle></CardHeader><CardContent className="space-y-2">{mine.map((item) => <Link key={item.id} href={`/complaints/${item.id}`} className="block rounded-md border p-3 hover:bg-muted/50"><div className="flex justify-between gap-3"><span className="font-medium">{item.complaintRef}</span><Badge variant="outline">{item.status.replaceAll("_", " ")}</Badge></div><p className="mt-1 text-xs text-muted-foreground">Case {item.caseRef} · received {new Date(item.receivedAt).toLocaleDateString("en-GB")}</p></Link>)}</CardContent></Card>}</div>;
}
