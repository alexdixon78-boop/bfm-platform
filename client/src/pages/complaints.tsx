import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type QueueItem = { complaint: { id: string; complaintRef: string; status: string; category: string; targetName: string | null; receivedAt: string; acknowledgementDueAt: string; acknowledgedAt: string | null; responseDueAt: string; finalResponseAt: string | null }; caseRef: string };
const statuses = ["received", "acknowledged", "under_review", "awaiting_information", "response_issued", "closed", "withdrawn", "duplicate"];
const formatDate = (value: string) => new Date(value).toLocaleDateString("en-GB", { dateStyle: "medium" });

export default function ComplaintsPage() {
  const [status, setStatus] = useState("all");
  const [category, setCategory] = useState("all");
  const [caseRef, setCaseRef] = useState("");
  const [subject, setSubject] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [overdueAck, setOverdueAck] = useState(false);
  const [overdueResponse, setOverdueResponse] = useState(false);
  const params = new URLSearchParams();
  if (status !== "all") params.set("status", status);
  if (category !== "all") params.set("category", category);
  if (caseRef.trim()) params.set("caseRef", caseRef.trim());
  if (subject.trim()) params.set("subject", subject.trim());
  if (from) params.set("from", from); if (to) params.set("to", to);
  if (overdueAck) params.set("overdueAcknowledgement", "true");
  if (overdueResponse) params.set("overdueResponse", "true");
  const queryString = params.toString();
  const { data = [], isLoading } = useQuery<QueueItem[]>({ queryKey: ["/api/complaints", queryString], queryFn: async () => { const response = await fetch(`/api/complaints?${queryString}`, { credentials: "include" }); if (!response.ok) throw new Error("Unable to load complaint queue"); return response.json(); } });

  return <div className="space-y-6 p-4 md:p-8"><div><h1 className="text-2xl font-semibold">Confidential complaints</h1><p className="text-sm text-muted-foreground">Superadmin-only investigation and follow-up workspace.</p></div>
    <Card><CardHeader><CardTitle className="text-base">Queue filters</CardTitle></CardHeader><CardContent className="grid gap-4 md:grid-cols-4">
      <div><Label>Status</Label><Select value={status} onValueChange={setStatus}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All statuses</SelectItem>{statuses.map((item) => <SelectItem key={item} value={item}>{item.replaceAll("_", " ")}</SelectItem>)}</SelectContent></Select></div>
      <div><Label>Category</Label><Select value={category} onValueChange={setCategory}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All categories</SelectItem>{["mediator_conduct", "staff_conduct", "service_process", "communication", "billing", "confidentiality_data", "other"].map((item) => <SelectItem key={item} value={item}>{item.replaceAll("_", " ")}</SelectItem>)}</SelectContent></Select></div>
      <div><Label>Case reference</Label><Input value={caseRef} onChange={(e) => setCaseRef(e.target.value)} /></div><div><Label>Subject</Label><Input value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
      <div><Label>Submitted from</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div><div><Label>Submitted to</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
      <label className="flex items-center gap-2 self-end pb-2 text-sm"><Checkbox checked={overdueAck} onCheckedChange={(v) => setOverdueAck(v === true)} />Overdue acknowledgement</label><label className="flex items-center gap-2 self-end pb-2 text-sm"><Checkbox checked={overdueResponse} onCheckedChange={(v) => setOverdueResponse(v === true)} />Overdue response</label>
    </CardContent></Card>
    <Card><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Reference</TableHead><TableHead>Case</TableHead><TableHead>Status</TableHead><TableHead>Category</TableHead><TableHead>Received</TableHead><TableHead>Response due</TableHead></TableRow></TableHeader><TableBody>{isLoading ? <TableRow><TableCell colSpan={6}>Loading…</TableCell></TableRow> : data.length === 0 ? <TableRow><TableCell colSpan={6}>No matching complaints.</TableCell></TableRow> : data.map(({ complaint, caseRef: ref }) => <TableRow key={complaint.id}><TableCell><Link href={`/complaints/${complaint.id}`} className="font-medium text-primary hover:underline">{complaint.complaintRef}</Link></TableCell><TableCell>{ref}</TableCell><TableCell><Badge variant="outline">{complaint.status.replaceAll("_", " ")}</Badge></TableCell><TableCell>{complaint.category.replaceAll("_", " ")}</TableCell><TableCell>{formatDate(complaint.receivedAt)}</TableCell><TableCell>{formatDate(complaint.responseDueAt)}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card>
  </div>;
}
