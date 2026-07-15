import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  loadClientAgreements,
  loadClientBookings,
  loadClientDocuments,
  type ClientAgreement,
  type ClientBooking,
  type ClientBookingDocument,
} from "./client-portal";

export function useClientPortalData() {
  const [bookings, setBookings] = useState<ClientBooking[]>([]);
  const [documents, setDocuments] = useState<ClientBookingDocument[]>([]);
  const [agreements, setAgreements] = useState<ClientAgreement[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const bookingRows = await loadClientBookings();
      const bookingIds = bookingRows.map((booking) => booking.id);
      const [documentRows, agreementRows] = await Promise.all([
        loadClientDocuments(bookingIds).catch((error) => {
          console.warn("[client-portal] documents unavailable", error);
          return [] as ClientBookingDocument[];
        }),
        loadClientAgreements(bookingIds).catch((error) => {
          console.warn("[client-portal] agreements unavailable", error);
          return [] as ClientAgreement[];
        }),
      ]);
      setBookings(bookingRows);
      setDocuments(documentRows);
      setAgreements(agreementRows);
    } catch (error: any) {
      toast.error(error?.message ?? "Impossible de charger votre espace voyage.");
      setBookings([]);
      setDocuments([]);
      setAgreements([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const upcomingBooking = useMemo(() => {
    const now = new Date();
    return [...bookings].sort((a, b) => {
      const ad = a.trips?.start_date ? new Date(a.trips.start_date).getTime() : Number.MAX_SAFE_INTEGER;
      const bd = b.trips?.start_date ? new Date(b.trips.start_date).getTime() : Number.MAX_SAFE_INTEGER;
      const aFuture = ad >= now.getTime();
      const bFuture = bd >= now.getTime();
      if (aFuture !== bFuture) return aFuture ? -1 : 1;
      return ad - bd;
    })[0] ?? null;
  }, [bookings]);

  return { bookings, documents, agreements, upcomingBooking, loading, refresh };
}

