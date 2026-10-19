import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/hooks/use-auth";

const categories = [
  ["mediator_conduct", "Mediator conduct"], ["staff_conduct", "Staff conduct"],
  ["service_process", "Service or process"], ["communication", "Communication"],
  ["billing", "Billing"], ["confidentiality_data", "Confidentiality or data"], ["other", "Other"],
] as const;

async function encodeFiles(files: File[]) {
  return Promise.all(files.map(async (file) => ({
    fileName: file.name,
    mimeType: file.type,
    fileData: await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error);
      reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
      reader.readAsDataURL(file);
    }),
  })));
}

export function ComplaintForm({ caseId, requireCaseRef = false, onCreated }: { caseId?: string; requireCaseRef?: boolean; onCreated?: (id: string) => void }) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [caseRef, setCaseRef] = useState("");
  const [category, setCategory] = useState("service_process");
  const [targetType, setTargetType] = useState("service");
  const [targetName, setTargetName] = useState("");
  const [incidentDate, setIncidentDate] = useState("");
  const [details, setDetails] = useState("");
  const [desiredResolution, setDesiredResolution] = useState("");
  const [supportingNotes, setSupportingNotes] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [submissionChannel, setSubmissionChannel] = useState("portal");
  const [onBehalfOfName, setOnBehalfOfName] = useState("");
  const [onBehalfOfEmail, setOnBehalfOfEmail] = useState("");

  const submit = useMutation({
    mutationFn: async () => {
      const total = files.reduce((sum, file) => sum + file.size, 0);
      if (files.length > 5 || files.some((file) => file.size > 10 * 1024 * 1024) || total > 25 * 1024 * 1024) {
        throw new Error("Use up to five files, no more than 10 MB each and 25 MB total.");
      }
      const response = await apiRequest("POST", "/api/complaints", {
        ...(caseId ? { caseId } : { caseRef: caseRef.trim() }),
        category, targetType, targetName: targetName.trim() || null,
        incidentDate: incidentDate || null, details, desiredResolution: desiredResolution.trim() || null,
        supportingNotes: supportingNotes.trim() || null, attachments: await encodeFiles(files),
        ...(user?.role === "superadmin" ? { submissionChannel, onBehalfOfName: onBehalfOfName.trim() || null, onBehalfOfEmail: onBehalfOfEmail.trim() || null } : {}),
      });
      return response.json();
    },
    onSuccess: (result) => {
      toast({ title: "Complaint recorded", description: `Reference ${result.complaintRef}` });
      queryClient.invalidateQueries({ queryKey: ["/api/complaints/mine"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "complaints"] });
      setDetails(""); setDesiredResolution(""); setSupportingNotes(""); setFiles([]);
      onCreated?.(result.id);
    },
    onError: (error: Error) => toast({ title: "Could not record complaint", description: error.message, variant: "destructive" }),
  });

  return <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); submit.mutate(); }}>
    {requireCaseRef && <div className="space-y-1.5"><Label htmlFor="complaint-case-ref">Exact case reference</Label><Input id="complaint-case-ref" value={caseRef} onChange={(e) => setCaseRef(e.target.value)} required autoComplete="off" /><p className="text-xs text-muted-foreground">For privacy, no case or client information will be displayed.</p></div>}
    {user?.role === "superadmin" && <div className="rounded-md border p-4 space-y-3"><div className="space-y-1.5"><Label>Submission channel</Label><Select value={submissionChannel} onValueChange={setSubmissionChannel}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="portal">Direct portal entry</SelectItem><SelectItem value="phone">Phone</SelectItem><SelectItem value="email">Email</SelectItem><SelectItem value="staff_recorded">Recorded by staff</SelectItem></SelectContent></Select></div>{submissionChannel !== "portal" && <div className="grid gap-3 sm:grid-cols-2"><div><Label htmlFor="complainant-name">Complainant name</Label><Input id="complainant-name" value={onBehalfOfName} onChange={(e) => setOnBehalfOfName(e.target.value)} /></div><div><Label htmlFor="complainant-email">Complainant email</Label><Input id="complainant-email" type="email" value={onBehalfOfEmail} onChange={(e) => setOnBehalfOfEmail(e.target.value)} /></div></div>}</div>}
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-1.5"><Label>Category</Label><Select value={category} onValueChange={setCategory}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{categories.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
      <div className="space-y-1.5"><Label>Complaint concerns</Label><Select value={targetType} onValueChange={setTargetType}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="service">The service</SelectItem><SelectItem value="mediator">A mediator</SelectItem><SelectItem value="staff">A staff member</SelectItem><SelectItem value="other">Other</SelectItem></SelectContent></Select></div>
    </div>
    <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-1.5"><Label htmlFor="complaint-target">Person or service (optional)</Label><Input id="complaint-target" value={targetName} onChange={(e) => setTargetName(e.target.value)} /></div><div className="space-y-1.5"><Label htmlFor="complaint-date">Incident date (optional)</Label><Input id="complaint-date" type="date" value={incidentDate} onChange={(e) => setIncidentDate(e.target.value)} /></div></div>
    <div className="space-y-1.5"><Label htmlFor="complaint-details">Complaint details</Label><Textarea id="complaint-details" value={details} onChange={(e) => setDetails(e.target.value)} minLength={10} required className="min-h-32" /></div>
    <div className="space-y-1.5"><Label htmlFor="complaint-resolution">What outcome would you like? (optional)</Label><Textarea id="complaint-resolution" value={desiredResolution} onChange={(e) => setDesiredResolution(e.target.value)} /></div>
    <div className="space-y-1.5"><Label htmlFor="complaint-notes">Supporting notes (optional)</Label><Textarea id="complaint-notes" value={supportingNotes} onChange={(e) => setSupportingNotes(e.target.value)} /></div>
    <div className="space-y-1.5"><Label htmlFor="complaint-files">Evidence (PDF, JPEG or PNG)</Label><Input id="complaint-files" type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" multiple onChange={(e) => setFiles(Array.from(e.target.files || []))} /><p className="text-xs text-muted-foreground">Maximum five files, 10 MB each and 25 MB total.</p></div>
    <Button type="submit" disabled={submit.isPending || details.trim().length < 10 || (requireCaseRef && !caseRef.trim())}>{submit.isPending ? "Submitting securely…" : "Submit complaint"}</Button>
  </form>;
}
