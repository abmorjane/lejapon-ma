export const BOOKING_STATUS_LABELS: Record<string, string> = {
  lead: "Prospect",
  confirmed: "Confirmée",
  paid: "Payée",
  cancelled: "Annulée",
  completed: "Terminée",
};

export const bookingStatusLabel = (status?: string | null) =>
  BOOKING_STATUS_LABELS[String(status ?? "")] ?? String(status ?? "Statut inconnu");
