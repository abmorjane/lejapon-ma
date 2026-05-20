import { useEffect, useState } from "react";
import { RefreshCcw, Send, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/admin/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { fmtDate } from "@/lib/format";

type EmailLog = {
  id: string;
  event_type: string;
  recipient: string;
  subject?: string | null;
  status: "pending" | "sent" | "failed";
  error_message?: string | null;
  created_at: string;
  sent_at?: string | null;
  related_booking_id?: string | null;
  related_payment_id?: string | null;
  related_contact_id?: string | null;
};

const statusVariant = (status: EmailLog["status"]) => {
  if (status === "sent") return "default";
  if (status === "failed") return "destructive";
  return "secondary";
};

const eventLabel = (event: string) => ({
  booking_internal: "Inscription voyage interne",
  booking_client: "Confirmation client voyage",
  booking_created: "Inscription voyage",
  payment_recorded: "Paiement",
  contact_internal: "Contact interne",
  contact_client: "Confirmation client contact",
  contact_message: "Contact",
  test: "Test",
  test_email: "Test",
}[event] ?? event);

const isDev = import.meta.env.DEV;

async function readFunctionError(error: any) {
  const context = error?.context;
  if (context && typeof context.json === "function") {
    try {
      return {
        status: context.status,
        statusText: context.statusText,
        body: await context.json(),
      };
    } catch {
      return {
        status: context.status,
        statusText: context.statusText,
        body: null,
      };
    }
  }
  return null;
}

function formatBackendError(data: any, fallback?: string) {
  const body = data?.body ?? data;
  const code = body?.error || body?.code || fallback;
  const detail = body?.detail || body?.message || fallback;
  const status = data?.status ? `HTTP ${data.status}` : null;
  return [status, code, detail && detail !== code ? detail : null].filter(Boolean).join(" — ");
}

export default function EmailLogs() {
  const [rows, setRows] = useState<EmailLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("email_logs" as any)
      .select("id,event_type,recipient,subject,status,error_message,created_at,sent_at,related_booking_id,related_payment_id,related_contact_id")
      .order("created_at", { ascending: false })
      .limit(100);
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setRows((data ?? []) as EmailLog[]);
  };

  useEffect(() => { load(); }, []);

  const sendTest = async () => {
    setTesting(true);
    const requestPayload = { type: "test", payload: {} };
    if (isDev) {
      console.info("[admin-email] invoke", { function: "send-admin-notification", payload: requestPayload });
    }
    const { data, error } = await supabase.functions.invoke("send-admin-notification", {
      body: requestPayload,
    });
    setTesting(false);
    if (isDev) {
      console.info("[admin-email] invoke response", { function: "send-admin-notification", data, error });
    }
    if (error || data?.ok === false) {
      const backendError = error ? await readFunctionError(error) : null;
      if (isDev && backendError) {
        console.warn("[admin-email] invoke failed", {
          function: "send-admin-notification",
          status: backendError.status,
          response: backendError.body,
        });
      }
      toast.error(formatBackendError(backendError ?? data, error?.message) || "Échec de l'email test");
    } else {
      toast.success("Email test envoyé");
    }
    load();
  };

  const resend = async (id: string) => {
    setBusyId(id);
    const requestPayload = { type: "resend", payload: { log_id: id } };
    if (isDev) {
      console.info("[admin-email] invoke", { function: "send-admin-notification", payload: requestPayload });
    }
    const { data, error } = await supabase.functions.invoke("send-admin-notification", {
      body: requestPayload,
    });
    setBusyId(null);
    if (isDev) {
      console.info("[admin-email] invoke response", { function: "send-admin-notification", data, error });
    }
    if (error || data?.ok === false) {
      const backendError = error ? await readFunctionError(error) : null;
      toast.error(formatBackendError(backendError ?? data, error?.message) || "Réenvoi impossible");
    } else {
      toast.success("Email renvoyé");
    }
    load();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Email Logs"
        description="Suivi des notifications internes envoyées à info@lejapon.ma."
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={load} disabled={loading}>
              <RefreshCcw className="h-4 w-4" /> Actualiser
            </Button>
            <Button onClick={sendTest} disabled={testing}>
              {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Send test email
            </Button>
          </div>
        }
      />

      <div className="overflow-hidden rounded-2xl border border-border bg-background">
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-sm">
            <thead className="bg-secondary/50 text-left">
              <tr>
                <th className="p-4">Date</th>
                <th className="p-4">Événement</th>
                <th className="p-4">Sujet</th>
                <th className="p-4">Statut</th>
                <th className="p-4">Erreur</th>
                <th className="p-4"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading && <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">Chargement…</td></tr>}
              {!loading && rows.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">Aucune tentative email.</td></tr>}
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="p-4 text-xs text-muted-foreground">{fmtDate(row.created_at)}</td>
                  <td className="p-4">{eventLabel(row.event_type)}<br /><span className="text-xs text-muted-foreground">{row.recipient}</span></td>
                  <td className="p-4 max-w-xs truncate">{row.subject || "—"}</td>
                  <td className="p-4"><Badge variant={statusVariant(row.status) as any}>{row.status}</Badge></td>
                  <td className="p-4 max-w-sm text-xs text-destructive">{row.error_message || "—"}</td>
                  <td className="p-4 text-right">
                    <Button size="sm" variant="outline" onClick={() => resend(row.id)} disabled={busyId === row.id}>
                      {busyId === row.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
                      Resend
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="space-y-3 p-3 md:hidden">
          {loading && <p className="p-6 text-center text-sm text-muted-foreground">Chargement…</p>}
          {!loading && rows.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">Aucune tentative email.</p>}
          {rows.map((row) => (
            <div key={row.id} className="rounded-xl border border-border p-4">
              <div className="mb-2 flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{eventLabel(row.event_type)}</p>
                  <p className="text-xs text-muted-foreground">{fmtDate(row.created_at)}</p>
                </div>
                <Badge variant={statusVariant(row.status) as any}>{row.status}</Badge>
              </div>
              <p className="text-sm">{row.subject || "—"}</p>
              <p className="mt-1 text-xs text-muted-foreground">{row.recipient}</p>
              {row.error_message && <p className="mt-2 text-xs text-destructive">{row.error_message}</p>}
              <Button className="mt-3 h-10 w-full" size="sm" variant="outline" onClick={() => resend(row.id)} disabled={busyId === row.id}>
                {busyId === row.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
                Resend
              </Button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
