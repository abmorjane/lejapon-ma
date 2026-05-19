import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Plus, Mail, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";

type Campaign = {
  id: string;
  name: string;
  subject: string | null;
  status: string | null;
  scheduled_at: string | null;
  sent_at: string | null;
  total_recipients: number | null;
  open_count: number | null;
  click_count: number | null;
  created_at: string;
};

export default function MarketingCampaigns() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("email_campaigns")
        .select("id,name,subject,status,scheduled_at,sent_at,total_recipients,open_count,click_count,created_at")
        .order("created_at", { ascending: false });
      setCampaigns((data ?? []) as unknown as Campaign[]);
      setLoading(false);
    })();
  }, []);

  const createNew = async () => {
    const { data, error } = await supabase
      .from("email_campaigns")
      .insert({ name: "Nouvelle campagne", subject: "(Sans sujet)", status: "draft" as never })
      .select("id")
      .single();
    if (!error && data) {
      window.location.href = `/admin/marketing/campaigns/${data.id}`;
    }
  };

  const deleteCampaign = async (id: string) => {
    await supabase.from("email_campaign_recipients").delete().eq("campaign_id", id);
    await supabase.from("email_events").delete().eq("campaign_id", id);
    const { error } = await supabase.from("email_campaigns").delete().eq("id", id);
    if (error) {
      toast.error("Suppression impossible: " + error.message);
      return;
    }
    setCampaigns((prev) => prev.filter((c) => c.id !== id));
    toast.success("Campagne supprimée");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Campagnes</h1>
          <p className="text-sm text-muted-foreground">Gérez vos campagnes emailing</p>
        </div>
        <Button onClick={createNew}><Plus className="w-4 h-4 mr-2" /> Nouvelle campagne</Button>
      </div>
      {loading ? (
        <p className="text-muted-foreground">Chargement…</p>
      ) : campaigns.length === 0 ? (
        <Card className="p-12 text-center">
          <Mail className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
          <p className="text-muted-foreground">Aucune campagne pour l'instant</p>
        </Card>
      ) : (
        <Card className="divide-y divide-border">
          {campaigns.map((c) => (
            <div key={c.id} className="flex items-center justify-between p-4 hover:bg-muted/40">
              <Link to={`/admin/marketing/campaigns/${c.id}`} className="flex-1 min-w-0">
                <p className="font-medium truncate">{c.name}</p>
                <p className="text-sm text-muted-foreground truncate">{c.subject ?? "—"}</p>
              </Link>
              <div className="flex items-center gap-3 text-sm">
                <Badge variant={c.status === "sent" ? "default" : "secondary"}>{c.status ?? "draft"}</Badge>
                <span className="text-muted-foreground hidden sm:inline">
                  {c.sent_at ? format(new Date(c.sent_at), "dd/MM/yyyy") : c.scheduled_at ? `Prévu ${format(new Date(c.scheduled_at), "dd/MM/yyyy")}` : "—"}
                </span>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="icon" onClick={(e) => e.stopPropagation()} aria-label="Supprimer">
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Supprimer cette campagne ?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Cette action est irréversible. La campagne « {c.name} » et tous ses destinataires/événements associés seront supprimés.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Annuler</AlertDialogCancel>
                      <AlertDialogAction onClick={() => deleteCampaign(c.id)}>Supprimer</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}