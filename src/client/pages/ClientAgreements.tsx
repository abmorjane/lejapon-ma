import { Link } from "react-router-dom";
import { Download, FileSignature, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Seo } from "@/components/Seo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { fmtDateTime } from "@/lib/format";
import { supabase } from "@/integrations/supabase/client";
import { useClientPortalData } from "../lib/useClientPortalData";

export default function ClientAgreements() {
  const { agreements, loading } = useClientPortalData();

  const downloadFinalPdf = async (storagePath: string) => {
    try {
      const { data, error } = await supabase.storage.from("booking-docs").createSignedUrl(storagePath, 120);
      if (error || !data?.signedUrl) throw error ?? new Error("PDF indisponible.");
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } catch (error: any) {
      toast.error(error?.message ?? "PDF indisponible.");
    }
  };

  return (
    <div className="space-y-5">
      <Seo title="Mes accords de voyage — LeJapon.ma" description="Accords de voyage à lire, accepter ou télécharger." noindex />
      <div>
        <h1 className="font-display text-3xl">Mes accords de voyage</h1>
        <p className="mt-2 text-muted-foreground">Lisez, acceptez et téléchargez vos accords de voyage.</p>
      </div>

      {loading ? <p className="text-sm text-muted-foreground">Chargement…</p> : null}
      {!loading && agreements.length === 0 ? (
        <Card className="rounded-2xl">
          <CardContent className="p-8 text-center">
            <FileSignature className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
            <h2 className="font-display text-2xl">Aucun accord disponible</h2>
            <p className="mt-2 text-muted-foreground">Votre accord apparaîtra ici lorsqu’il sera envoyé par notre équipe.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {agreements.map((agreement) => {
            const finalPdfPath = agreement.content?.final_pdf?.storage_path as string | undefined;
            return (
              <Card key={agreement.id} className="rounded-2xl shadow-sm">
                <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <Badge variant={agreement.status === "accepted" ? "default" : "outline"}>{statusLabel(agreement.status)}</Badge>
                      {agreement.booking_reference && <Badge variant="secondary">{agreement.booking_reference}</Badge>}
                    </div>
                    <h2 className="truncate font-display text-xl">{agreement.trip_title || "Accord de voyage"}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Envoyé : {fmtDateTime(agreement.sent_at)} · Accepté : {fmtDateTime(agreement.accepted_at)}
                    </p>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    {agreement.secure_token && (
                      <Button asChild variant={agreement.status === "accepted" ? "outline" : "default"}>
                        <Link to={`/accord-voyage/${agreement.secure_token}`}>
                          <ShieldCheck className="h-4 w-4" />
                          {agreement.status === "accepted" ? "Relire" : "Lire et accepter"}
                        </Link>
                      </Button>
                    )}
                    {finalPdfPath && (
                      <Button variant="outline" onClick={() => downloadFinalPdf(finalPdfPath)}>
                        <Download className="h-4 w-4" />
                        PDF accepté
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function statusLabel(status?: string | null) {
  const labels: Record<string, string> = {
    draft: "Brouillon",
    sent: "Envoyé",
    opened: "Ouvert",
    accepted: "Accepté",
    declined: "Refusé",
    needs_review: "À revoir",
  };
  return labels[String(status || "")] || status || "À confirmer";
}

