import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type EventType =
  | "contact_internal"
  | "contact_client"
  | "booking_internal"
  | "booking_client"
  | "booking_created"
  | "payment_recorded"
  | "contact_message"
  | "test"
  | "test_email"
  | "resend_log"
  | "unknown";
type LogStatus = "pending" | "sent" | "failed";

type EmailPayload = {
  eventType: EventType;
  recipient: string;
  subject: string;
  html: string;
  text: string;
  related_booking_id?: string | null;
  related_payment_id?: string | null;
  related_contact_id?: string | null;
  metadata?: Record<string, unknown>;
  replyTo?: string;
};

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

function mailto(email: unknown, subject?: string) {
  const address = String(email ?? "").trim();
  const query = subject ? `?subject=${encodeURIComponent(subject)}` : "";
  return `mailto:${encodeURIComponent(address)}${query}`;
}

function plain(value: unknown) {
  return String(value ?? "—");
}

function adminBaseUrl() {
  return (Deno.env.get("ADMIN_BASE_URL") || Deno.env.get("SITE_URL") || "https://lejapon.ma").replace(/\/$/, "");
}

function adminRecipient() {
  return Deno.env.get("ADMIN_NOTIFICATION_EMAIL") || "info@lejapon.ma";
}

function normalizeEmail(value: unknown) {
  const email = String(value ?? "").trim().toLowerCase();
  return email === "info@japon.ma" ? "info@lejapon.ma" : email;
}

function normalizeHostname(value: unknown) {
  return String(value ?? "")
    .trim()
    .replace(/^smtp:\/\//i, "")
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .trim()
    .toLowerCase();
}

async function smtpConfig(admin: any) {
  const { data: settings, error } = await admin
    .from("email_settings")
    .select("smtp_host,smtp_port,smtp_secure,smtp_username,smtp_password,from_email,from_name,reply_to,is_active")
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`SMTP settings read failed: ${error.message}`);

  const config = settings
    ? {
      source: "email_settings",
      hostname: normalizeHostname(settings.smtp_host),
      port: Number(settings.smtp_port) || 465,
      secure: String(settings.smtp_secure || "ssl"),
      username: normalizeEmail(settings.smtp_username),
      password: String(settings.smtp_password ?? ""),
      from: normalizeEmail(settings.from_email),
      fromName: String(settings.from_name || "LeJapon.ma / Moroccan Express").trim(),
      replyTo: normalizeEmail(settings.reply_to) || undefined,
    }
    : {
      source: "edge_secrets",
      hostname: normalizeHostname(Deno.env.get("SMTP_HOST")),
      port: Number(Deno.env.get("SMTP_PORT") || 465),
      secure: Number(Deno.env.get("SMTP_PORT") || 465) === 465 ? "ssl" : "starttls",
      username: normalizeEmail(Deno.env.get("SMTP_USER")),
      password: String(Deno.env.get("SMTP_PASS") ?? ""),
      from: normalizeEmail(Deno.env.get("SMTP_FROM")),
      fromName: "LeJapon.ma / Moroccan Express",
      replyTo: undefined,
    };

  const missing = [
    ["SMTP_HOST", config.hostname],
    ["SMTP_USER", config.username],
    ["SMTP_PASS", config.password],
    ["SMTP_FROM", config.from],
  ].filter(([, value]) => !value).map(([key]) => key);

  if (missing.length) {
    throw new Error(`Missing SMTP settings: ${missing.join(", ")}. Configure Admin > Paramètres email or Supabase Edge Function secrets.`);
  }

  console.info("[admin-email] SMTP config", {
    source: config.source,
    SMTP_HOST: config.hostname,
    SMTP_PORT: config.port,
    SMTP_FROM: config.from,
    SMTP_USER: config.username,
    SMTP_SECURE: config.secure,
  });

  return {
    connection: {
      hostname: config.hostname,
      port: config.port,
      tls: config.secure === "ssl",
      auth: { username: config.username, password: config.password },
    },
    from: config.from,
    fromName: config.fromName,
    replyTo: config.replyTo,
  };
}

type EmailAction = {
  label: string;
  href: string;
};

function emailShell(
  title: string,
  intro: string,
  rows: Array<[string, unknown]>,
  action?: EmailAction,
  footer = "Notification automatique — Lejapon.ma",
) {
  const introHtml = escapeHtml(intro).replace(/\n/g, "<br>");
  const tableRows = rows.map(([label, value]) => `
    <tr>
      <td style="padding:12px 0;color:#6b625c;width:170px;border-bottom:1px solid #eeeeee;vertical-align:top">${escapeHtml(label)}</td>
      <td style="padding:12px 0;border-bottom:1px solid #eeeeee;vertical-align:top"><strong>${escapeHtml(value)}</strong></td>
    </tr>
  `).join("");

  return `
    <div style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,Helvetica,sans-serif;color:#171412">
      <div style="max-width:680px;margin:0 auto;padding:28px 14px">
        <div style="padding:0 0 16px;text-align:center">
          <div style="font-size:24px;font-weight:700;color:#E21B2D;letter-spacing:.02em">Lejapon.ma</div>
          <div style="margin-top:4px;font-size:12px;color:#766f68">Moroccan Express Travel and Events</div>
        </div>
        <div style="background:#ffffff;border-radius:14px;border:1px solid #e8e4e1;padding:26px;box-shadow:0 6px 24px rgba(0,0,0,.05)">
          <div style="border-bottom:3px solid #E21B2D;padding-bottom:14px;margin-bottom:20px">
            <h1 style="margin:0;font-size:22px;line-height:1.3;color:#171412">${escapeHtml(title)}</h1>
          </div>
          <p style="font-size:15px;line-height:1.7;margin:0 0 20px;color:#3a3531">${introHtml}</p>
          <table role="presentation" style="width:100%;border-collapse:collapse;font-size:14px">${tableRows}</table>
          ${action ? `<p style="margin:26px 0 0"><a href="${escapeHtml(action.href)}" style="display:inline-block;background:#E21B2D;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:bold">${escapeHtml(action.label)}</a></p>` : ""}
        </div>
        <p style="margin:18px 0 0;text-align:center;color:#8a8178;font-size:12px">${escapeHtml(footer)}</p>
      </div>
    </div>
  `;
}

async function createLog(
  admin: any,
  payload: Pick<EmailPayload, "eventType" | "recipient"> & Partial<EmailPayload>,
  status: LogStatus = "pending",
  errorMessage?: string,
) {
  const { data, error } = await admin
    .from("email_logs")
    .insert({
      event_type: payload.eventType,
      recipient: payload.recipient,
      subject: payload.subject ?? null,
      status,
      error_message: errorMessage ?? null,
      metadata: payload.metadata ?? {},
      sent_at: status === "sent" ? new Date().toISOString() : null,
      related_booking_id: payload.related_booking_id ?? null,
      related_payment_id: payload.related_payment_id ?? null,
      related_contact_id: payload.related_contact_id ?? null,
    })
    .select("id")
    .single();
  if (error) console.error("[admin-email] log insert failed", error);
  return data?.id as string | undefined;
}

async function updateLogDetails(admin: any, id: string | undefined, payload: EmailPayload) {
  if (!id) return;
  const { error } = await admin
    .from("email_logs")
    .update({
      event_type: payload.eventType,
      recipient: payload.recipient,
      subject: payload.subject,
      metadata: payload.metadata ?? {},
      related_booking_id: payload.related_booking_id ?? null,
      related_payment_id: payload.related_payment_id ?? null,
      related_contact_id: payload.related_contact_id ?? null,
    })
    .eq("id", id);
  if (error) console.error("[admin-email] log detail update failed", error);
}

async function updateLog(admin: any, id: string | undefined, status: LogStatus, errorMessage?: string) {
  if (!id) return;
  const { error } = await admin
    .from("email_logs")
    .update({
      status,
      error_message: errorMessage ?? null,
      sent_at: status === "sent" ? new Date().toISOString() : null,
    })
    .eq("id", id);
  if (error) console.error("[admin-email] log update failed", error);
}

async function sendEmail(admin: any, payload: EmailPayload, existingLogId?: string) {
  const logId = existingLogId ?? await createLog(admin, payload, "pending");
  if (existingLogId) await updateLogDetails(admin, existingLogId, payload);
  try {
    console.info("[admin-email] sending", { eventType: payload.eventType, recipient: payload.recipient, subject: payload.subject });
    const smtp = await smtpConfig(admin);
    const client = new SMTPClient({ connection: smtp.connection });
    await client.send({
      from: `${smtp.fromName} <${smtp.from}>`,
      to: payload.recipient,
      replyTo: payload.replyTo || smtp.replyTo,
      subject: payload.subject,
      html: payload.html,
      content: payload.text,
    });
    await client.close();
    await updateLog(admin, logId, "sent");
    console.info("[admin-email] sent", { eventType: payload.eventType, logId });
    return { ok: true, log_id: logId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateLog(admin, logId, "failed", message);
    console.error("[admin-email] failed", { eventType: payload.eventType, logId, error: message });
    return { ok: false, log_id: logId, error: "email_send_failed", detail: message };
  }
}

async function bookingEmail(admin: any, bookingId: string, fullBookingData?: any): Promise<EmailPayload> {
  const { data: fetchedBooking, error } = fullBookingData
    ? { data: fullBookingData, error: null }
    : await admin
      .from("bookings")
      .select("*, clients(*), trips(title, season, start_date, end_date), booking_extras(name_snapshot, qty, unit_price_mad)")
      .eq("id", bookingId)
      .maybeSingle();
  const booking = fetchedBooking;
  if (error || !booking) throw new Error(error?.message ?? "Booking not found");

  const extras = booking.booking_extras ?? [];
  console.log("FULL BOOKING EMAIL DATA", booking);

  const trip = booking.trips;
  const tripLabel = [trip?.season, trip?.title].filter(Boolean).join(" — ") || "—";
  const dateLabel = booking.preferred_dates || [trip?.start_date, trip?.end_date].filter(Boolean).join(" → ") || "—";
  const departureDate = trip?.start_date || booking.preferred_dates || "—";
  const extrasLabel = (extras ?? []).length
    ? (extras ?? []).map((e: any) => `${e.name_snapshot} × ${e.qty} (${fmtMAD(Number(e.unit_price_mad || 0) * Number(e.qty || 1))})`).join(", ")
    : "—";
  const adminUrl = `${adminBaseUrl()}/admin/bookings/${booking.id}`;
  const total = Number(booking.total_amount_mad || 0);
  const paid = Number(booking.paid_amount_mad || 0);
  const balance = Math.max(0, total - paid);
  const subject = "Nouvelle inscription voyage — Lejapon.ma";

  return {
    eventType: "booking_internal",
    recipient: adminRecipient(),
    subject,
    html: emailShell("Nouvelle inscription voyage", "Une nouvelle demande d'inscription voyage vient d'être soumise sur la plateforme.", [
      ["Nom client", booking.contact_name],
      ["Email", booking.contact_email],
      ["Téléphone", booking.contact_phone],
      ["Voyage choisi", tripLabel],
      ["Date de départ", departureDate],
      ["Dates", dateLabel],
      ["Nombre de voyageurs", `${booking.num_adults || 0} adulte(s), ${booking.num_children || 0} enfant(s)`],
      ["Formule / hôtel", booking.formula],
      ["Chambre", booking.room_type],
      ["Options choisies", extrasLabel],
      ["Prix total", fmtMAD(total)],
      ["Montant payé", fmtMAD(paid)],
      ["Solde restant", fmtMAD(balance)],
      ["Ville", booking.contact_city],
      ["Message / notes", booking.message],
      ["Référence", booking.reference],
      ["Statut", booking.status],
      ["Source", booking.source],
    ], { label: "Contacter le client", href: mailto(booking.contact_email, "Votre inscription Lejapon.ma") }),
    text: `Nouvelle inscription voyage\n\nClient: ${plain(booking.contact_name)}\nEmail: ${plain(booking.contact_email)}\nTéléphone: ${plain(booking.contact_phone)}\nVoyage: ${tripLabel}\nDate de départ: ${plain(departureDate)}\nDates: ${dateLabel}\nVoyageurs: ${booking.num_adults || 0} adulte(s), ${booking.num_children || 0} enfant(s)\nFormule/hôtel: ${plain(booking.formula)}\nChambre: ${plain(booking.room_type)}\nOptions: ${extrasLabel}\nTotal: ${fmtMAD(total)}\nPayé: ${fmtMAD(paid)}\nSolde: ${fmtMAD(balance)}\nAdmin: ${adminUrl}`,
    related_booking_id: booking.id,
    metadata: { reference: booking.reference, admin_url: adminUrl },
  };
}

async function bookingClientEmail(admin: any, bookingId: string, fullBookingData?: any): Promise<EmailPayload> {
  const { data: fetchedBooking, error } = fullBookingData
    ? { data: fullBookingData, error: null }
    : await admin
      .from("bookings")
      .select("*, clients(*), trips(title, season, start_date, end_date), booking_extras(name_snapshot, qty, unit_price_mad)")
      .eq("id", bookingId)
      .maybeSingle();
  const booking = fetchedBooking;
  if (error || !booking) throw new Error(error?.message ?? "Booking not found");

  const total = Number(booking.total_amount_mad || 0);
  const phone = booking.contact_phone || "—";
  const trip = booking.trips;
  const tripLabel = [trip?.season, trip?.title].filter(Boolean).join(" — ") || booking.preferred_dates || "votre voyage";
  const subject = "Confirmation de votre inscription au voyage au Japon — Lejapon.ma";
  const intro = `Bonjour ${plain(booking.contact_name)},\n\nMerci pour votre inscription à notre prochain voyage au Japon.`;
  const html = emailShell(
    "Confirmation de votre inscription",
    `${intro}\n\nNous avons bien noté vos informations et vos choix de voyage. Un conseiller va prendre contact avec vous très bientôt sur le téléphone suivant : ${plain(phone)}, afin de confirmer votre inscription et répondre à vos questions.\n\nVeuillez noter que le prix à payer pour votre voyage est de ${fmtMAD(total)}.\n\nPensez à payer la somme totale de votre voyage très rapidement pour profiter de 2% de réduction. Offre valable uniquement jusqu'à six mois avant la date de départ de votre voyage.\n\nCordialement,\nL'équipe Lejapon.ma`,
    [
      ["Nom", booking.contact_name],
      ["Email", booking.contact_email],
      ["Téléphone", phone],
      ["Voyage", tripLabel],
      ["Prix total", fmtMAD(total)],
    ],
    undefined,
    "Lejapon.ma",
  );

  return {
    eventType: "booking_client",
    recipient: normalizeEmail(booking.contact_email),
    subject,
    html,
    text: `Bonjour ${plain(booking.contact_name)},\n\nMerci pour votre inscription à notre prochain voyage au Japon.\n\nNous avons bien noté vos informations et vos choix de voyage. Un conseiller va prendre contact avec vous très bientôt sur le téléphone suivant : ${plain(phone)}, afin de confirmer votre inscription et répondre à vos questions.\n\nVeuillez noter que le prix à payer pour votre voyage est de ${fmtMAD(total)}.\n\nPensez à payer la somme totale de votre voyage très rapidement pour profiter de 2% de réduction.\nOffre valable uniquement jusqu'à six mois avant la date de départ de votre voyage.\n\nCordialement,\nL'équipe Lejapon.ma`,
    related_booking_id: booking.id,
    metadata: { reference: booking.reference, client_email: booking.contact_email },
  };
}

async function paymentEmail(admin: any, paymentId: string): Promise<EmailPayload> {
  const { data: payment, error } = await admin.from("payments").select("*").eq("id", paymentId).maybeSingle();
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
  const subject = `Paiement enregistré – ${booking.contact_name} – ${fmtMAD(payment.amount_mad)}`;

  return {
    eventType: "payment_recorded",
    recipient: adminRecipient(),
    subject,
    html: emailShell("Paiement enregistré", "Un paiement vient d'être ajouté ou validé dans l'admin.", [
      ["Nom client", booking.contact_name],
      ["Réservation", booking.reference],
      ["Voyage", tripLabel],
      ["Montant payé", fmtMAD(payment.amount_mad)],
      ["Mode de paiement", payment.method],
      ["Date du paiement", fmtDate(payment.paid_at || payment.created_at)],
      ["Reste à payer", fmtMAD(rest)],
    ], { label: "Ouvrir dans l'admin", href: adminUrl }),
    text: `Paiement enregistré\n\nClient: ${booking.contact_name}\nRéservation: ${booking.reference}\nVoyage: ${tripLabel}\nMontant: ${fmtMAD(payment.amount_mad)}\nMode: ${payment.method ?? "—"}\nDate: ${fmtDate(payment.paid_at || payment.created_at)}\nReste à payer: ${fmtMAD(rest)}\nAdmin: ${adminUrl}`,
    related_booking_id: booking.id,
    related_payment_id: payment.id,
    metadata: { reference: booking.reference },
  };
}

function contactEmailPayload(contact: any): EmailPayload {
  const sentAt = fmtDate(contact.created_at);
  const subject = `Nouveau message depuis LeJapon.ma – ${contact.name}`;
  return {
    eventType: "contact_internal",
    recipient: adminRecipient(),
    subject,
    replyTo: contact.email,
    html: emailShell("Nouveau message depuis LeJapon.ma", "Un visiteur vient d'envoyer un message depuis le formulaire de contact.", [
      ["Nom", contact.name],
      ["Email", contact.email],
      ["Téléphone", contact.phone],
      ["Sujet", contact.subject],
      ["Date d'envoi", sentAt],
      ["Message", contact.message],
    ], { label: "Répondre au client", href: mailto(contact.email, "Votre message Lejapon.ma") }),
    text: `Nouveau message depuis LeJapon.ma\n\nNom: ${contact.name}\nEmail: ${contact.email}\nTéléphone: ${contact.phone ?? "—"}\nSujet: ${contact.subject ?? "—"}\nDate: ${sentAt}\n\nMessage:\n${contact.message}`,
    related_contact_id: contact.id,
    metadata: { email: contact.email, name: contact.name },
  };
}

function contactClientEmailPayload(contact: any): EmailPayload {
  const subject = "Nous avons bien reçu votre message — Lejapon.ma";
  return {
    eventType: "contact_client",
    recipient: normalizeEmail(contact.email),
    subject,
    html: emailShell(
      "Nous avons bien reçu votre message",
      `Bonjour ${plain(contact.name)},\n\nMerci pour votre message.\n\nNous avons bien reçu votre demande et un conseiller Lejapon.ma va vous répondre dans les plus brefs délais.\n\nCordialement,\nL'équipe Lejapon.ma`,
      [
        ["Nom", contact.name],
        ["Email", contact.email],
        ["Téléphone", contact.phone],
        ["Message", contact.message],
      ],
      undefined,
      "Lejapon.ma",
    ),
    text: `Bonjour ${plain(contact.name)},\n\nMerci pour votre message.\n\nNous avons bien reçu votre demande et un conseiller Lejapon.ma va vous répondre dans les plus brefs délais.\n\nRésumé de votre demande :\n- Nom : ${plain(contact.name)}\n- Email : ${plain(contact.email)}\n- Téléphone : ${plain(contact.phone)}\n- Message : ${plain(contact.message)}\n\nCordialement,\nL'équipe Lejapon.ma`,
    related_contact_id: contact.id,
    metadata: { email: contact.email, name: contact.name },
  };
}

async function contactEmail(admin: any, contactId: string): Promise<EmailPayload> {
  const { data: contact, error } = await admin.from("contact_messages").select("*").eq("id", contactId).maybeSingle();
  if (error || !contact) throw new Error(error?.message ?? "Contact message not found");
  return contactEmailPayload(contact);
}

async function contactClientEmail(admin: any, contactId: string): Promise<EmailPayload> {
  const { data: contact, error } = await admin.from("contact_messages").select("*").eq("id", contactId).maybeSingle();
  if (error || !contact) throw new Error(error?.message ?? "Contact message not found");
  return contactClientEmailPayload(contact);
}

async function contactEmailsFromPayload(admin: any, payload: any): Promise<EmailPayload[]> {
  const name = String(payload?.name ?? "").trim();
  const email = String(payload?.email ?? "").trim();
  const phone = payload?.phone ? String(payload.phone).trim() : null;
  const message = String(payload?.message ?? "").trim();
  const createdAt = payload?.created_at ? String(payload.created_at) : new Date().toISOString();

  if (!name || !email || !message) throw new Error("missing_contact_fields");
  if (name.length > 200) throw new Error("invalid_contact_name");
  if (email.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("invalid_contact_email");
  if (phone && phone.length > 50) throw new Error("invalid_contact_phone");
  if (message.length > 5000) throw new Error("invalid_contact_message");

  const { data: contact, error } = await admin
    .from("contact_messages")
    .insert({
      name,
      email,
      phone,
      message,
      created_at: createdAt,
    })
    .select("*")
    .single();
  if (error || !contact) throw new Error(error?.message ?? "contact_save_failed");
  return [contactEmailPayload(contact), contactClientEmailPayload(contact)];
}

function testEmail(): EmailPayload {
  const now = fmtDate(new Date().toISOString());
  return {
    eventType: "test",
    recipient: adminRecipient(),
    subject: "Test email interne – LeJapon.ma",
    html: emailShell("Test email interne", "Ceci est un email de test envoyé depuis l'admin LeJapon.ma.", [
      ["Destinataire", adminRecipient()],
      ["Date", now],
      ["Statut", "Configuration SMTP opérationnelle si vous recevez ce message."],
    ], { label: "Ouvrir les logs email", href: `${adminBaseUrl()}/admin/email-logs` }),
    text: `Test email interne LeJapon.ma\nDestinataire: ${adminRecipient()}\nDate: ${now}`,
    metadata: { test: true },
  };
}

async function requireStaff(admin: any, req: Request) {
  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) throw new Error("missing_auth");
  const { data, error } = await admin.auth.getUser(jwt);
  if (error || !data.user) throw new Error("invalid_token");
  const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", data.user.id);
  const allowed = (roles ?? []).some((r: any) => ["super_admin", "admin"].includes(r.role));
  if (!allowed) throw new Error("not_staff");
}

function eventTypeFromBody(body: any): EventType {
  const type = String(body?.type ?? "");
  if (type === "booking") return "booking_internal";
  if (type === "payment") return "payment_recorded";
  if (type === "contact") return "contact_internal";
  if (type === "test") return "test";
  if (type === "resend") return "resend_log";
  if (["contact_internal", "contact_client", "booking_internal", "booking_client"].includes(type)) return type as EventType;

  const eventType = String(body?.event_type ?? "");
  if (["booking_created", "payment_recorded", "contact_message", "test_email", "test", "resend_log"].includes(eventType)) {
    return eventType as EventType;
  }
  return "unknown";
}

function sanitizeRequestBody(body: any) {
  const payload = body?.payload && typeof body.payload === "object" ? body.payload : {};
  return {
    type: body?.type ?? null,
    event_type: body?.event_type ?? null,
    booking_id: body?.booking_id ?? payload.booking_id ?? null,
    payment_id: body?.payment_id ?? payload.payment_id ?? null,
    contact_id: body?.contact_id ?? payload.contact_id ?? null,
    log_id: body?.log_id ?? payload.log_id ?? null,
    payload_keys: Object.keys(payload),
  };
}

function errorCode(message: string) {
  if (["missing_auth", "invalid_token", "not_staff", "unsupported_event_type"].includes(message)) return message;
  if (message.includes("SMTP settings read failed")) return "smtp_settings_read_failed";
  if (message.includes("Missing SMTP settings")) return "missing_smtp_settings";
  if (message.includes("contact_messages")) return "contact_save_failed";
  return "function_failed";
}

async function payloadFromBody(admin: any, body: any, req: Request): Promise<EmailPayload[]> {
  const type = String(body.type ?? "");
  if (type === "contact") return contactEmailsFromPayload(admin, body.payload ?? {});
  if (type === "contact_internal") {
    const contactId = String(body.payload?.contact_id ?? body.contact_id ?? "");
    if (contactId) return [await contactEmail(admin, contactId)];
    const [internal] = await contactEmailsFromPayload(admin, body.payload ?? {});
    return [internal];
  }
  if (type === "contact_client") {
    const contactId = String(body.payload?.contact_id ?? body.contact_id ?? "");
    if (contactId) return [await contactClientEmail(admin, contactId)];
    const [, client] = await contactEmailsFromPayload(admin, body.payload ?? {});
    return [client];
  }
  if (type === "booking") {
    const bookingId = String(body.payload?.booking_id ?? body.payload?.id ?? "");
    const fullBookingData = body.payload?.fullBookingData;
    if (!fullBookingData && !bookingId) throw new Error("missing_booking_email_data");
    return [await bookingEmail(admin, bookingId, fullBookingData), await bookingClientEmail(admin, bookingId, fullBookingData)];
  }
  if (type === "booking_internal") return [await bookingEmail(admin, String(body.payload?.booking_id ?? body.payload?.id ?? body.booking_id ?? ""), body.payload?.fullBookingData)];
  if (type === "booking_client") return [await bookingClientEmail(admin, String(body.payload?.booking_id ?? body.payload?.id ?? body.booking_id ?? ""), body.payload?.fullBookingData)];
  if (type === "payment") return [await paymentEmail(admin, String(body.payload?.payment_id ?? body.payload?.id ?? ""))];
  if (type === "test") {
    await requireStaff(admin, req);
    return [testEmail()];
  }
  if (type === "resend") {
    await requireStaff(admin, req);
    const { data: log, error } = await admin.from("email_logs").select("*").eq("id", String(body.payload?.log_id ?? "")).maybeSingle();
    if (error || !log) throw new Error(error?.message ?? "Email log not found");
    if (["booking_created", "booking_internal"].includes(log.event_type) && log.related_booking_id) return [await bookingEmail(admin, log.related_booking_id)];
    if (log.event_type === "booking_client" && log.related_booking_id) return [await bookingClientEmail(admin, log.related_booking_id)];
    if (log.event_type === "payment_recorded" && log.related_payment_id) return [await paymentEmail(admin, log.related_payment_id)];
    if (["contact_message", "contact_internal"].includes(log.event_type) && log.related_contact_id) return [await contactEmail(admin, log.related_contact_id)];
    if (log.event_type === "contact_client" && log.related_contact_id) return [await contactClientEmail(admin, log.related_contact_id)];
    if (["test_email", "test"].includes(log.event_type)) return [testEmail()];
    throw new Error("This email log cannot be resent because related data is missing.");
  }

  const eventType = String(body.event_type ?? "");
  if (eventType === "booking_created") {
    const bookingId = String(body.booking_id ?? "");
    return [await bookingEmail(admin, bookingId, body.fullBookingData), await bookingClientEmail(admin, bookingId, body.fullBookingData)];
  }
  if (eventType === "payment_recorded") return [await paymentEmail(admin, String(body.payment_id ?? ""))];
  if (eventType === "contact_message") {
    const contactId = String(body.contact_id ?? "");
    return [await contactEmail(admin, contactId), await contactClientEmail(admin, contactId)];
  }
  if (eventType === "test_email" || eventType === "test") {
    await requireStaff(admin, req);
    return [testEmail()];
  }
  if (eventType === "resend_log") {
    await requireStaff(admin, req);
    const { data: log, error } = await admin.from("email_logs").select("*").eq("id", String(body.log_id ?? "")).maybeSingle();
    if (error || !log) throw new Error(error?.message ?? "Email log not found");
    if (["booking_created", "booking_internal"].includes(log.event_type) && log.related_booking_id) return [await bookingEmail(admin, log.related_booking_id)];
    if (log.event_type === "booking_client" && log.related_booking_id) return [await bookingClientEmail(admin, log.related_booking_id)];
    if (log.event_type === "payment_recorded" && log.related_payment_id) return [await paymentEmail(admin, log.related_payment_id)];
    if (["contact_message", "contact_internal"].includes(log.event_type) && log.related_contact_id) return [await contactEmail(admin, log.related_contact_id)];
    if (log.event_type === "contact_client" && log.related_contact_id) return [await contactClientEmail(admin, log.related_contact_id)];
    if (["test_email", "test"].includes(log.event_type)) return [testEmail()];
    throw new Error("This email log cannot be resent because related data is missing.");
  }
  throw new Error("unsupported_event_type");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(JSON.stringify({
      ok: false,
      error: "missing_supabase_config",
      detail: "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing; email_logs cannot be written.",
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);
  let body: any = {};
  let failureLogId: string | undefined;

  try {
    body = await req.json();
    const requestSummary = sanitizeRequestBody(body);
    console.info("[admin-email] request", {
      function: "send-admin-notification",
      has_auth: Boolean(req.headers.get("Authorization")),
      ...requestSummary,
    });

    const payloads = await payloadFromBody(admin, body, req);
    const results = [];
    for (const payload of payloads) {
      results.push(await sendEmail(admin, payload));
    }
    const failed = results.filter((result) => !result.ok);
    const result = {
      ok: failed.length === 0,
      results,
      log_ids: results.map((item) => item.log_id).filter(Boolean),
      error: failed.length ? "one_or_more_emails_failed" : undefined,
      detail: failed.length ? failed.map((item) => item.detail || item.error).filter(Boolean).join(" | ") : undefined,
    };
    console.info("[admin-email] response", {
      ok: result.ok,
      log_ids: result.log_ids,
      error: result.error ?? null,
      detail: result.detail ?? null,
    });
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = errorCode(message);
    const requestSummary = sanitizeRequestBody(body);
    console.error("[admin-email] request failed", { error: message, code, request: requestSummary });
    failureLogId = await createLog(admin, {
      eventType: eventTypeFromBody(body),
      recipient: adminRecipient(),
      subject: "Notification email échouée avant préparation",
      metadata: { request: requestSummary },
    }, "failed", message);

    return new Response(JSON.stringify({
      ok: false,
      error: code,
      detail: message,
      log_id: failureLogId,
      request: requestSummary,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
