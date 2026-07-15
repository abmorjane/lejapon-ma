import { Link } from "react-router-dom";
import { ArrowRight, FileText, Plus, Stamp } from "lucide-react";
import { useEffect, useState } from "react";
import { Seo } from "@/components/Seo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { fmtDateTime } from "@/lib/format";
import { useRouteSlugs, pathFor } from "@/hooks/useRouteSlugs";
import { loadClientVisaApplications, type ClientVisaApplication } from "../lib/client-portal";

export default function ClientVisa() {
  const slugs = useRouteSlugs();
  const visaBase = pathFor(slugs, "visa");
  const [items, setItems] = useState<ClientVisaApplication[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const rows = await loadClientVisaApplications();
        if (!cancelled) setItems(rows);
      } catch {
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-5">
      <Seo title="Visa Japon — Mon voyage LeJapon.ma" description="Suivi de votre demande de visa Japon LeJapon.ma." noindex />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-display text-3xl">Visa Japon</h1>
          <p className="mt-2 text-muted-foreground">Vos demandes visa existantes et le lien vers le formulaire officiel LeJapon.ma.</p>
        </div>
        <Button asChild>
          <Link to={`${visaBase}/applications?create=1`}><Plus className="h-4 w-4" /> Nouvelle demande</Link>
        </Button>
      </div>

      <Card className="rounded-2xl border-sky-200 bg-sky-50">
        <CardContent className="p-5 text-sm text-sky-950">
          Le formulaire visa reste le même espace sécurisé. Si vous avez déjà un compte visa avec cet email, vos demandes apparaissent ici.
        </CardContent>
      </Card>

      {loading ? <p className="text-sm text-muted-foreground">Chargement…</p> : null}
      {!loading && items.length === 0 ? (
        <Card className="rounded-2xl">
          <CardContent className="p-8 text-center">
            <Stamp className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
            <h2 className="font-display text-2xl">Aucune demande visa</h2>
            <p className="mt-2 text-muted-foreground">Vous pouvez commencer ou continuer votre demande depuis l’espace visa.</p>
            <Button asChild className="mt-5"><Link to={`${visaBase}/applications`}>Accéder à l’espace visa</Link></Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {items.map((item) => (
            <Card key={item.id} className="rounded-2xl shadow-sm">
              <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="mb-2 flex items-center gap-2">
                    <Badge variant="outline">{item.reference}</Badge>
                    <Badge>{statusLabel(item.status)}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">Créée le {fmtDateTime(item.created_at)}</p>
                </div>
                <Button asChild variant="outline">
                  <Link to={`${visaBase}/formulaire/${item.id}`}><FileText className="h-4 w-4" /> Continuer <ArrowRight className="h-4 w-4" /></Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function statusLabel(status?: string | null) {
  const labels: Record<string, string> = {
    draft: "Brouillon",
    submitted: "Soumise",
    awaiting_documents: "Documents demandés",
    documents_received: "Documents reçus",
    in_review: "En vérification",
    submitted_to_embassy: "Déposée",
    approved: "Approuvée",
    rejected: "Refusée",
    completed: "Terminée",
  };
  return labels[String(status || "")] || status || "À confirmer";
}

