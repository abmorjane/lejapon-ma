import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { wrapEmailHtml, renderPreview, MARKETING_VARIABLES } from "@/admin/lib/marketing";
import { toast } from "sonner";
import { ArrowLeft, Save, Send, TestTube2 } from "lucide-react";

export default function MarketingCampaignEdit() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [c, setC] = useState<any>(null);
  const [segments, setSegments] = useState<any[]>([]);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    (async () => {
      const [{ data: camp }, { data: segs }] = await Promise.all([
        supabase.from("email_campaigns").select("*").eq("id", id).single(),
        supabase.from("marketing_segments").select("id,name").order("name"),
      ]);
      setC(camp);
      setSegments(segs ?? []);
      setLoading(false);
    })();
  }, [id]);

  const previewHtml = useMemo(() => {
    if (!c) return "";
    const shell = wrapEmailHtml({
      bodyHtml: c.html_body ?? "",
      preheader: c.preheader,
      ctaLabel: c.cta_label,
      ctaUrl: c.cta_url,
      heroImageUrl: c.hero_image_url,
      companyName: c.company_name ?? "lejapon.ma",
      companyAddress: c.company_address ?? "",
      unsubscribeUrl: "#",
    });
    return renderPreview(shell);
  }, [c]);

  const insertVariable = (v: string) => {
    const ta = bodyRef.current;
    if (!ta) return;
    const start = ta.selectionStart, end = ta.selectionEnd;
    const next = (c.html_body ?? "").slice(0, start) + v + (c.html_body ?? "").slice(end);
    setC({ ...c, html_body: next });
  };

  const save = async () => {
    setSaving(true);
    const { error } = await supabase.from("email_campaigns").update({
      name: c.name, subject: c.subject, preheader: c.preheader,
      html_body: c.html_body, cta_label: c.cta_label, cta_url: c.cta_url,
      hero_image_url: c.hero_image_url, segment_id: c.segment_id, language: c.language,
      from_name: c.from_name, from_email: c.from_email, reply_to: c.reply_to,
      scheduled_at: c.scheduled_at,
    }).eq("id", id);
    setSaving(false);
    if (error) toast.error(error.message); else toast.success("Campagne enregistrée");
  };

  const sendTest = async () => {
    const email = window.prompt("Adresse email de test ?");
    if (!email) return;
    const { data, error } = await supabase.functions.invoke("send-marketing-campaign", {
      body: { campaign_id: id, test_email: email },
    });
    if (error) toast.error(error.message);
    else toast.success(`Test envoyé (${(data as any)?.sent ?? 0})`);
  };

  const sendCampaign = async () => {
    if (!window.confirm("Envoyer la campagne à tous les destinataires ciblés ?")) return;
    const { data, error } = await supabase.functions.invoke("send-marketing-campaign", {
      body: { campaign_id: id },
    });
    if (error) toast.error(error.message);
    else { toast.success(`Envoi terminé : ${(data as any)?.sent ?? 0} envoyés, ${(data as any)?.failed ?? 0} échecs`); navigate("/admin/marketing/campaigns"); }
  };

  if (loading) return <p className="text-muted-foreground">Chargement…</p>;
  if (!c) return <p className="text-muted-foreground">Campagne introuvable</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/admin/marketing/campaigns")}><ArrowLeft className="w-4 h-4" /></Button>
          <h1 className="text-2xl font-semibold">{c.name || "Sans titre"}</h1>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={sendTest}><TestTube2 className="w-4 h-4 mr-2" />Test</Button>
          <Button variant="outline" onClick={save} disabled={saving}><Save className="w-4 h-4 mr-2" />{saving ? "…" : "Enregistrer"}</Button>
          <Button onClick={sendCampaign}><Send className="w-4 h-4 mr-2" />Envoyer</Button>
        </div>
      </div>

      <Tabs defaultValue="config">
        <TabsList>
          <TabsTrigger value="config">Configuration</TabsTrigger>
          <TabsTrigger value="content">Contenu</TabsTrigger>
          <TabsTrigger value="preview">Aperçu</TabsTrigger>
        </TabsList>

        <TabsContent value="config" className="space-y-4 mt-4">
          <Card className="p-4 space-y-3">
            <div><Label>Nom interne</Label><Input value={c.name ?? ""} onChange={(e) => setC({ ...c, name: e.target.value })} /></div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div><Label>Expéditeur</Label><Input value={c.from_name ?? ""} onChange={(e) => setC({ ...c, from_name: e.target.value })} /></div>
              <div><Label>Email expéditeur</Label><Input value={c.from_email ?? ""} onChange={(e) => setC({ ...c, from_email: e.target.value })} /></div>
              <div><Label>Reply-To</Label><Input value={c.reply_to ?? ""} onChange={(e) => setC({ ...c, reply_to: e.target.value })} /></div>
              <div>
                <Label>Langue</Label>
                <Select value={c.language ?? "fr"} onValueChange={(v) => setC({ ...c, language: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fr">Français</SelectItem>
                    <SelectItem value="en">Anglais</SelectItem>
                    <SelectItem value="ar">Arabe</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Segment</Label>
                <Select value={c.segment_id ?? ""} onValueChange={(v) => setC({ ...c, segment_id: v || null })}>
                  <SelectTrigger><SelectValue placeholder="Tous les abonnés" /></SelectTrigger>
                  <SelectContent>
                    {segments.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Programmer (optionnel)</Label>
                <Input type="datetime-local" value={c.scheduled_at ? c.scheduled_at.slice(0, 16) : ""}
                  onChange={(e) => setC({ ...c, scheduled_at: e.target.value ? new Date(e.target.value).toISOString() : null })} />
              </div>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="content" className="space-y-4 mt-4">
          <Card className="p-4 space-y-3">
            <div><Label>Sujet</Label><Input value={c.subject ?? ""} onChange={(e) => setC({ ...c, subject: e.target.value })} /></div>
            <div><Label>Pré-en-tête</Label><Input value={c.preheader ?? ""} onChange={(e) => setC({ ...c, preheader: e.target.value })} /></div>
            <div><Label>Image principale (URL)</Label><Input value={c.hero_image_url ?? ""} onChange={(e) => setC({ ...c, hero_image_url: e.target.value })} /></div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div><Label>Texte du bouton</Label><Input value={c.cta_label ?? ""} onChange={(e) => setC({ ...c, cta_label: e.target.value })} /></div>
              <div><Label>Lien du bouton</Label><Input value={c.cta_url ?? ""} onChange={(e) => setC({ ...c, cta_url: e.target.value })} /></div>
            </div>
            <div>
              <Label>Variables disponibles</Label>
              <div className="flex flex-wrap gap-2 mt-1">
                {MARKETING_VARIABLES.map((v) => (
                  <Button key={v.token} type="button" size="sm" variant="outline" onClick={() => insertVariable(v.token)} title={v.label}>{v.token}</Button>
                ))}
              </div>
            </div>
            <div>
              <Label>Contenu HTML</Label>
              <Textarea ref={bodyRef} rows={16} value={c.html_body ?? ""} onChange={(e) => setC({ ...c, html_body: e.target.value })} className="font-mono text-sm" />
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="preview" className="mt-4">
          <Card className="p-4">
            <iframe title="Aperçu" srcDoc={previewHtml} className="w-full h-[600px] bg-white rounded border" />
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}