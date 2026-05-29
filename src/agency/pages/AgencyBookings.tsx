import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, Loader2, Search } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { fmtDateTime, fmtMAD } from "@/lib/format";
import { useAgencyContext } from "../useAgencyContext";
import type { AgencyBooking } from "../agencyTypes";
import { AgencyStatusBadge } from "../components/AgencyStatusBadge";

type DbClient = { from: (table: string) => any };
const db = supabase as unknown as DbClient;

const PAGE_SIZE = 20;
const bookingColumns = "id,reference,contact_name,contact_email,contact_phone,status,total_amount_mad,paid_amount_mad,created_at,preferred_dates,trip_id,agency_organization_id";

export default function AgencyBookings() {
  const { organization } = useAgencyContext();
  const [rows, setRows] = useState<AgencyBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);

  const load = async () => {
    if (!organization) return;
    setLoading(true);
    setError(null);

    let query = db
      .from("bookings")
      .select(bookingColumns, { count: "exact" })
      .eq("agency_organization_id", organization.id)
      .order("created_at", { ascending: false })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

    if (status !== "all") query = query.eq("status", status);
    const needle = search.trim();
    if (needle) {
      query = query.or(`reference.ilike.%${needle}%,contact_name.ilike.%${needle}%,contact_email.ilike.%${needle}%`);
    }

    const { data, error, count } = await query;
    if (error) {
      setError(error.message);
      setRows([]);
      setTotal(0);
    } else {
      setRows((data ?? []) as AgencyBooking[]);
      setTotal(count ?? 0);
    }
    setLoading(false);
  };

  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [organization?.id, page, search, status]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl">Réservations</h1>
        <p className="mt-1 text-sm text-muted-foreground">Réservations attribuées à {organization?.display_name}</p>
      </div>

      <Card className="p-4">
        <div className="grid gap-3 md:grid-cols-[1fr_190px]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => { setPage(0); setSearch(event.target.value); }}
              placeholder="Référence, nom ou email"
              className="min-h-11 pl-9"
            />
          </div>
          <Select value={status} onValueChange={(value) => { setPage(0); setStatus(value); }}>
            <SelectTrigger className="min-h-11">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous statuts</SelectItem>
              <SelectItem value="lead">Lead</SelectItem>
              <SelectItem value="confirmed">Confirmé</SelectItem>
              <SelectItem value="paid">Payé</SelectItem>
              <SelectItem value="cancelled">Annulé</SelectItem>
              <SelectItem value="completed">Terminé</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">{total} réservation(s) attribuée(s) · lecture seule</p>
      </Card>

      {error && (
        <Card className="border-amber-200 bg-amber-50 p-4 text-amber-950">
          {error}
        </Card>
      )}

      <Card className="overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center gap-2 p-12 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Chargement…
          </div>
        ) : rows.length === 0 ? (
          <p className="p-12 text-center text-sm text-muted-foreground">Aucune réservation attribuée.</p>
        ) : (
          <>
            <div className="hidden md:block">
              <table className="w-full text-sm">
                <thead className="bg-secondary/55">
                  <tr className="text-left">
                    <th className="p-4 font-semibold">Référence</th>
                    <th className="p-4 font-semibold">Client</th>
                    <th className="p-4 font-semibold">Total</th>
                    <th className="p-4 font-semibold">Payé</th>
                    <th className="p-4 font-semibold">Statut</th>
                    <th className="p-4 font-semibold">Créée le</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((booking) => (
                    <tr key={booking.id} className="hover:bg-secondary/30">
                      <td className="p-4">
                        <Link to={`/agency/bookings/${booking.id}`} className="font-semibold text-accent">{booking.reference}</Link>
                      </td>
                      <td className="p-4">
                        <p className="font-medium">{booking.contact_name}</p>
                        <p className="text-xs text-muted-foreground">{booking.contact_email}</p>
                      </td>
                      <td className="p-4">{fmtMAD(booking.total_amount_mad)}</td>
                      <td className="p-4">{fmtMAD(booking.paid_amount_mad)}</td>
                      <td className="p-4"><AgencyStatusBadge value={booking.status} /></td>
                      <td className="p-4 text-xs text-muted-foreground">{fmtDateTime(booking.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="divide-y md:hidden">
              {rows.map((booking) => (
                <Link key={booking.id} to={`/agency/bookings/${booking.id}`} className="block space-y-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-accent">{booking.reference}</p>
                      <p className="text-sm font-medium">{booking.contact_name}</p>
                      <p className="text-xs text-muted-foreground">{booking.contact_email}</p>
                    </div>
                    <AgencyStatusBadge value={booking.status} />
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div><p className="text-xs text-muted-foreground">Total</p><p className="font-medium">{fmtMAD(booking.total_amount_mad)}</p></div>
                    <div><p className="text-xs text-muted-foreground">Payé</p><p className="font-medium">{fmtMAD(booking.paid_amount_mad)}</p></div>
                  </div>
                </Link>
              ))}
            </div>
          </>
        )}
      </Card>

      <div className="flex items-center justify-between">
        <Button variant="outline" disabled={page === 0 || loading} onClick={() => setPage((current) => Math.max(0, current - 1))}>
          <ChevronLeft className="h-4 w-4" />
          Précédent
        </Button>
        <p className="text-sm text-muted-foreground">Page {page + 1} / {totalPages}</p>
        <Button variant="outline" disabled={page + 1 >= totalPages || loading} onClick={() => setPage((current) => current + 1)}>
          Suivant
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
