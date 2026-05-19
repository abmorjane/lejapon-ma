import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type EventType = "booking_created" | "payment_recorded";

const escapeHtml = (value: unknown) =>
  String(value ?? "—")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const fmtMAD = (value: unknown) =>
  `${Number(value || 0).toLocaleString("fr-FR", { maximumFractionDigits: 0 })} MAD`;

const fmtDate = (value: unknown) => {
  if (!value) return "—";
  try {
    return new Date(String(value)).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return String(value);
  }
};

function adminBaseUrl() {
  return (Deno.env.get("ADMIN_BASE_URL") || Deno.env.get("SITE_URL") || "https://lejapon.ma").replace(/\/$/, "");
}

function smtpConfig() {
  const hostname = Deno.env.get("SMTP_HOST");
  const port = Number(Deno.env.get("SMTP_PORT") || 465);
  const username = Deno.env.get("SMTP_USER");
  const password = Deno.env.get("SMTP_PASS");
  const from = Deno.env.get("SMTP_FROM");

  if (!hostname || !username || !password || !from) {
    throw new Error("SMTP environment variables are not configured");
  }

  return {
    connection: {
      hostname,
      port,
      tls: port === 465,
      auth: { username, password },
    },
    from,
  };
}

async function logEmail(admin: ReturnType<typeof createClient>, event_type: string, recipient: string, status: "sent" | "failed", error_message?: string, metadata: Record<string, unknown> = {}) {
  const { error } = await admin.from("admin_email_logs").insert({
    event_type,
    recipient,
    status,
    error_message: error_message ?? null,
    metadata,
  });
  if (error) console.error("admin email log failed", error);
}

function emailShell(title: string, intro: string, rows: Array<[string, unknown]>, adminUrl?: string) {
  const tableRows = rows.map(([label, value]) => `
    <tr>
      <td style="padding:10px 0;color:#6b625c;width:170px;border-bottom:1px solid #eee">${escapeHtml(label)}</td>
      <td style="padding:10px 0;border-bottom:1px solid #eee"><strong>${escapeHtml(value)}</strong></td>
    </tr>
  `).join("");

  return `
    <div style="font-family:Arial,sans-serif;color:#171412;max-width:640px;margin:0 auto;background:#ffffff">
      <div style="border-bottom:3px solid #f28c28;padding:20px 0 14px">
        <p style="margin:0 0 6px;color:#8a8178;font-size:12px;letter-spacing:.14em;text-transform:uppercase">LeJapon.ma</p>
        <h1 style="margin:0;font-size:22px;line-height:1.3">${escapeHtml(title)}</h1>
        <p style="margin:8px 0 0;color:#4b4642">Moroccan Express Travel and Events</p>
      </div>
      <p style="font-size:15px;line-height:1.6;margin:20px 0">${escapeHtml(intro)}</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">${tableRows}</table>
      ${adminUrl ? `<p style="margin:26px 0"><a href="${escapeHtml(adminUrl)}" style="display:inline-block;background:#171412;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:bold">Ouvrir dans l'admin</a></p>` : ""}
      <p style="margin-top:28px;color:#8a8178;font-size:12px">Email interne automatique. Ne pas transférer au client.</p>
    </div>
  `;
}

async function bookingEmail(admin: ReturnType<typeof createClient>, bookingId: string) {
  const { data: booking, error } = await admin
    .from("bookings")
    .select("*, trips(title, season, start_date, end_date)")
    .eq("id", bookingId)
    .maybeSingle();
  if (error || !booking) throw new Error(error?.message ?? "Booking not found");

  const { data: extras } = await admin
    .from("booking_extras")
    .select("name_snapshot, qty, unit_price_mad")
    .eq("booking_id", bookingId);

  const trip = booking.trips;
  const tripLabel = [trip?.season, trip?.title].filter(Boolean).join(" — ") || "—";
  const dateLabel = booking.preferred_dates || [trip?.start_date, trip?.end_date].filter(Boolean).join(" → ") || "—";
  const extrasLabel = (extras ?? []).length
    ? (extras ?? []).map((e: any) => `${e.name_snapshot} × ${e.qty} (${fmtMAD(Number(e.unit_price_mad || 0) * Number(e.qty || 1))})`).join(", ")
    : "—";
  const adminUrl = `${adminBaseUrl()}/admin/bookings/${booking.id}`;

  return {
    subject: `Nouvelle inscription voyage – ${booking.contact_name}`,
    html: emailShell(
      "Nouvelle inscription voyage",
      "Une nouvelle demande d'inscription voyage vient d'etre soumise sur la plateforme.",
      [
        ["Nom client", booking.contact_name],
        ["Email", booking.contact_email],
        ["Téléphone", booking.contact_phone],
        ["Voyage choisi", tripLabel],
        ["Dates", dateLabel],
        ["Nombre de voyageurs", `${booking.num_adults || 0} adulte(s), ${booking.num_children || 0} enfant(s)`],
        ["Formule / hôtel", booking.formula],
        ["Chambre", booking.room_type],
        ["Activités extras", extrasLabel],
        ["Montant total", fmtMAD(booking.total_amount_mad)],
        ["Montant payé", fmtMAD(booking.paid_amount_mad)],
      ],
      adminUrl,
    ),
    text: `Nouvelle inscription voyage\n\nClient: ${booking.contact_name}\nEmail: ${booking.contact_email}\nTéléphone: ${booking.contact_phone ?? "—"}\nVoyage: ${tripLabel}\nDates: ${dateLabel}\nVoyageurs: ${booking.num_adults || 0} adulte(s), ${booking.num_children || 0} enfant(s)\nFormule/hôtel: ${booking.formula ?? "—"}\nChambre: ${booking.room_type ?? "—"}\nExtras: ${extrasLabel}\nTotal: ${fmtMAD(booking.total_amount_mad)}\nPayé: ${fmtMAD(booking.paid_amount_mad)}\nAdmin: ${adminUrl}`,
    metadata: { booking_id: booking.id, reference: booking.reference },
  };
}

async function paymentEmail(admin: ReturnType<typeof createClient>, paymentId: string) {
  const { data: payment, error } = await admin
    .from("payments")
    .select("*")
    .eq("id", paymentId)
    .maybeSingle();
  if (error || !payment) throw new Error(error?.message ?? "Payment not found");

  const { data: booking, error: bookingError } = await admin
    .from("bookings")
    .select("*, trips(title, season)")
    .eq("id", payment.booking_id)
    .maybeSingle();
  if (bookingError || !booking) throw new Error(bookingError?.message ?? "Booking not found");

  const tripLabel = [booking.trips?.season, booking.trips?.title].filter(Boolean).join(" — ") || "—";
  const rest = Math.max(0, Number(booking.total_amount_mad || 0) - Number(booking.paid_amount_mad || 0));
  const adminUrl = `${adminBaseUrl()}/admin/bookings/${booking.id}`;

  return {
    subject: `Paiement enregistré – ${booking.contact_name} – ${fmtMAD(payment.amount_mad)}`,
    html: emailShell(
      "Paiement enregistré",
      "Un paiement vient d'etre ajoute ou valide dans l'admin.",
      [
        ["Nom client", booking.contact_name],
        ["Réservation", booking.reference],
        ["Voyage", tripLabel],
        ["Montant payé", fmtMAD(payment.amount_mad)],
        ["Mode de paiement", payment.method],
        ["Date du paiement", fmtDate(payment.paid_at || payment.created_at)],
        ["Reste à payer", fmtMAD(rest)],
      ],
      adminUrl,
    ),
    text: `Paiement enregistré\n\nClient: ${booking.contact_name}\nRéservation: ${booking.reference}\nVoyage: ${tripLabel}\nMontant: ${fmtMAD(payment.amount_mad)}\nMode: ${payment.method ?? "—"}\nDate: ${fmtDate(payment.paid_at || payment.created_at)}\nReste à payer: ${fmtMAD(rest)}\nAdmin: ${adminUrl}`,
    metadata: { payment_id: payment.id, booking_id: booking.id, reference: booking.reference },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const recipient = Deno.env.get("ADMIN_NOTIFICATION_EMAIL") || "info@lejapon.ma";
  let eventType = "unknown";
  let metadata: Record<string, unknown> = {};

  try {
    const body = await req.json();
    eventType = String(body.event_type ?? "");

    if (!["booking_created", "payment_recorded"].includes(eventType)) {
      return new Response(JSON.stringify({ error: "unsupported_event_type" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payload = eventType === "booking_created"
      ? await bookingEmail(admin, String(body.booking_id ?? ""))
      : await paymentEmail(admin, String(body.payment_id ?? ""));
    metadata = payload.metadata;

    const smtp = smtpConfig();
    const client = new SMTPClient({ connection: smtp.connection });

    await client.send({
      from: `LeJapon.ma / Moroccan Express <${smtp.from}>`,
      to: recipient,
      subject: payload.subject,
      html: payload.html,
      content: payload.text,
    });
    await client.close();

    await logEmail(admin, eventType, recipient, "sent", undefined, metadata);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("send-admin-notification error", error);
    await logEmail(admin, eventType, recipient, "failed", message, metadata);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
