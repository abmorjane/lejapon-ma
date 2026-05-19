import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "../components/PageHeader";
import { StatusBadge } from "../components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Plus, Pencil } from "lucide-react";
import { toast } from "sonner";
import { SiteSlugsEditor } from "../components/SiteSlugsEditor";

const empty = { slug: "", title: "", content: "{}", meta_description: "", status: "draft" };

export default function Pages() {
  const [rows, setRows] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<any>(empty);
  const load = async () => { const { data } = await supabase.from("pages").select("*").order("slug"); setRows(data ?? []); };
  useEffect(() => { load(); }, []);
  const save = async () => {
    let content: any = {};
    try { content = typeof edit.content === "string" ? JSON.parse(edit.content || "{}") : edit.content; }
    catch { return toast.error("JSON invalide"); }
    const payload = { ...edit, content };
    if (edit.id) await supabase.from("pages").update(payload).eq("id", edit.id);
    else await supabase.from("pages").insert(payload);
    toast.success("Enregistré"); setOpen(false); setEdit(empty); load();
  };

  return (
    <div>
      <PageHeader title="Pages" description="Contenu éditorial du site (homepage, à propos…)."
        action={
          <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEdit(empty); }}>
            <DialogTrigger asChild><Button><Plus className="w-4 h-4" /> Nouvelle page</Button></DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader><DialogTitle>{edit.id ? "Modifier" : "Nouvelle"} page</DialogTitle></DialogHeader>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Slug</Label><Input value={edit.slug} onChange={(e) => setEdit({ ...edit, slug: e.target.value })} placeholder="home" /></div>
                <div><Label>Titre</Label><Input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></div>
                <div className="col-span-2"><Label>Meta description</Label><Textarea rows={2} value={edit.meta_description ?? ""} onChange={(e) => setEdit({ ...edit, meta_description: e.target.value })} /></div>
                <div className="col-span-2"><Label>Contenu (JSON)</Label><Textarea rows={8} className="font-mono text-xs" value={typeof edit.content === "string" ? edit.content : JSON.stringify(edit.content, null, 2)} onChange={(e) => setEdit({ ...edit, content: e.target.value })} /></div>
                <div><Label>Statut</Label>
                  <Select value={edit.status} onValueChange={(v) => setEdit({ ...edit, status: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="draft">Brouillon</SelectItem><SelectItem value="published">Publié</SelectItem></SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter><Button onClick={save} disabled={!edit.title || !edit.slug}>Enregistrer</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />
      <SiteSlugsEditor />
      <div className="bg-background rounded-2xl border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-secondary/50 text-left"><tr><th className="p-4">Page</th><th className="p-4">Slug</th><th className="p-4">Statut</th><th className="p-4"></th></tr></thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 && <tr><td colSpan={4} className="p-8 text-center text-muted-foreground">Aucune page.</td></tr>}
            {rows.map((p) => (
              <tr key={p.id} className="hover:bg-secondary/30">
                <td className="p-4 font-medium">{p.title}</td>
                <td className="p-4 font-mono text-xs">/{p.slug}</td>
                <td className="p-4"><StatusBadge value={p.status} /></td>
                <td className="p-4 text-right"><Button size="sm" variant="ghost" onClick={() => { setEdit(p); setOpen(true); }}><Pencil className="w-4 h-4" /></Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
