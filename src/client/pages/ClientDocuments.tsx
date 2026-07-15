import { Download, FileText } from "lucide-react";
import { toast } from "sonner";
import { Seo } from "@/components/Seo";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { fmtDateTime } from "@/lib/format";
import { signedBookingDocumentUrl } from "../lib/client-portal";
import { useClientPortalData } from "../lib/useClientPortalData";

export default function ClientDocuments() {
  const { bookings, documents, loading } = useClientPortalData();

  const openDocument = async (storagePath: string) => {
    try {
      const url = await signedBookingDocumentUrl(storagePath);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error: any) {
      toast.error(error?.message ?? "Document indisponible.");
    }
  };

  return (
    <div className="space-y-5">
      <Seo title="Mes documents — LeJapon.ma" description="Documents publiés pour votre voyage LeJapon.ma." noindex />
      <div>
        <h1 className="font-display text-3xl">Mes documents</h1>
        <p className="mt-2 text-muted-foreground">Documents publiés par l’équipe LeJapon.ma pour vos réservations.</p>
      </div>

      {loading ? <p className="text-sm text-muted-foreground">Chargement…</p> : null}
      {!loading && documents.length === 0 ? (
        <Card className="rounded-2xl">
          <CardContent className="p-8 text-center">
            <FileText className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
            <h2 className="font-display text-2xl">Aucun document publié</h2>
            <p className="mt-2 text-muted-foreground">Les documents apparaîtront ici dès qu’ils seront rendus visibles par notre équipe.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {documents.map((document) => {
            const booking = bookings.find((item) => item.id === document.booking_id);
            return (
              <Card key={document.id} className="rounded-2xl shadow-sm">
                <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{categoryLabel(document.document_type || document.kind)}</Badge>
                      {booking?.reference && <Badge variant="secondary">{booking.reference}</Badge>}
                    </div>
                    <h2 className="truncate font-medium">{document.title || document.file_name || document.number || "Document"}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">{fmtDateTime(document.client_visible_at || document.created_at)}</p>
                    {document.visibility_scope === "booking_owner_only" && (
                      <p className="mt-1 text-xs text-muted-foreground">Visible uniquement par le contact principal.</p>
                    )}
                  </div>
                  <Button onClick={() => openDocument(document.storage_path)}>
                    <Download className="h-4 w-4" />
                    Télécharger
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function categoryLabel(kind?: string | null) {
  const labels: Record<string, string> = {
    quote: "Devis",
    receipt: "Reçu paiement",
    invoice: "Facture",
    payment: "Paiement",
    financial: "Document financier",
    billet_avion: "Billet avion",
    flight_ticket: "Billet avion",
    voucher_hotel: "Voucher hôtel",
    reservation_hotel_extra: "Voucher hôtel",
    hotel_voucher: "Voucher hôtel",
    reservation_activite_extra: "Activité",
    qr_code_japon: "QR code Japon",
    visa: "Visa",
    assurance: "Assurance",
    programme: "Programme",
    travel_agreement: "Accord de voyage",
    autre: "Autre",
  };
  return labels[String(kind || "")] || "Document";
}
