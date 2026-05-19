import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { PageHeader } from "@/admin/components/PageHeader";
import { Save } from "lucide-react";
import { toast } from "sonner";

export default function VisaSettings() {
  const [s, setS] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.from("visa_settings").select("*").limit(1).maybeSingle().then(({ data, error }) => {
      if (error) toast.error(error.message);
      else setS(data);
    });
  }, []);

  const upd = (p: any) => setS((x: any) => ({ ...x, ...p }));

  const save = async () => {
    if (!s) return;
    setBusy(true);
    const { id, created_at, updated_at, ...payload } = s;
    const { error } = await supabase.from("visa_settings").update(payload).eq("id", s.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Paramètres enregistrés");
  };

  if (!s) return <p className="text-muted-foreground">Chargement…</p>;

  const F = (k: string, label: string) => (
    <div><Label className="text-xs">{label}</Label><Input value={s[k] ?? ""} onChange={(e) => upd({ [k]: e.target.value })} /></div>
  );

  return (
    <div>
      <PageHeader title="Paramètres visa Japon" description="Informations par défaut du garant / référent au Japon (page 2 du PDF officiel)" />

      <Card className="p-6 mb-4">
        <h2 className="font-display text-lg mb-4">Garant / référent au Japon</h2>
        <div className="grid md:grid-cols-2 gap-4">
          {F("guarantor_name", "Nom")}
          {F("guarantor_tel", "Téléphone")}
          <div className="md:col-span-2">{F("guarantor_address", "Adresse")}</div>
          {F("guarantor_dob", "Date de naissance (JJ/MM/AAAA)")}
          {F("guarantor_sex", "Sexe (Male/Female)")}
          {F("guarantor_relationship", "Relation avec le demandeur")}
          {F("guarantor_profession", "Profession")}
          {F("guarantor_nationality", "Nationalité / statut migratoire")}
        </div>
      </Card>

      <Card className="p-6 mb-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-lg">Inviteur au Japon</h2>
          <div className="flex items-center gap-2">
            <Switch checked={!!s.inviter_same_as_guarantor} onCheckedChange={(v) => upd({ inviter_same_as_guarantor: v })} />
            <Label className="text-sm">Identique au garant</Label>
          </div>
        </div>
        {!s.inviter_same_as_guarantor && (
          <div className="grid md:grid-cols-2 gap-4">
            {F("inviter_name", "Nom")}
            {F("inviter_tel", "Téléphone")}
            <div className="md:col-span-2">{F("inviter_address", "Adresse")}</div>
            {F("inviter_dob", "Date de naissance")}
            {F("inviter_sex", "Sexe")}
            {F("inviter_relationship", "Relation")}
            {F("inviter_profession", "Profession")}
            {F("inviter_nationality", "Nationalité")}
          </div>
        )}
      </Card>

      <div className="flex justify-end">
        <Button onClick={save} disabled={busy}><Save className="w-4 h-4" /> Enregistrer</Button>
      </div>
    </div>
  );
}