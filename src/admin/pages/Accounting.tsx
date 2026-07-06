import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Download, FileText, Receipt, Search } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/admin/components/PageHeader";
import { StatusBadge } from "@/admin/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fmtDateTime, fmtMAD } from "@/lib/format";
import { paymentMethodLabel } from "@/lib/payment-methods";

const db = supabase as any;

const invoiceLabel = (value: string | null | undefined) => {
  if (value === "proforma") return "Facture proforma";
  if (value === "deposit") return "Facture d'acompte";
  if (value === "final") return "Facture";
  return "Facture";
};

export default function Accounting() {
  const [payments, setPayments] = useState<any[]>([]);
  const [documents, setDocuments] = useState<any[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const [paymentResult, documentResult] = await Promise.all([
        db
          .from("payments")
          .select("id,booking_id,amount_mad,method,status,reference,paid_at,created_at,bookings:booking_id(id,reference,contact_name,total_amount_mad,paid_amount_mad,trips:trip_id(title,season,start_date))")
          .order("created_at", { ascending: false })
          .limit(500),
        db
          .from("booking_documents")
          .select("id,booking_id,kind,document_type,invoice_type,title,number,storage_path,total_mad,paid_mad,remaining_mad,payment_id,created_at,bookings:booking_id(id,reference,contact_name,total_amount_mad,paid_amount_mad,trips:trip_id(title,season,start_date))")
          .order("created_at", { ascending: false })
          .limit(500),
      ]);
      if (paymentResult.error) throw paymentResult.error;
      if (documentResult.error) throw documentResult.error;
      setPayments(paymentResult.data ?? []);
      setDocuments(documentResult.data ?? []);
    } catch (error: any) {
      toast.error(error?.message ?? "Impossible de charger la comptabilité.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const needle = query.trim().toLowerCase();
  const filterRows = (rows: any[]) => {
    if (!needle) return rows;
    return rows.filter((row) => [
      row.number,
      row.reference,
      row.bookings?.reference,
      row.bookings?.contact_name,
      row.bookings?.trips?.title,
      row.method,
      row.status,
      row.document_type,
      row.invoice_type,
    ].some((value) => String(value ?? "").toLowerCase().includes(needle)));
  };

  const quoteDocs = useMemo(() => filterRows(documents.filter((doc) => doc.kind === "quote")), [documents, needle]);
  const receiptDocs = useMemo(() => filterRows(documents.filter((doc) => doc.kind === "receipt")), [documents, needle]);
  const invoiceDocs = useMemo(() => filterRows(documents.filter((doc) => doc.kind === "invoice")), [documents, needle]);
  const paymentRows = useMemo(() => filterRows(payments), [payments, needle]);

  const openDocument = async (doc: any) => {
    const { data, error } = await supabase.storage.from("booking-docs").createSignedUrl(doc.storage_path, 60);
    if (error || !data?.signedUrl) return toast.error("PDF indisponible.");
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const totals = {
    payments: paymentRows.filter((payment) => ["received", "paid"].includes(String(payment.status))).reduce((sum, payment) => sum + Number(payment.amount_mad || 0), 0),
    quotes: quoteDocs.reduce((sum, doc) => sum + Number(doc.total_mad || 0), 0),
    invoices: invoiceDocs.reduce((sum, doc) => sum + Number(doc.total_mad || 0), 0),
    remaining: invoiceDocs.reduce((sum, doc) => sum + Number(doc.remaining_mad || Math.max(0, Number(doc.total_mad || 0) - Number(doc.paid_mad || 0))), 0),
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Comptabilité" description="Paiements, reçus, devis et factures liés aux réservations." />

      <div className="grid gap-3 md:grid-cols-4">
        <Metric title="Paiements reçus" value={fmtMAD(totals.payments)} />
        <Metric title="Devis émis" value={fmtMAD(totals.quotes)} />
        <Metric title="Factures" value={fmtMAD(totals.invoices)} />
        <Metric title="Restant facturé" value={fmtMAD(totals.remaining)} />
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="min-h-11 pl-9" placeholder="Rechercher client, réservation, voyage, numéro document..." value={query} onChange={(event) => setQuery(event.target.value)} />
      </div>

      <Tabs defaultValue="payments" className="space-y-4">
        <TabsList className="flex h-auto flex-wrap justify-start">
          <TabsTrigger value="payments">Paiements</TabsTrigger>
          <TabsTrigger value="receipts">Reçus</TabsTrigger>
          <TabsTrigger value="quotes">Devis</TabsTrigger>
          <TabsTrigger value="invoices">Factures</TabsTrigger>
        </TabsList>
        <TabsContent value="payments">
          <PaymentTable rows={paymentRows} loading={loading} />
        </TabsContent>
        <TabsContent value="receipts">
          <DocumentTable rows={receiptDocs} loading={loading} onOpen={openDocument} />
        </TabsContent>
        <TabsContent value="quotes">
          <DocumentTable rows={quoteDocs} loading={loading} onOpen={openDocument} showCreateInvoice />
        </TabsContent>
        <TabsContent value="invoices">
          <DocumentTable rows={invoiceDocs} loading={loading} onOpen={openDocument} invoiceMode />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Metric({ title, value }: { title: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{title}</p>
        <p className="mt-1 font-display text-xl">{value}</p>
      </CardContent>
    </Card>
  );
}

function PaymentTable({ rows, loading }: { rows: any[]; loading: boolean }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Paiements enregistrés</CardTitle></CardHeader>
      <CardContent className="overflow-x-auto p-0">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="bg-muted/60 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="p-3 text-left">Date</th>
              <th className="p-3 text-left">Client</th>
              <th className="p-3 text-left">Réservation</th>
              <th className="p-3 text-left">Voyage</th>
              <th className="p-3 text-right">Montant</th>
              <th className="p-3 text-left">Mode</th>
              <th className="p-3 text-left">Statut</th>
              <th className="p-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading && <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">Chargement...</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">Aucun paiement.</td></tr>}
            {rows.map((payment) => (
              <tr key={payment.id}>
                <td className="p-3">{fmtDateTime(payment.paid_at || payment.created_at)}</td>
                <td className="p-3">{payment.bookings?.contact_name || "—"}</td>
                <td className="p-3">{payment.bookings?.reference || "—"}</td>
                <td className="p-3">{payment.bookings?.trips?.title || "—"}</td>
                <td className="p-3 text-right font-medium">{fmtMAD(payment.amount_mad)}</td>
                <td className="p-3">{paymentMethodLabel(payment.method)}</td>
                <td className="p-3"><StatusBadge value={payment.status} /></td>
                <td className="p-3 text-right"><Button asChild size="sm" variant="outline"><Link to={`/admin/bookings/${payment.booking_id}`}>Voir</Link></Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function DocumentTable({ rows, loading, onOpen, showCreateInvoice = false, invoiceMode = false }: { rows: any[]; loading: boolean; onOpen: (doc: any) => void; showCreateInvoice?: boolean; invoiceMode?: boolean }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{invoiceMode ? "Factures" : showCreateInvoice ? "Devis émis" : "Documents"}</CardTitle></CardHeader>
      <CardContent className="overflow-x-auto p-0">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-muted/60 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="p-3 text-left">Numéro</th>
              <th className="p-3 text-left">Type</th>
              <th className="p-3 text-left">Client</th>
              <th className="p-3 text-left">Voyage</th>
              <th className="p-3 text-right">Total</th>
              <th className="p-3 text-right">Payé</th>
              <th className="p-3 text-right">Reste</th>
              <th className="p-3 text-left">Date</th>
              <th className="p-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading && <tr><td colSpan={9} className="p-6 text-center text-muted-foreground">Chargement...</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={9} className="p-6 text-center text-muted-foreground">Aucun document.</td></tr>}
            {rows.map((doc) => {
              const remaining = Number(doc.remaining_mad ?? Math.max(0, Number(doc.total_mad || 0) - Number(doc.paid_mad || 0)));
              return (
                <tr key={doc.id}>
                  <td className="p-3 font-medium">{doc.number || "—"}</td>
                  <td className="p-3">{doc.kind === "invoice" ? invoiceLabel(doc.invoice_type || doc.document_type) : doc.title || doc.document_type || doc.kind}</td>
                  <td className="p-3">{doc.bookings?.contact_name || "—"}</td>
                  <td className="p-3">{doc.bookings?.trips?.title || "—"}</td>
                  <td className="p-3 text-right">{fmtMAD(doc.total_mad)}</td>
                  <td className="p-3 text-right">{fmtMAD(doc.paid_mad)}</td>
                  <td className="p-3 text-right">{fmtMAD(remaining)}</td>
                  <td className="p-3">{fmtDateTime(doc.created_at)}</td>
                  <td className="p-3">
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="outline" onClick={() => onOpen(doc)}><Download className="h-4 w-4" /></Button>
                      <Button asChild size="sm" variant="outline"><Link to={`/admin/bookings/${doc.booking_id}`}><FileText className="h-4 w-4" /></Link></Button>
                      {showCreateInvoice && <Button asChild size="sm"><Link to={`/admin/bookings/${doc.booking_id}`}><Receipt className="h-4 w-4" /> Facture</Link></Button>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
