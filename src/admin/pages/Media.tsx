import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "../components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Upload, Trash2, Copy } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { optimizeImage } from "@/lib/image-upload";

export default function Media() {
  const { user } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => { const { data } = await supabase.from("media").select("*").order("created_at", { ascending: false }); setRows(data ?? []); };
  useEffect(() => { load(); }, []);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        const isImage = file.type.startsWith("image/");
        const toUpload = isImage ? await optimizeImage(file) : file;
        const path = `${Date.now()}-${toUpload.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
        const { error: upErr } = await supabase.storage
          .from("media")
          .upload(path, toUpload, { contentType: toUpload.type });
        if (upErr) throw upErr;
        const { data: pub } = supabase.storage.from("media").getPublicUrl(path);
        await supabase.from("media").insert({
          storage_path: path, url: pub.publicUrl, mime_type: toUpload.type, size_bytes: toUpload.size, uploaded_by: user?.id,
        });
      }
      toast.success("Upload terminé"); load();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); if (fileRef.current) fileRef.current.value = ""; }
  };

  const remove = async (m: any) => {
    if (!confirm("Supprimer ce média ?")) return;
    await supabase.storage.from("media").remove([m.storage_path]);
    await supabase.from("media").delete().eq("id", m.id);
    load();
  };

  const copyUrl = (url: string) => { navigator.clipboard.writeText(url); toast.success("URL copiée"); };

  return (
    <div>
      <PageHeader title="Médias" description="Galerie de photos et vidéos."
        action={
          <>
            <input ref={fileRef} type="file" multiple accept="image/*,video/*" className="hidden" onChange={(e) => upload(e.target.files)} />
            <Button onClick={() => fileRef.current?.click()} disabled={busy}><Upload className="w-4 h-4" /> {busy ? "Upload…" : "Uploader"}</Button>
          </>
        }
      />
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {rows.length === 0 && <p className="col-span-full text-center text-muted-foreground py-12">Aucun média.</p>}
        {rows.map((m) => (
          <div key={m.id} className="group relative rounded-xl overflow-hidden bg-secondary flex flex-col">
            <div className="relative aspect-square">
              {m.mime_type?.startsWith("video") ? (
                <video src={m.url} className="w-full h-full object-cover" muted />
              ) : (
                <img src={m.url} alt={m.alt ?? ""} className="w-full h-full object-cover" loading="lazy" />
              )}
              <div className="absolute inset-0 bg-foreground/70 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2 text-background">
                <Button size="sm" variant="secondary" onClick={() => copyUrl(m.url)}><Copy className="w-3.5 h-3.5" /> URL</Button>
                <Button size="sm" variant="destructive" onClick={() => remove(m)}><Trash2 className="w-3.5 h-3.5" /> Supprimer</Button>
              </div>
            </div>
            <Input
              defaultValue={m.alt ?? ""}
              placeholder="Texte ALT (SEO)"
              className="rounded-none border-0 border-t border-border h-8 text-xs bg-background"
              onBlur={async (e) => {
                const v = e.target.value.trim() || null;
                if (v !== (m.alt ?? null)) {
                  await supabase.from("media").update({ alt: v }).eq("id", m.id);
                  load();
                }
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
