import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/admin/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Save, Eye, EyeOff, ShieldCheck } from "lucide-react";

type EmailSettings = {
  id: string;
  smtp_host: string;
  smtp_port: number;
  smtp_secure: "ssl" | "starttls" | "none";
  smtp_username: string;
  smtp_password: string;
  from_email: string;
  from_name: string;
  reply_to: string | null;
  is_active: boolean;
};

const EmailSettingsPage = () => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [settings, setSettings] = useState<EmailSettings | null>(null);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("email_settings")
        .select("*")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) {
        toast({ title: "Erreur", description: error.message, variant: "destructive" });
      } else if (data) {
        setSettings(data as EmailSettings);
      }
      setLoading(false);
    })();
  }, [toast]);

  const update = <K extends keyof EmailSettings>(k: K, v: EmailSettings[K]) =>
    setSettings((s) => (s ? { ...s, [k]: v } : s));

  const onSave = async () => {
    if (!settings) return;
    setSaving(true);
    const { error } = await supabase
      .from("email_settings")
      .update({
        smtp_host: settings.smtp_host.trim(),
        smtp_port: Number(settings.smtp_port) || 465,
        smtp_secure: settings.smtp_secure,
        smtp_username: settings.smtp_username.trim(),
        smtp_password: settings.smtp_password,
        from_email: settings.from_email.trim(),
        from_name: settings.from_name.trim(),
        reply_to: settings.reply_to?.trim() || null,
        is_active: settings.is_active,
      })
      .eq("id", settings.id);
    setSaving(false);
    if (error) {
      toast({ title: "Échec de l'enregistrement", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Paramètres enregistrés", description: "La configuration SMTP a été mise à jour." });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" /> Chargement…
      </div>
    );
  }

  if (!settings) {
    return <p className="text-muted-foreground">Aucun enregistrement trouvé.</p>;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Paramètres email (SMTP)"
        description="Configurez votre serveur d'envoi (mail.lejapon.ma, etc.). Vous pouvez modifier ces informations à tout moment."
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-accent" />
            Connexion au serveur d'envoi
          </CardTitle>
          <CardDescription>
            Ces informations sont stockées de façon sécurisée et ne sont accessibles qu'aux Super Admins.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="host">Hôte SMTP</Label>
              <Input
                id="host"
                placeholder="mail.lejapon.ma"
                value={settings.smtp_host}
                onChange={(e) => update("smtp_host", e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="port">Port</Label>
                <Input
                  id="port"
                  type="number"
                  placeholder="465"
                  value={settings.smtp_port}
                  onChange={(e) => update("smtp_port", Number(e.target.value))}
                />
              </div>
              <div className="space-y-2">
                <Label>Sécurité</Label>
                <Select
                  value={settings.smtp_secure}
                  onValueChange={(v) => update("smtp_secure", v as EmailSettings["smtp_secure"])}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ssl">SSL/TLS (port 465)</SelectItem>
                    <SelectItem value="starttls">STARTTLS (port 587)</SelectItem>
                    <SelectItem value="none">Aucune (port 25)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="user">Identifiant</Label>
              <Input
                id="user"
                placeholder="info@lejapon.ma"
                value={settings.smtp_username}
                onChange={(e) => update("smtp_username", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pass">Mot de passe</Label>
              <div className="relative">
                <Input
                  id="pass"
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={settings.smtp_password}
                  onChange={(e) => update("smtp_password", e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  className="absolute inset-y-0 right-2 flex items-center text-muted-foreground hover:text-foreground"
                  aria-label="Afficher / masquer"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="from_name">Nom expéditeur</Label>
              <Input
                id="from_name"
                placeholder="lejapon.ma"
                value={settings.from_name}
                onChange={(e) => update("from_name", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="from_email">Email expéditeur</Label>
              <Input
                id="from_email"
                type="email"
                placeholder="info@lejapon.ma"
                value={settings.from_email}
                onChange={(e) => update("from_email", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reply_to">Répondre à (optionnel)</Label>
              <Input
                id="reply_to"
                type="email"
                placeholder="contact@lejapon.ma"
                value={settings.reply_to ?? ""}
                onChange={(e) => update("reply_to", e.target.value)}
              />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border p-4">
            <div>
              <p className="font-medium text-sm">Activer l'envoi d'emails</p>
              <p className="text-xs text-muted-foreground">
                Désactivez pour mettre en pause toutes les campagnes sans perdre la configuration.
              </p>
            </div>
            <Switch
              checked={settings.is_active}
              onCheckedChange={(v) => update("is_active", v)}
            />
          </div>

          <div className="flex justify-end">
            <Button onClick={onSave} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Enregistrer
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default EmailSettingsPage;