export type ClientBookingRelationship = "responsable" | "voyageur";

export type ClientBookingRelation = Record<string, any> & {
  crm_relationship: ClientBookingRelationship;
};

export function mergeClientBookingRelations(
  ownerBookings: any[] = [],
  participantBookings: any[] = [],
): ClientBookingRelation[] {
  const merged = new Map<string, ClientBookingRelation>();

  ownerBookings.forEach((booking) => {
    if (!booking?.id) return;
    merged.set(booking.id, { ...booking, crm_relationship: "responsable" });
  });

  participantBookings.forEach((booking) => {
    if (!booking?.id || merged.has(booking.id)) return;
    merged.set(booking.id, { ...booking, crm_relationship: "voyageur" });
  });

  return Array.from(merged.values()).sort((left, right) =>
    String(right.created_at ?? "").localeCompare(String(left.created_at ?? ""))
  );
}
