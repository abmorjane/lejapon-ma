export const FIT_COMMERCIAL_LABELS: Record<string, string> = {
  draft: "Brouillon",
  ready: "Prêt",
  sent: "Envoyé au client",
  sent_to_client: "Envoyé au client",
  viewed: "Consulté",
  revision_requested: "Modification demandée",
  client_modification_requested: "Modification demandée",
  accepted: "Accepté",
  deposit_pending: "Acompte attendu",
  deposit_paid: "Acompte reçu",
  converted_to_booking: "Réservation créée",
  lost: "Perdu",
  rejected: "Refusé",
  expired: "Expiré",
  cancelled: "Annulé",
};

export function fitCommercialStatus(quote: any): string {
  return String(quote?.commercial_status || quote?.status || "draft");
}

export function fitCommercialLabel(quoteOrStatus: any): string {
  const status = typeof quoteOrStatus === "string" ? quoteOrStatus : fitCommercialStatus(quoteOrStatus);
  return FIT_COMMERCIAL_LABELS[status] || status;
}

export function fitNextAction(quote: any): string {
  if (quote?.converted_booking_id || fitCommercialStatus(quote) === "converted_to_booking") return "Ouvrir la réservation";
  const status = fitCommercialStatus(quote);
  if (status === "draft") return "Finaliser le devis";
  if (status === "ready") return "Envoyer au client";
  if (status === "sent") return "Attendre la consultation client";
  if (status === "viewed") return "Attendre la décision client";
  if (status === "revision_requested") return `Créer V${Number(quote?.version_number || 1) + 1}`;
  if (status === "accepted") return "Demander l’acompte";
  if (status === "deposit_pending") return "Confirmer le paiement";
  if (status === "deposit_paid") return "Créer la réservation";
  return "Aucune action requise";
}

export function fitCommercialTone(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (["accepted", "deposit_paid", "converted_to_booking"].includes(status)) return "default";
  if (["lost", "expired", "cancelled"].includes(status)) return "destructive";
  if (["viewed", "revision_requested", "deposit_pending"].includes(status)) return "secondary";
  return "outline";
}
