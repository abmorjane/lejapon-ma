export type TripArchiveView = "active" | "archived";

export type ArchivableTrip = {
  archived_at?: string | null;
};

export const isTripArchived = (trip: ArchivableTrip) => Boolean(trip.archived_at);

export const tripsForArchiveView = <T extends ArchivableTrip>(
  trips: T[],
  view: TripArchiveView,
) => trips.filter((trip) => isTripArchived(trip) === (view === "archived"));

export const isLinkedToArchivedTrip = (value: unknown): boolean => {
  if (!value || typeof value !== "object") return false;
  const relation = value as { archived_at?: unknown };
  return typeof relation.archived_at === "string" && relation.archived_at.length > 0;
};
