import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { EmailRichTextEditor, type EmailVariable } from "@/components/email/email-rich-text-editor";
import { findTemplateVariables } from "@shared/email-template-core";
import { Plus, Save } from "lucide-react";

type Template = { id: string; code: string; name: string; subject: string; bodyHtml: string; guidance: string; kind: "manual" | "system" | "calendar"; status: "draft" | "published"; variables: EmailVariable[]; requiredVariables: string[]; isArchived: boolean };
type Link = { key: string; label: string; url: string };
const empty: Omit<Template, "id"> = { code: "", name: "", subject: "", bodyHtml: "<p></p>", guidance: "", kind: "manual", status: "draft", variables: [], requiredVariables: [], isArchived: false };

export default function EmailTemplatesPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<Partial<Template>>(empty);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ subject: string; bodyHtml: string; missing: string[] } | null>(null);
  const [newKey, setNewKey] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [editedLinks, setEditedLinks] = useState<Record<string, string>>({});
  const query = useQuery<Template[]>({ queryKey: ["/api/email-templates"], queryFn: async () => { const r = await fetch("/api/email-templates", { credentials: "include" }); if (!r.ok) throw new Error("Unable to load templates"); return r.json(); } });
  const links = useQuery<Link[]>({ queryKey: ["/api/email-template-links"], queryFn: async () => { const r = await fetch("/api/email-template-links", { credentials: "include" }); if (!r.ok) throw new Error("Unable to load shared links"); return r.json(); } });
  const save = useMutation({ mutationFn: async (publish: boolean) => { const payload = draft.kind === "system" ? { name: draft.name, subject: draft.subject, bodyHtml: draft.bodyHtml, guidance: draft.guidance, isArchived: draft.isArchived } : { ...draft, status: publish ? "published" : draft.status }; const r = selectedId ? await apiRequest("PATCH", `/api/email-templates/${selectedId}`, payload) : await apiRequest("POST", "/api/email-templates", payload); return r.json() as Promise<Template>; }, onSuccess: next => { setSelectedId(next.id); setDraft(next); queryClient.invalidateQueries({ queryKey: ["/api/email-templates"] }); toast({ title: "Template saved" }); }, onError: (e: Error) => toast({ title: "Unable to save template", description: e.message, variant: "destructive" }) });
  const saveLink = useMutation({ mutationFn: async (key: string) => { const r = await apiRequest("PATCH", `/api/email-template-links/${key}`, { url: editedLinks[key] }); return r.json(); }, onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/email-template-links"] }); toast({ title: "Shared link saved" }); }, onError: (e: Error) => toast({ title: "Unable to save link", description: e.message, variant: "destructive" }) });
  const showPreview = async () => { try { const r = await apiRequest("POST", "/api/email-templates/preview", { subject: draft.subject || "", bodyHtml: draft.bodyHtml || "", variables: {} }); setPreview(await r.json()); } catch (error) { toast({ title: "Preview failed", description: String(error), variant: "destructive" }); } };
  const templates = (query.data || []).filter(t => `${t.code} ${t.name} ${t.kind} ${t.status}`.toLowerCase().includes(search.toLowerCase()));
  const variableOptions = useMemo(() => { const list = [...(draft.variables || [])]; for (const key of findTemplateVariables(`${draft.subject || ""} ${draft.bodyHtml || ""}`)) if (!list.some(item => item.key === key)) list.push({ key, label: key.replace(/_/g, " ") }); for (const link of links.data || []) if (!list.some(item => item.key === link.key)) list.push({ key: link.key, label: `${link.label} link` }); return list; }, [draft.variables, draft.subject, draft.bodyHtml, links.data]);
  const canPublish = user?.role === "superadmin" && draft.kind !== "system" && draft.status !== "published" && !!selectedId;
  const locked = user?.role !== "superadmin" && draft.kind !== "system" && draft.status === "published";

  return <div className="p-4 md:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
    <div><h1 className="text-2xl font-heading font-semibold">Email templates</h1><p className="text-sm text-muted-foreground">Edit wording for future emails. Review document templates need Super Admin publication before use.</p></div>
    <div className="grid lg:grid-cols-[330px_1fr] gap-6">
      <Card><CardHeader><div className="flex items-center justify-between gap-2"><CardTitle className="text-base">Templates</CardTitle><Button size="sm" onClick={() => { setSelectedId(null); setDraft(empty); setPreview(null); }} aria-label="New template"><Plus className="w-4 h-4" /></Button></div><Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search code or name" /></CardHeader><CardContent className="space-y-2 max-h-[70vh] overflow-y-auto">{templates.map(t => <button key={t.id} className={`w-full text-left p-3 rounded border ${selectedId === t.id ? "border-primary bg-primary/5" : ""}`} onClick={() => { setSelectedId(t.id); setDraft(t); setPreview(null); }}><p className="font-medium text-sm">{t.code} — {t.name}</p><p className="text-xs text-muted-foreground">{t.kind} · {t.status}{t.isArchived ? " · archived" : ""}</p><p className="text-xs text-muted-foreground truncate">{t.subject}</p></button>)}</CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">{selectedId ? "Edit template" : "New template"}</CardTitle></CardHeader><CardContent className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-3"><div><Label htmlFor="template-code">Code</Label><Input id="template-code" value={draft.code || ""} disabled={!!selectedId} onChange={e => setDraft({ ...draft, code: e.target.value })} placeholder="CUSTOM_1" /></div><div><Label htmlFor="template-name">Name</Label><Input id="template-name" value={draft.name || ""} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="Template name" /></div></div>
        {draft.guidance && <p className="rounded border bg-muted/30 p-3 text-sm">{draft.guidance}</p>}
        <div><Label htmlFor="template-subject">Subject</Label><Input id="template-subject" value={draft.subject || ""} onChange={e => setDraft({ ...draft, subject: e.target.value })} /></div>
        <div><Label>Message</Label><EmailRichTextEditor value={draft.bodyHtml || ""} onChange={bodyHtml => setDraft(previous => ({ ...previous, bodyHtml }))} variables={variableOptions} /></div>
        <div className="rounded border p-3 space-y-2"><p className="font-medium text-sm">Variables</p><p className="text-xs text-muted-foreground">Case and client details fill automatically; the sender fills remaining fields.</p><div className="flex gap-2"><Input aria-label="Variable key" placeholder="variable_key" value={newKey} onChange={e => setNewKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))} /><Input aria-label="Variable label" placeholder="Label shown to sender" value={newLabel} onChange={e => setNewLabel(e.target.value)} /><Button type="button" variant="outline" disabled={!/^[a-z][a-z0-9_]*$/.test(newKey) || !newLabel.trim()} onClick={() => { setDraft(previous => ({ ...previous, variables: [...(previous.variables || []).filter(item => item.key !== newKey), { key: newKey, label: newLabel }] })); setNewKey(""); setNewLabel(""); }}>Add</Button></div><div className="flex flex-wrap gap-1">{variableOptions.map(item => <span className="rounded bg-muted px-2 py-1 text-xs" key={item.key}>{item.label}: {`{{${item.key}}}`}</span>)}</div></div>
        {selectedId && draft.kind !== "system" && <label className="flex items-center gap-2 text-sm"><Checkbox checked={!!draft.isArchived} onCheckedChange={v => setDraft({ ...draft, isArchived: Boolean(v) })} />Archive this template</label>}
        <div className="flex flex-wrap gap-2"><Button onClick={() => save.mutate(false)} disabled={locked || save.isPending || !draft.code || !draft.name}><Save className="w-4 h-4 mr-2" />Save template</Button><Button type="button" variant="outline" onClick={showPreview}>Preview</Button>{canPublish && <Button type="button" variant="secondary" disabled={save.isPending} onClick={() => save.mutate(true)}>Publish for use</Button>}</div>
        {preview && <div className="rounded border p-4 space-y-2"><h3 className="font-medium">Preview: {preview.subject}</h3>{preview.missing.length > 0 && <p className="text-amber-700 text-sm">Needs values: {preview.missing.join(", ")}</p>}<div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: preview.bodyHtml }} /></div>}
      </CardContent></Card>
    </div>
    <Card><CardHeader><CardTitle className="text-base">Shared links</CardTitle></CardHeader><CardContent className="grid gap-3 md:grid-cols-2">{(links.data || []).map(link => <div key={link.key} className="space-y-1"><Label htmlFor={`link-${link.key}`}>{link.label} ({link.key})</Label><div className="flex gap-2"><Input id={`link-${link.key}`} value={editedLinks[link.key] ?? link.url} onChange={e => setEditedLinks(previous => ({ ...previous, [link.key]: e.target.value }))} /><Button variant="outline" disabled={!editedLinks[link.key] || editedLinks[link.key] === link.url} onClick={() => saveLink.mutate(link.key)}>Save</Button></div></div>)}</CardContent></Card>
  </div>;
}
