import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, FileText, ArrowRight } from "lucide-react";
import { Seo } from "@/components/Seo";
import { toast } from "sonner";
import { useRouteSlugs, pathFor } from "@/hooks/useRouteSlugs";
import { lookupVisaPrefillByPassport, normalizePassportNo } from "@/lib/visa-prefill";

const todayISO = () => new Date().toISOString().slice(0, 10);

const STATUS_LABEL: Record<string, string> = {
  draft: "Brouillon",
  submitted: "Soumise",
  awaiting_documents: "En attente des documents",
  documents_received: "Documents reçus",
  in_review: "En traitement",
  submitted_to_embassy: "Soumise à l'ambassade",
  approved: "Approuvée",
  rejected: "Rejetée",
  completed: "Terminée",
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "outline",
  submitted: "secondary",
  awaiting_documents: "outline",
  documents_received: "secondary",
  in_review: "secondary",
  submitted_to_embassy: "secondary",
  approved: "default",
  rejected: "destructive",
  completed: "default",
};

export default function VisaList() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const slugs = useRouteSlugs();
  const visaBase = pathFor(slugs, "visa");
  const [items, setItems] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      nav(`${visaBase}/login`, { replace: true });
      return;
    }
    supabase
      .from("visa_applications")
      .select("id, reference, status, surname, given_names, created_at, submitted_at")
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (error) toast.error(error.message);
        else setItems(data ?? []);
      });
  }, [user, loading, nav]);

  const create = async () => {
    if (!user) return;
    setBusy(true);
    const metadata = user.user_metadata ?? {};
    const passportNo = normalizePassportNo(metadata.passport_no);
    let prefillPatch: Record<string, unknown> = {};
    let prefillMessage: string | null = null;

    if (passportNo) {
      const lookup = await lookupVisaPrefillByPassport({
        passportNo,
        lastName: String(metadata.last_name ?? ""),
        email: user.email ?? "",
      });
      if (lookup.status === "matched") {
        prefillPatch = lookup.patch;
        prefillMessage = `Formulaire prérempli depuis: ${lookup.sourceLabel}.`;
      } else {
        prefillMessage = lookup.message;
      }
    }

    const { data, error } = await supabase
      .from("visa_applications")
      .insert({
        user_id: user.id,
        category: "tourism",
        passport_type: "ordinary",
        purpose_of_visit: "Tourisme",
        date_of_application: todayISO(),
        surname: metadata.last_name || null,
        given_names: metadata.first_name || null,
        passport_no: passportNo || null,
        ...prefillPatch,
      })
      .select("id")
      .single();
    setBusy(false);
    if (error) return toast.error(error.message);
    if (prefillMessage) toast.info(prefillMessage);
    nav(`${visaBase}/${data!.id}`);
  };

  return (
    <div className="container-app py-12 max-w-4xl">
      <Seo title="Demande de visa Japon — lejapon.ma" description="Préparez votre dossier de visa Japon en ligne. Formulaire numérique, génération PDF officielle et suivi par notre équipe." canonical={visaBase} />
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-display text-3xl md:text-4xl mb-2">Mes demandes de visa Japon</h1>
          <p className="text-muted-foreground">Préparez et suivez votre dossier en toute sécurité.</p>
        </div>
        <Button onClick={create} disabled={busy}>
          <Plus className="w-4 h-4" /> Nouvelle demande
        </Button>
      </div>

      {items.length === 0 ? (
        <Card className="p-10 text-center">
          <FileText className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
          <p className="text-muted-foreground mb-5">Aucune demande pour le moment.</p>
          <Button onClick={create} disabled={busy}>Commencer ma demande</Button>
        </Card>
      ) : (
        <div className="space-y-3">
          {items.map((it) => (
            <Link key={it.id} to={`${visaBase}/${it.id}`} className="block">
              <Card className="p-5 flex items-center justify-between hover:border-accent transition-colors">
                <div>
                  <div className="flex items-center gap-3 mb-1">
                    <span className="font-semibold">{it.reference}</span>
                    <Badge variant={STATUS_VARIANT[it.status]}>{STATUS_LABEL[it.status]}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {[it.surname, it.given_names].filter(Boolean).join(" ") || "Demande sans nom"}
                  </p>
                </div>
                <ArrowRight className="w-5 h-5 text-muted-foreground" />
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
