import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import nodemailer from "npm:nodemailer@6";
import webpush from "npm:web-push@3.6.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type EventType =
  | "contact_internal"
  | "contact_client"
  | "booking_internal"
  | "booking_client"
  | "client_portal_invitation"
  | "booking_created"
  | "agency_booking_internal"
  | "agency_fit_request"
  | "agency_fit_quote_ready"
  | "payment_recorded"
  | "agency_payment_recorded"
  | "new_reservation"
  | "new_payment"
  | "new_visa_request"
  | "contact_message"
  | "test"
  | "test_email"
  | "test_template"
  | "resend_log"
  | "unknown";
type LogStatus = "pending" | "sent" | "failed";
type AdminNotificationType = "new_reservation" | "new_payment" | "new_visa_request" | "agency_fit_request";
type AdminNotificationChannel = "email" | "push";

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

type AdminNotification = {
  type: AdminNotificationType;
  title: string;
  message: string;
  data?: Record<string, unknown>;
  link?: string;
  related_id?: string | null;
};

const escapeHtml = (value: unknown) =>
  String(value ?? "—")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const legacyBrandPattern = "Ta" + "pis\\s+Volant";
const legacyTripsPattern = "Tri" + "ps\\s+app";
const BRAND_REPLACEMENTS: Array<[RegExp, string]> = [
  [new RegExp(`L['’]équipe\\s+${legacyBrandPattern}\\s*[—-]\\s*Le\\s+Japon`, "gi"), "L’équipe LeJapon.ma"],
  [new RegExp(`L['’]equipe\\s+${legacyBrandPattern}\\s*[—-]\\s*Le\\s+Japon`, "gi"), "L’équipe LeJapon.ma"],
  [new RegExp(`${legacyBrandPattern}\\s*[—-]\\s*Le\\s+Japon`, "gi"), "LeJapon.ma"],
  [new RegExp(legacyBrandPattern, "gi"), "LeJapon.ma"],
  [new RegExp(legacyTripsPattern, "gi"), "LeJapon.ma"],
];

const sanitizeBranding = (value: unknown) =>
  BRAND_REPLACEMENTS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), String(value ?? ""));

const renderTemplateString = (content: unknown, variables: Record<string, unknown>) =>
  sanitizeBranding(content).replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, key) => {
    const value = variables[key];
    return value === null || value === undefined || value === "" ? missing : sanitizeBranding(value);
  });

async function fetchEmailTemplate(admin: any, key: string, language = "fr") {
  const byKey = await admin
    .from("email_templates")
    .select("*")
    .eq("key", key)
    .eq("language", language)
    .limit(1)
    .maybeSingle();
  if (!byKey.error && byKey.data) return byKey.data;

  const byName = await admin
    .from("email_templates")
    .select("*")
    .eq("name", key)
    .eq("language", language)
    .limit(1)
    .maybeSingle();
  if (!byName.error && byName.data) return byName.data;

  if (byKey.error && !["42703", "PGRST204", "PGRST205"].includes(String(byKey.error.code ?? ""))) {
    console.warn("[admin-email] template lookup skipped", { key, code: byKey.error.code, message: byKey.error.message });
  }
  return null;
}

async function applyEmailTemplate(admin: any, key: string, variables: Record<string, unknown>, fallback: EmailPayload, language = "fr"): Promise<EmailPayload> {
  const template = await fetchEmailTemplate(admin, key, language);
  const safeFallback: EmailPayload = {
    ...fallback,
    subject: sanitizeBranding(fallback.subject),
    html: sanitizeBranding(fallback.html),
    text: sanitizeBranding(fallback.text),
  };
  const isActive = template?.is_active ?? template?.is_system ?? true;
  if (!template || isActive === false) {
    return {
      ...safeFallback,
      metadata: { ...(safeFallback.metadata ?? {}), template_key: key, template_found: Boolean(template), fallback_used: true, language },
    };
  }
  const html = template.body_html ?? template.html_body;
  if (!template.subject || !html) {
    return {
      ...safeFallback,
      metadata: { ...(safeFallback.metadata ?? {}), template_key: key, template_found: true, fallback_used: true, language },
    };
  }
  const renderedSubject = renderTemplateString(template.subject, variables);
  return {
    ...safeFallback,
    subject: renderedSubject,
    html: renderTemplateString(html, variables),
    text: renderTemplateString(template.body_text ?? template.preheader ?? safeFallback.text, variables),
    metadata: { ...(fallback.metadata ?? {}), template_key: key, template_source: "email_templates", template_found: true, fallback_used: false, language },
  };
}

const fmtMAD = (value: unknown) =>
  `${Number(value || 0).toLocaleString("fr-FR", { maximumFractionDigits: 0 })} MAD`;

const missing = "Non renseigné";

const fmtDate = (value: unknown) => {
  if (!value) return "—";
  try {
    return new Date(String(value)).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return String(value);
  }
};

const fmtDateOnly = (value: unknown) => {
  if (!value) return missing;
  try {
    return new Date(String(value)).toLocaleDateString("fr-FR", { dateStyle: "medium" });
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
  const text = String(value ?? "").trim();
  return text || "—";
}

function plainMissing(value: unknown) {
  const text = String(value ?? "").trim();
  return text || missing;
}

const rawMimePattern = /\b(MIME-Version|Content-Type|Content-Transfer-Encoding|multipart\/|boundary=|quoted-printable|attachment100|message100)\b/i;

function containsRawMime(value: unknown) {
  return rawMimePattern.test(String(value ?? ""));
}

function plainTextFromHtml(value: string) {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h1|h2|h3|li|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

const truthy = (value: unknown) => {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  return true;
};

const paymentMethodLabel = (value: unknown) => {
  const raw = String(value ?? "").trim().toLowerCase();
  const labels: Record<string, string> = {
    cash: "Espèces",
    especes: "Espèces",
    espèces: "Espèces",
    bank_transfer: "Virement bancaire",
    transfer: "Virement bancaire",
    virement: "Virement bancaire",
    card: "Carte bancaire",
    carte: "Carte bancaire",
    cheque: "Chèque",
    chèque: "Chèque",
    agency_payment: "Versement agence",
    other: "Autre",
  };
  return labels[raw] ?? plainMissing(value);
};

const paymentStatusLabel = (value: unknown) => {
  const raw = String(value ?? "").trim().toLowerCase();
  const labels: Record<string, string> = {
    pending: "En attente",
    received: "Reçu",
    paid: "Payé",
    refunded: "Remboursé",
    cancelled: "Annulé",
  };
  return labels[raw] ?? plainMissing(value);
};

function safeArray(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function quoteAdjustmentsFromBooking(booking: any) {
  const direct = safeArray(booking?.quote_adjustments);
  const metadata = safeArray(booking?.metadata?.quote_adjustments);
  const legacy = booking?.quote_discount;
  const legacyLine = legacy && typeof legacy === "object"
    ? [{
      label: legacy.label || legacy.title || "Réduction / ligne spéciale devis",
      type: "discount",
      calculation_type: legacy.type || legacy.calculation_type || "fixed_amount",
      amount: Number(legacy.amount || 0),
      visible_on_quote: true,
    }]
    : [];
  return direct.length ? direct : metadata.length ? metadata : legacyLine;
}

function adjustmentLabel(line: any) {
  const sign = line?.type === "supplement" ? "+" : "-";
  const label = plainMissing(line?.label);
  const amount = line?.calculation_type === "percentage"
    ? `${Number(line?.amount || 0).toLocaleString("fr-FR", { maximumFractionDigits: 2 })}%`
    : fmtMAD(line?.amount);
  return `${label} · ${line?.type === "supplement" ? "Supplément" : "Réduction"} · ${sign}${amount}`;
}

function sectionHtml(title: string, rows: Array<[string, unknown]>) {
  const renderedRows = rows.map(([label, value]) => `
    <tr>
      <td style="padding:9px 0;color:#746960;width:190px;border-bottom:1px solid #f0ece8;vertical-align:top">${escapeHtml(label)}</td>
      <td style="padding:9px 0;border-bottom:1px solid #f0ece8;vertical-align:top"><strong>${escapeHtml(truthy(value) ? value : missing)}</strong></td>
    </tr>
  `).join("");
  return `
    <div style="margin:18px 0 0;padding:16px;border:1px solid #eee7e1;border-radius:12px;background:#fffdfa">
      <h2 style="margin:0 0 10px;font-size:16px;color:#171412">${escapeHtml(title)}</h2>
      <table role="presentation" style="width:100%;border-collapse:collapse;font-size:14px">${renderedRows}</table>
    </div>
  `;
}

function listSectionHtml(title: string, items: string[], emptyText = missing) {
  const content = items.length
    ? `<ol style="margin:8px 0 0;padding-left:20px">${items.map((item) => `<li style="margin:0 0 8px;line-height:1.5">${escapeHtml(item)}</li>`).join("")}</ol>`
    : `<p style="margin:8px 0 0;color:#746960">${escapeHtml(emptyText)}</p>`;
  return `
    <div style="margin:18px 0 0;padding:16px;border:1px solid #eee7e1;border-radius:12px;background:#fffdfa">
      <h2 style="margin:0 0 10px;font-size:16px;color:#171412">${escapeHtml(title)}</h2>
      ${content}
    </div>
  `;
}

function bookingNotificationShell(reference: unknown, sections: string[], adminUrl: string, title = "Nouvelle réservation — LeJapon.ma", eyebrow = "Nouvelle réservation") {
  return `
    <div style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,Helvetica,sans-serif;color:#171412">
      <div style="max-width:760px;margin:0 auto;padding:28px 14px">
        <div style="padding:0 0 16px;text-align:center">
          <div style="font-size:24px;font-weight:700;color:#E21B2D;letter-spacing:.02em">LeJapon.ma</div>
          <div style="margin-top:4px;font-size:12px;color:#766f68">Moroccan Express Travel & Events</div>
        </div>
        <div style="background:#ffffff;border-radius:14px;border:1px solid #e8e4e1;padding:26px;box-shadow:0 6px 24px rgba(0,0,0,.05)">
          <div style="border-bottom:3px solid #E21B2D;padding-bottom:14px;margin-bottom:20px">
            <p style="margin:0 0 6px;color:#746960;font-size:13px;text-transform:uppercase;letter-spacing:.08em">${escapeHtml(eyebrow)}</p>
            <h1 style="margin:0;font-size:24px;line-height:1.3;color:#171412">${escapeHtml(title)}</h1>
            <p style="margin:10px 0 0;font-size:14px;color:#3a3531">Référence: <strong>${escapeHtml(plainMissing(reference))}</strong></p>
          </div>
          ${sections.join("")}
          <p style="margin:26px 0 0">
            <a href="${escapeHtml(adminUrl)}" style="display:inline-block;background:#E21B2D;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:bold">Ouvrir la réservation</a>
          </p>
        </div>
        <p style="margin:18px 0 0;text-align:center;color:#8a8178;font-size:12px">Notification automatique — LeJapon.ma</p>
      </div>
    </div>
  `;
}

function adminBaseUrl() {
  return (Deno.env.get("ADMIN_BASE_URL") || Deno.env.get("SITE_URL") || "https://www.lejapon.ma").replace(/\/$/, "");
}

function adminRecipient() {
  return Deno.env.get("ADMIN_NOTIFICATION_EMAIL") || Deno.env.get("ADMIN_NOTIFICATION_EMAILS")?.split(",")[0]?.trim() || "info@lejapon.ma";
}

function adminRecipients() {
  const raw = Deno.env.get("ADMIN_NOTIFICATION_EMAILS") || Deno.env.get("ADMIN_NOTIFICATION_EMAIL") || "info@lejapon.ma";
  return raw
    .split(",")
    .map((email) => normalizeEmail(email))
    .filter((email, index, list) => email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && list.indexOf(email) === index);
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
      fromName: String(settings.from_name || "LeJapon.ma / Moroccan Express Travel & Events").trim(),
      replyTo: normalizeEmail(settings.reply_to) || undefined,
    }
    : {
      source: "edge_secrets",
      hostname: normalizeHostname(Deno.env.get("SMTP_HOST")),
      port: Number(Deno.env.get("SMTP_PORT") || 465),
      secure: Number(Deno.env.get("SMTP_PORT") || 465) === 465 ? "ssl" : "starttls",
      username: normalizeEmail(Deno.env.get("SMTP_USER")),
      password: String(Deno.env.get("SMTP_PASS") ?? ""),
      from: normalizeEmail(Deno.env.get("EMAIL_FROM") || Deno.env.get("SMTP_FROM")),
      fromName: "LeJapon.ma / Moroccan Express Travel & Events",
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

  return {
    transport: {
      host: config.hostname,
      port: config.port,
      secure: config.secure === "ssl",
      auth: { user: config.username, pass: config.password },
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
  footer = "Notification automatique — LeJapon.ma",
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
          <div style="font-size:24px;font-weight:700;color:#E21B2D;letter-spacing:.02em">LeJapon.ma</div>
          <div style="margin-top:4px;font-size:12px;color:#766f68">Moroccan Express Travel & Events</div>
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

function ensureCleanEmailPayload(payload: EmailPayload): EmailPayload {
  const textLooksRaw = containsRawMime(payload.text);
  const htmlLooksRaw = containsRawMime(payload.html);
  const fallbackSource = htmlLooksRaw ? (textLooksRaw ? "" : payload.text) : (payload.html || payload.text || payload.subject);
  const fallbackText = plainTextFromHtml(fallbackSource || payload.subject);
  const safeFallbackText = fallbackText && !containsRawMime(fallbackText) ? fallbackText : payload.subject;
  const cleanText = textLooksRaw ? safeFallbackText : payload.text;
  const cleanHtml = htmlLooksRaw
    ? emailShell(payload.subject, safeFallbackText, [], undefined, "Notification automatique — LeJapon.ma")
    : payload.html;
  return {
    ...payload,
    subject: sanitizeBranding(payload.subject),
    html: sanitizeBranding(cleanHtml),
    text: sanitizeBranding(cleanText || safeFallbackText),
  };
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
  payload = ensureCleanEmailPayload(payload);
  const logId = existingLogId ?? await createLog(admin, payload, "pending");
  if (existingLogId) await updateLogDetails(admin, existingLogId, payload);
  if (!payload.recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.recipient)) {
    await updateLog(admin, logId, "failed", "missing_or_invalid_recipient");
    console.warn("[admin-email] skipped invalid recipient", { eventType: payload.eventType, logId });
    return { ok: true, log_id: logId, skipped: "missing_or_invalid_recipient" };
  }
  try {
    const smtp = await smtpConfig(admin);
    const transporter = nodemailer.createTransport(smtp.transport);
    await transporter.sendMail({
      from: `${smtp.fromName} <${smtp.from}>`,
      to: payload.recipient,
      replyTo: payload.replyTo || smtp.replyTo,
      subject: payload.subject,
      text: payload.text,
      html: payload.html,
    });
    transporter.close();
    await updateLog(admin, logId, "sent");
    return { ok: true, log_id: logId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateLog(admin, logId, "failed", message);
    console.error("[admin-email] failed", { eventType: payload.eventType, logId, error_code: "email_send_failed", error: message });
    return { ok: false, log_id: logId, error: "email_send_failed", detail: message };
  }
}

function adminNotificationTypeForPayload(payload: EmailPayload): AdminNotificationType | null {
  if (["booking_internal", "booking_created", "new_reservation"].includes(payload.eventType)) return "new_reservation";
  if (["payment_recorded", "new_payment"].includes(payload.eventType)) return "new_payment";
  if (payload.eventType === "new_visa_request") return "new_visa_request";
  if (payload.eventType === "agency_fit_request") return "agency_fit_request";
  return null;
}

function notificationFromEmailPayload(payload: EmailPayload): AdminNotification | null {
  const type = adminNotificationTypeForPayload(payload);
  if (!type) return null;
  const metadata = payload.metadata ?? {};
  const clientName = plainMissing(metadata.client_name);
  const amount = metadata.amount ? plainMissing(metadata.amount) : "";
  const titles: Record<AdminNotificationType, string> = {
    new_reservation: "Nouvelle réservation",
    new_payment: "Nouveau paiement reçu",
    new_visa_request: "Nouvelle demande de visa",
    agency_fit_request: "Nouvelle demande FIT agence",
  };
  const messages: Record<AdminNotificationType, string> = {
    new_reservation: `${clientName} vient de faire une réservation.`,
    new_payment: `${clientName} a payé ${amount || "un montant enregistré"}.`,
    new_visa_request: `${clientName} a créé une nouvelle demande de visa.`,
    agency_fit_request: `${plainMissing(metadata.agency_name)} a envoyé une demande FIT pour ${clientName}.`,
  };
  const relatedId = payload.related_payment_id ?? payload.related_booking_id ?? String(metadata.visa_application_id ?? metadata.related_id ?? "");
  return {
    type,
    title: titles[type],
    message: messages[type],
    data: metadata,
    link: String(metadata.admin_url ?? ""),
    related_id: relatedId || null,
  };
}

async function createAdminNotificationLog(
  admin: any,
  notification: AdminNotification,
  channel: AdminNotificationChannel,
  recipient: string | null,
  status: LogStatus,
  errorMessage?: string,
) {
  const { error } = await admin
    .from("admin_notification_logs")
    .insert({
      type: notification.type,
      channel,
      title: notification.title,
      message: notification.message,
      recipient,
      status,
      error_message: errorMessage ?? null,
      related_id: notification.related_id || null,
      data: notification.data ?? {},
      link: notification.link || null,
    });
  if (error) console.warn("[admin-notification] log insert skipped", error.message);
}

async function sendPushNotifications(admin: any, notification: AdminNotification) {
  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  const privateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  const subject = Deno.env.get("VAPID_SUBJECT") || "mailto:info@lejapon.ma";
  const results = [];

  if (!publicKey || !privateKey) {
    const message = "missing_vapid_config";
    await createAdminNotificationLog(admin, notification, "push", "admin_push_subscriptions", "failed", message);
    return [{ ok: false, error: message }];
  }

  const { data: subscriptions, error } = await admin
    .from("admin_push_subscriptions")
    .select("id,endpoint,p256dh,auth,enabled")
    .eq("enabled", true);
  if (error) {
    await createAdminNotificationLog(admin, notification, "push", "admin_push_subscriptions", "failed", error.message);
    return [{ ok: false, error: "subscription_fetch_failed", detail: error.message }];
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  const payload = JSON.stringify({
    type: notification.type,
    title: notification.title,
    body: notification.message,
    message: notification.message,
    link: notification.link || "/admin",
    data: notification.data ?? {},
  });

  for (const subscription of subscriptions ?? []) {
    const recipient = String(subscription.endpoint ?? "");
    try {
      await webpush.sendNotification({
        endpoint: recipient,
        keys: {
          p256dh: String(subscription.p256dh ?? ""),
          auth: String(subscription.auth ?? ""),
        },
      }, payload);
      await createAdminNotificationLog(admin, notification, "push", recipient, "sent");
      results.push({ ok: true, subscription_id: subscription.id });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await createAdminNotificationLog(admin, notification, "push", recipient, "failed", message);
      if (/410|404|expired|gone/i.test(message)) {
        await admin.from("admin_push_subscriptions").update({ enabled: false }).eq("id", subscription.id);
      }
      results.push({ ok: false, subscription_id: subscription.id, error: message });
    }
  }
  return results;
}

async function sendAdminNotification(admin: any, notification: AdminNotification, emailPayload?: EmailPayload) {
  const emailResults = [];
  if (emailPayload) {
    for (const recipient of adminRecipients()) {
      const result = await sendEmail(admin, { ...emailPayload, recipient });
      await createAdminNotificationLog(
        admin,
        notification,
        "email",
        recipient,
        result.ok ? "sent" : "failed",
        result.ok ? undefined : String(result.detail || result.error || "email_send_failed"),
      );
      emailResults.push(result);
    }
  }
  const pushResults = await sendPushNotifications(admin, notification);
  return { email_results: emailResults, push_results: pushResults };
}

async function bookingEmail(admin: any, bookingId: string, fullBookingData?: any): Promise<EmailPayload> {
  const { data: fetchedBooking, error } = fullBookingData
    ? { data: fullBookingData, error: null }
    : await admin
      .from("bookings")
      .select("*, clients(*), trips(*), booking_extras(*)")
      .eq("id", bookingId)
      .maybeSingle();
  const booking = fetchedBooking;
  if (error || !booking) {
    console.error("[admin-email] booking fetch failed", { booking_id: bookingId || null, error_code: "booking_fetch_failed", detail: error?.message ?? "Booking not found" });
    throw new Error(error?.message ?? "Booking not found");
  }

  const extras = booking.booking_extras ?? [];
  const [{ data: participants }, { data: payments }] = await Promise.all([
    admin
      .from("booking_participants")
      .select("*")
      .eq("booking_id", booking.id)
      .order("is_lead", { ascending: false })
      .order("created_at", { ascending: true }),
    admin
      .from("payments")
      .select("*")
      .eq("booking_id", booking.id)
      .order("paid_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false }),
  ]);

  let agencyName: string | null = null;
  if (booking.agency_organization_id) {
    const { data: agency } = await admin
      .from("organizations")
      .select("display_name,legal_name")
      .eq("id", booking.agency_organization_id)
      .maybeSingle();
    agencyName = agency?.display_name || agency?.legal_name || null;
  }

  const trip = booking.trips;
  const tripLabel = [trip?.season, trip?.title].filter(Boolean).join(" — ") || booking.preferred_dates || missing;
  const departureDate = trip?.start_date || booking.start_date || null;
  const returnDate = trip?.end_date || booking.end_date || null;
  const duration = trip?.duration_days || booking.duration_days
    ? `${trip?.duration_days || booking.duration_days} jours`
    : departureDate && returnDate
      ? `${Math.max(1, Math.round((new Date(returnDate).getTime() - new Date(departureDate).getTime()) / 86400000) + 1)} jours`
      : missing;
  const adminUrl = `${adminBaseUrl()}/admin/bookings/${booking.id}`;
  const total = Number(booking.total_amount_mad || 0);
  const paid = Number(booking.paid_amount_mad || 0);
  const balance = Math.max(0, total - paid);
  const latestPayment = (payments ?? [])[0] ?? null;
  const paymentMethod = latestPayment?.method || booking.payment_method || booking.payment_mode || null;
  const travelerCount = Number(booking.num_adults || 0) + Number(booking.num_children || 0);
  const kyotoHotel = booking.kyoto_hotel_option || booking.kyoto_hotel || booking.hotel_choice || booking.hotel_category || null;
  const quoteAdjustments = quoteAdjustmentsFromBooking(booking);
  const sourceLabel = agencyName
    ? `Agence partenaire — ${agencyName}`
    : String(booking.source ?? "").toLowerCase().includes("agency")
      ? "Agence partenaire"
      : "LeJapon.ma public website";

  const participantItems = (participants ?? []).map((participant: any) => {
    const fullName = [participant.first_name, participant.last_name].filter(Boolean).join(" ") || participant.full_name || missing;
    const parts = [
      fullName,
      `Passeport: ${plainMissing(participant.passport_no || participant.passport_number)}`,
      `Chambre: ${plainMissing(participant.room_type || participant.room || booking.room_type)}`,
    ];
    return parts.join(" · ");
  });

  const extrasItems = (extras ?? []).map((extra: any) => {
    const qty = Number(extra.qty || extra.quantity || 1);
    const unit = Number(extra.unit_price_mad || extra.price_mad || 0);
    const lineTotal = Number(extra.total_mad || unit * qty || 0);
    return [
      plainMissing(extra.name_snapshot || extra.name),
      `Qté: ${qty || 1}`,
      `Prix unitaire: ${unit ? fmtMAD(unit) : missing}`,
      `Total: ${lineTotal ? fmtMAD(lineTotal) : missing}`,
    ].join(" · ");
  });
  const adjustmentItems = quoteAdjustments
    .filter((line: any) => line?.visible_on_quote !== false)
    .map(adjustmentLabel);

  const sections = [
    sectionHtml("Client", [
      ["Nom complet", booking.contact_name],
      ["Email", booking.contact_email],
      ["Téléphone", booking.contact_phone],
      ["Ville", booking.contact_city],
      ["Nombre de voyageurs", travelerCount ? `${travelerCount} (${Number(booking.num_adults || 0)} adulte(s), ${Number(booking.num_children || 0)} enfant(s))` : missing],
    ]),
    sectionHtml("Voyage", [
      ["Voyage", tripLabel],
      ["Date de départ", fmtDateOnly(departureDate)],
      ["Date de retour", fmtDateOnly(returnDate)],
      ["Durée", duration],
      ["Formule / hébergement", booking.formula],
      ["Type de chambre", booking.room_type],
      ["Option hôtel Kyoto", kyotoHotel],
    ]),
    listSectionHtml("Participants", participantItems, "Aucun participant détaillé renseigné."),
    listSectionHtml("Extras", extrasItems, "Aucun extra sélectionné."),
    listSectionHtml("Ajustements devis", adjustmentItems, "Aucun ajustement devis."),
    sectionHtml("Prix & paiement", [
      ["Total", fmtMAD(total)],
      ["Montant payé", paid ? fmtMAD(paid) : missing],
      ["Reste à payer", fmtMAD(balance)],
      ["Mode de paiement", paymentMethodLabel(paymentMethod)],
    ]),
    sectionHtml("Source", [
      ["Origine", sourceLabel],
      ["Message / notes", booking.message],
      ["Statut", booking.status],
    ]),
  ];

  const subject = "Nouvelle réservation - LeJapon.ma";
  const html = bookingNotificationShell(
    booking.reference,
    sections,
    adminUrl,
    `Nouvelle réservation — ${plainMissing(booking.contact_name)} — ${plainMissing(trip?.title || tripLabel)}`
  );
  const participantsText = participantItems.length ? participantItems.map((item: string) => `- ${item}`).join("\n") : `- ${missing}`;
  const extrasText = extrasItems.length ? extrasItems.map((item: string) => `- ${item}`).join("\n") : `- ${missing}`;
  const adjustmentsText = adjustmentItems.length ? adjustmentItems.map((item: string) => `- ${item}`).join("\n") : `- ${missing}`;

  const payload: EmailPayload = {
    eventType: "booking_internal",
    recipient: adminRecipient(),
    subject,
    html,
    text: `Nouvelle réservation — LeJapon.ma
Référence: ${plainMissing(booking.reference)}

Client
- Nom: ${plainMissing(booking.contact_name)}
- Email: ${plainMissing(booking.contact_email)}
- Téléphone: ${plainMissing(booking.contact_phone)}
- Ville: ${plainMissing(booking.contact_city)}
- Voyageurs: ${travelerCount ? `${travelerCount} (${Number(booking.num_adults || 0)} adulte(s), ${Number(booking.num_children || 0)} enfant(s))` : missing}

Voyage
- Voyage: ${tripLabel}
- Départ: ${fmtDateOnly(departureDate)}
- Retour: ${fmtDateOnly(returnDate)}
- Durée: ${duration}
- Formule/hébergement: ${plainMissing(booking.formula)}
- Chambre: ${plainMissing(booking.room_type)}
- Option hôtel Kyoto: ${plainMissing(kyotoHotel)}

Participants
${participantsText}

Extras
${extrasText}

Ajustements devis
${adjustmentsText}

Prix & paiement
- Total: ${fmtMAD(total)}
- Payé: ${paid ? fmtMAD(paid) : missing}
- Reste à payer: ${fmtMAD(balance)}
- Mode de paiement: ${paymentMethodLabel(paymentMethod)}

Source
- Origine: ${sourceLabel}
- Notes: ${plainMissing(booking.message)}
- Statut: ${plainMissing(booking.status)}

Ouvrir la réservation: ${adminUrl}`,
    related_booking_id: booking.id,
    metadata: {
      reference: booking.reference,
      admin_url: adminUrl,
      client_name: plainMissing(booking.contact_name),
      trip_title: plainMissing(trip?.title || tripLabel),
      amount: fmtMAD(total),
    },
  };
  return await applyEmailTemplate(admin, "booking_new_admin", {
    client_name: plainMissing(booking.contact_name),
    booking_reference: plainMissing(booking.reference),
    trip_title: plainMissing(trip?.title || tripLabel),
    admin_link: adminUrl,
    amount: fmtMAD(total),
    agency_name: agencyName || "",
    status: booking.status,
  }, payload);
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
  if (error || !booking) {
    console.error("[admin-email] booking client fetch failed", { booking_id: bookingId || null, error_code: "booking_fetch_failed", detail: error?.message ?? "Booking not found" });
    throw new Error(error?.message ?? "Booking not found");
  }

  const total = Number(booking.total_amount_mad || 0);
  const trip = booking.trips;
  const tripLabel = [trip?.season, trip?.title].filter(Boolean).join(" — ") || booking.preferred_dates || "votre voyage";
  const travelers = Number(booking.num_adults || 0) + Number(booking.num_children || 0);
  const extras = safeArray(booking.booking_extras).map((extra: any) => {
    const qty = Number(extra.qty || extra.quantity || 1);
    const unit = Number(extra.unit_price_mad || extra.price_mad || 0);
    const total = Number(extra.total_mad || unit * qty || 0);
    return `${plainMissing(extra.name_snapshot || extra.name)} · Qté: ${qty || 1}${unit ? ` · ${fmtMAD(unit)} / unité` : ""}${total ? ` · Total: ${fmtMAD(total)}` : ""}`;
  });
  const extrasSummary = extras.length ? extras.join("\n") : "Aucun extra sélectionné";
  const depositAmount = Number(booking.deposit_amount_mad || booking.metadata?.deposit_amount_mad || 0);
  const whatsappHref = "https://wa.me/212711449838";
  const subject = "Votre demande de réservation LeJapon.ma a bien été reçue";
  const html = emailShell(
    "Votre demande de réservation est bien reçue",
    `Bonjour ${plain(booking.contact_name)},\n\nNous avons bien reçu votre demande de réservation LeJapon.ma.\n\nVotre réservation sera confirmée après réception du premier acompte. Un conseiller LeJapon.ma vous contactera rapidement pour répondre à vos questions et valider les détails de votre voyage.`,
    [
      ["Référence", booking.reference],
      ["Voyage", tripLabel],
      ["Date de départ", fmtDateOnly(trip?.start_date || booking.start_date)],
      ["Nombre de voyageurs", travelers || missing],
      ["Type de chambre", booking.room_type],
      ["Option hôtel / formule", booking.formula || booking.hotel_choice || booking.hotel_category],
      ["Extras sélectionnés", extrasSummary],
      ["Montant total estimé", total ? fmtMAD(total) : missing],
      ["Acompte à prévoir", depositAmount ? fmtMAD(depositAmount) : missing],
    ],
    { label: "Nous contacter sur WhatsApp", href: whatsappHref },
    "LeJapon.ma / Moroccan Express Travel & Events · info@lejapon.ma · +212 711 449 838",
  );

  const payload: EmailPayload = {
    eventType: "booking_client",
    recipient: normalizeEmail(booking.contact_email),
    subject,
    html,
    text: `Bonjour ${plain(booking.contact_name)},

Nous avons bien reçu votre demande de réservation LeJapon.ma.

Référence: ${plainMissing(booking.reference)}
Voyage: ${tripLabel}
Date de départ: ${fmtDateOnly(trip?.start_date || booking.start_date)}
Nombre de voyageurs: ${travelers || missing}
Type de chambre: ${plainMissing(booking.room_type)}
Option hôtel / formule: ${plainMissing(booking.formula || booking.hotel_choice || booking.hotel_category)}
Extras:
${extras.map((item: string) => `- ${item}`).join("\n") || "- Aucun extra sélectionné"}
Montant total estimé: ${total ? fmtMAD(total) : missing}
Acompte à prévoir: ${depositAmount ? fmtMAD(depositAmount) : missing}

Votre réservation sera confirmée après réception du premier acompte.
Un conseiller LeJapon.ma vous contactera rapidement pour répondre à vos questions et valider les détails.

WhatsApp: +212 711 449 838
Email: info@lejapon.ma

LeJapon.ma / Moroccan Express Travel & Events`,
    related_booking_id: booking.id,
    metadata: { reference: booking.reference, client_email: booking.contact_email },
  };
  return await applyEmailTemplate(admin, "booking_received_client", {
    client_name: plainMissing(booking.contact_name),
    booking_reference: plainMissing(booking.reference),
    trip_title: tripLabel,
    amount: total ? fmtMAD(total) : missing,
    download_link: whatsappHref,
    date: fmtDateOnly(trip?.start_date || booking.start_date),
  }, payload);
}

function firstNameFrom(value: unknown) {
  const first = String(value ?? "").trim().split(/\s+/).filter(Boolean)[0];
  return first || "";
}

function publicClientLoginUrl() {
  const base = (Deno.env.get("PUBLIC_SITE_URL") || Deno.env.get("SITE_URL") || "https://www.lejapon.ma").replace(/\/$/, "");
  return `${base}/espace-voyage/login`;
}

async function clientPortalInvitationEmail(admin: any, bookingId: string): Promise<EmailPayload> {
  if (!bookingId) throw new Error("missing_booking_id");
  const { data: booking, error } = await admin
    .from("bookings")
    .select("id,reference,contact_name,contact_email,client_id,clients(full_name,email),trips(title,season)")
    .eq("id", bookingId)
    .maybeSingle();

  if (error || !booking) {
    console.error("[admin-email] client portal invitation booking fetch failed", {
      booking_id: bookingId || null,
      error_code: "booking_fetch_failed",
      detail: error?.message ?? "Booking not found",
    });
    throw new Error(error?.message ?? "Booking not found");
  }

  const recipient = normalizeEmail(booking.contact_email || booking.clients?.email);
  if (!recipient) throw new Error("missing_client_email");

  const clientNameRaw = String(booking.contact_name || booking.clients?.full_name || "").trim();
  const clientName = plainMissing(clientNameRaw);
  const clientFirstName = firstNameFrom(clientNameRaw);
  const tripLabel = [booking.trips?.season, booking.trips?.title].filter(Boolean).join(" — ") || "votre voyage";
  const loginLink = publicClientLoginUrl();
  const fallbackHtml = emailShell(
    "Votre espace voyage LeJapon.ma est prêt",
    `Bonjour${clientFirstName ? ` ${plain(clientFirstName)}` : ""},\n\nVotre espace voyage est disponible pour votre réservation ${plainMissing(booking.reference)}.\n\nConnectez-vous avec l'email utilisé lors de votre réservation. Si vous n'avez pas encore de mot de passe, utilisez le bouton Créer mon mot de passe sur la page de connexion.`,
    [
      ["Référence", booking.reference],
      ["Voyage", tripLabel],
      ["Email de connexion", recipient],
    ],
    { label: "Accéder à mon espace voyage", href: loginLink },
    "LeJapon.ma / Moroccan Express Travel & Events · info@lejapon.ma · +212 711 449 838",
  );

  const payload: EmailPayload = {
    eventType: "client_portal_invitation",
    recipient,
    subject: `Votre espace voyage LeJapon.ma est prêt — ${plainMissing(booking.reference)}`,
    html: fallbackHtml,
    text: `Bonjour${clientFirstName ? ` ${clientFirstName}` : ""},

Votre espace voyage LeJapon.ma est prêt pour votre réservation ${plainMissing(booking.reference)}.
Voyage : ${tripLabel}

Connectez-vous avec l'email utilisé lors de votre réservation.
Si vous n'avez pas encore de mot de passe, cliquez sur "Créer mon mot de passe" sur la page de connexion.
Si vous avez déjà un compte, ce même bouton vous permet de récupérer votre accès.

Accès : ${loginLink}

L'équipe LeJapon.ma`,
    related_booking_id: booking.id,
    metadata: { reference: booking.reference, template_key: "client_portal_invitation", login_link: loginLink },
  };

  return await applyEmailTemplate(admin, "client_portal_invitation", {
    client_name: clientName,
    client_first_name: clientFirstName || clientName,
    booking_reference: plainMissing(booking.reference),
    trip_title: tripLabel,
    login_link: loginLink,
    download_link: loginLink,
    date: fmtDateOnly(new Date().toISOString()),
  }, payload);
}

async function paymentEmail(admin: any, paymentId: string, paymentPayload?: any, bookingIdHint?: string): Promise<EmailPayload> {
  const { data: fetchedPayment, error } = paymentPayload
    ? { data: paymentPayload, error: null }
    : paymentId
      ? await admin.from("payments").select("*").eq("id", paymentId).maybeSingle()
      : bookingIdHint
        ? await admin
          .from("payments")
          .select("*")
          .eq("booking_id", bookingIdHint)
          .order("paid_at", { ascending: false, nullsFirst: false })
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
        : { data: null, error: null };
  const payment = fetchedPayment;
  if (error || !payment) {
    console.error("[admin-email] payment fetch failed", { payment_id: paymentId || null, booking_id: bookingIdHint || null, error_code: "payment_fetch_failed", detail: error?.message ?? "Payment not found" });
    throw new Error(error?.message ?? "Payment not found");
  }

  const { data: booking, error: bookingError } = await admin
    .from("bookings")
    .select("*, trips(title, season), clients(*)")
    .eq("id", payment.booking_id || bookingIdHint)
    .maybeSingle();
  if (bookingError || !booking) {
    console.error("[admin-email] payment booking fetch failed", { payment_id: payment.id || paymentId || null, booking_id: payment.booking_id || bookingIdHint || null, error_code: "payment_booking_fetch_failed", detail: bookingError?.message ?? "Booking not found" });
    throw new Error(bookingError?.message ?? "Booking not found");
  }

  const { data: payments } = await admin
    .from("payments")
    .select("amount_mad,status")
    .eq("booking_id", booking.id);
  const paidTotal = safeArray(payments)
    .filter((row: any) => String(row.status ?? "received") !== "refunded")
    .reduce((sum, row: any) => sum + Number(row.amount_mad || 0), 0);
  let agencyName: string | null = null;
  if (booking.agency_organization_id) {
    const { data: agency } = await admin
      .from("organizations")
      .select("display_name,legal_name")
      .eq("id", booking.agency_organization_id)
      .maybeSingle();
    agencyName = agency?.display_name || agency?.legal_name || null;
  }
  const tripLabel = [booking.trips?.season, booking.trips?.title].filter(Boolean).join(" — ") || "—";
  const rest = Math.max(0, Number(booking.total_amount_mad || 0) - paidTotal);
  const adminUrl = `${adminBaseUrl()}/admin/bookings/${booking.id}`;
  const subject = "Nouveau paiement reçu - LeJapon.ma";

  const payload: EmailPayload = {
    eventType: "payment_recorded",
    recipient: adminRecipient(),
    subject,
    html: emailShell("Nouveau paiement reçu", "Un paiement vient d'être ajouté ou validé.", [
      ["ID / référence paiement", payment.reference || payment.id],
      ["Réservation", booking.reference],
      ["Nom client", booking.contact_name],
      ["Email client", booking.contact_email || booking.clients?.email],
      ["Téléphone client", booking.contact_phone || booking.clients?.phone],
      ["Voyage", tripLabel],
      ["Agence", agencyName],
      ["Montant payé", fmtMAD(payment.amount_mad)],
      ["Mode de paiement", paymentMethodLabel(payment.method)],
      ["Date du paiement", fmtDate(payment.paid_at || payment.created_at)],
      ["Statut", paymentStatusLabel(payment.status)],
      ["Référence externe", payment.reference],
      ["Notes", payment.notes],
      ["Total payé", fmtMAD(paidTotal)],
      ["Reste à payer", fmtMAD(rest)],
    ], { label: "Ouvrir la réservation", href: adminUrl }),
    text: `Nouveau paiement reçu

Paiement: ${plainMissing(payment.reference || payment.id)}
Réservation: ${plainMissing(booking.reference)}
Client: ${plainMissing(booking.contact_name)}
Email: ${plainMissing(booking.contact_email || booking.clients?.email)}
Téléphone: ${plainMissing(booking.contact_phone || booking.clients?.phone)}
Voyage: ${tripLabel}
Agence: ${plainMissing(agencyName)}
Montant: ${fmtMAD(payment.amount_mad)}
Méthode: ${paymentMethodLabel(payment.method)}
Date: ${fmtDate(payment.paid_at || payment.created_at)}
Statut: ${paymentStatusLabel(payment.status)}
Référence externe: ${plainMissing(payment.reference)}
Notes: ${plainMissing(payment.notes)}
Total payé: ${fmtMAD(paidTotal)}
Reste à payer: ${fmtMAD(rest)}

Ouvrir: ${adminUrl}`,
    related_booking_id: booking.id,
    related_payment_id: payment.id,
    metadata: {
      reference: booking.reference,
      admin_url: adminUrl,
      client_name: plainMissing(booking.contact_name),
      amount: fmtMAD(payment.amount_mad),
      payment_method: paymentMethodLabel(payment.method),
    },
  };
  return await applyEmailTemplate(admin, "payment_new_admin", {
    client_name: plainMissing(booking.contact_name),
    booking_reference: plainMissing(booking.reference),
    trip_title: tripLabel,
    amount: fmtMAD(payment.amount_mad),
    payment_method: paymentMethodLabel(payment.method),
    admin_link: adminUrl,
    agency_name: agencyName || "",
    status: paymentStatusLabel(payment.status),
    date: fmtDate(payment.paid_at || payment.created_at),
  }, payload);
}

async function agencyBookingEmail(admin: any, requestId: string): Promise<EmailPayload> {
  const { data: request, error } = await admin
    .from("agency_booking_requests")
    .select("*")
    .eq("id", requestId)
    .maybeSingle();
  if (error || !request) throw new Error(error?.message ?? "Agency booking request not found");

  const [{ data: organization }, { data: trip }] = await Promise.all([
    request.organization_id
      ? admin.from("organizations").select("display_name,legal_name,email,phone").eq("id", request.organization_id).maybeSingle()
      : Promise.resolve({ data: null }),
    request.metadata?.trip_id
      ? admin.from("trips").select("title,season,start_date,end_date").eq("id", request.metadata.trip_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const metadata = request.metadata ?? {};
  const extrasItems = safeArray(metadata.selected_extras).map((extra: any) => [
    plainMissing(extra.name),
    `Qté: ${Number(extra.quantity || 1)}`,
    `Prix unitaire: ${extra.unit_price || extra.price_mad ? fmtMAD(extra.unit_price || extra.price_mad) : missing}`,
    `Total: ${extra.total ? fmtMAD(extra.total) : missing}`,
  ].join(" · "));
  const adminUrl = `${adminBaseUrl()}/admin/bookings`;
  const agencyName = organization?.display_name || organization?.legal_name || request.organization_id;
  const tripLabel = metadata.trip_title || request.trip_interest || [trip?.season, trip?.title].filter(Boolean).join(" — ");
  const subject = `Nouvelle réservation agence — ${plainMissing(request.client_full_name)} — ${plainMissing(tripLabel)}`;
  const sections = [
    sectionHtml("Agence", [
      ["Agence", agencyName],
      ["Email agence", organization?.email],
      ["Téléphone agence", organization?.phone],
    ]),
    sectionHtml("Client", [
      ["Nom", request.client_full_name],
      ["Email", request.client_email],
      ["Téléphone", request.client_phone],
      ["Voyageurs", request.travelers_count],
    ]),
    sectionHtml("Voyage & options", [
      ["Voyage", tripLabel],
      ["Départ", fmtDateOnly(request.preferred_departure_date || trip?.start_date)],
      ["Chambre", metadata.room_type],
      ["Option hôtel", metadata.hotel_category],
      ["Demandes spéciales", metadata.special_requests || request.message],
    ]),
    listSectionHtml("Extras", extrasItems, "Aucun extra sélectionné."),
    sectionHtml("Prix & commission", [
      ["Total estimé", metadata.estimated_total ? fmtMAD(metadata.estimated_total) : missing],
      ["Commission estimée", metadata.estimated_commission ? fmtMAD(metadata.estimated_commission) : missing],
      ["Statut", request.status],
    ]),
  ];

  const payload: EmailPayload = {
    eventType: "agency_booking_internal",
    recipient: adminRecipient(),
    subject,
    html: bookingNotificationShell(request.id, sections, adminUrl, "Nouvelle réservation agence", "Agence partenaire"),
    text: `Nouvelle réservation agence

Agence: ${plainMissing(agencyName)}
Client: ${plainMissing(request.client_full_name)}
Email: ${plainMissing(request.client_email)}
Téléphone: ${plainMissing(request.client_phone)}
Voyage: ${plainMissing(tripLabel)}
Départ: ${fmtDateOnly(request.preferred_departure_date || trip?.start_date)}
Voyageurs: ${plainMissing(request.travelers_count)}
Chambre: ${plainMissing(metadata.room_type)}
Option hôtel: ${plainMissing(metadata.hotel_category)}
Total estimé: ${metadata.estimated_total ? fmtMAD(metadata.estimated_total) : missing}
Commission estimée: ${metadata.estimated_commission ? fmtMAD(metadata.estimated_commission) : missing}

Ouvrir: ${adminUrl}`,
    metadata: { agency_booking_request_id: request.id },
  };
  return await applyEmailTemplate(admin, "agency_booking_new_admin", {
    agency_name: plainMissing(agencyName),
    client_name: plainMissing(request.client_full_name),
    trip_title: plainMissing(tripLabel),
    amount: metadata.estimated_total ? fmtMAD(metadata.estimated_total) : missing,
    admin_link: adminUrl,
    status: request.status,
    date: fmtDateOnly(request.preferred_departure_date || trip?.start_date),
  }, payload);
}

async function agencyPaymentEmail(admin: any, requestId: string, paymentId?: string): Promise<EmailPayload> {
  const { data: request, error } = await admin
    .from("agency_booking_requests")
    .select("*")
    .eq("id", requestId)
    .maybeSingle();
  if (error || !request) throw new Error(error?.message ?? "Agency booking request not found");

  const metadata = request.metadata ?? {};
  const payments = safeArray(metadata.payments);
  const payment = payments.find((item: any) => item.id === paymentId) ?? payments[0] ?? null;
  if (!payment) throw new Error("Agency payment not found");
  const paidTotal = payments
    .filter((item: any) => !["cancelled", "refunded"].includes(String(item.status ?? "")))
    .reduce((sum: number, item: any) => sum + Number(item.amount_mad || 0), 0);
  const total = Number(metadata.estimated_total || 0);
  const rest = Math.max(0, total - paidTotal);
  const { data: organization } = request.organization_id
    ? await admin.from("organizations").select("display_name,legal_name").eq("id", request.organization_id).maybeSingle()
    : { data: null };
  const agencyName = organization?.display_name || organization?.legal_name || request.organization_id;
  const adminUrl = `${adminBaseUrl()}/admin/bookings`;
  const subject = `Nouveau paiement agence — ${plainMissing(request.client_full_name)} — ${fmtMAD(payment.amount_mad)}`;

  const payload: EmailPayload = {
    eventType: "agency_payment_recorded",
    recipient: adminRecipient(),
    subject,
    html: emailShell("Nouveau paiement agence", "Une agence partenaire vient d'ajouter ou modifier un paiement sur une réservation agence.", [
      ["Paiement", payment.reference || payment.id],
      ["Agence", agencyName],
      ["Client", request.client_full_name],
      ["Voyage", metadata.trip_title || request.trip_interest],
      ["Montant", fmtMAD(payment.amount_mad)],
      ["Méthode", paymentMethodLabel(payment.method)],
      ["Date", fmtDate(payment.paid_at || payment.created_at)],
      ["Statut", paymentStatusLabel(payment.status)],
      ["Référence", payment.reference],
      ["Notes", payment.notes],
      ["Total payé", fmtMAD(paidTotal)],
      ["Reste à payer", total ? fmtMAD(rest) : missing],
    ], { label: "Ouvrir les réservations", href: adminUrl }),
    text: `Nouveau paiement agence

Paiement: ${plainMissing(payment.reference || payment.id)}
Agence: ${plainMissing(agencyName)}
Client: ${plainMissing(request.client_full_name)}
Voyage: ${plainMissing(metadata.trip_title || request.trip_interest)}
Montant: ${fmtMAD(payment.amount_mad)}
Méthode: ${paymentMethodLabel(payment.method)}
Date: ${fmtDate(payment.paid_at || payment.created_at)}
Statut: ${paymentStatusLabel(payment.status)}
Référence: ${plainMissing(payment.reference)}
Notes: ${plainMissing(payment.notes)}
Total payé: ${fmtMAD(paidTotal)}
Reste à payer: ${total ? fmtMAD(rest) : missing}

Ouvrir: ${adminUrl}`,
    metadata: { agency_booking_request_id: request.id, payment_id: payment.id },
  };
  return await applyEmailTemplate(admin, "agency_payment_new_admin", {
    agency_name: plainMissing(agencyName),
    client_name: plainMissing(request.client_full_name),
    trip_title: plainMissing(metadata.trip_title || request.trip_interest),
    amount: fmtMAD(payment.amount_mad),
    payment_method: paymentMethodLabel(payment.method),
    admin_link: adminUrl,
    status: paymentStatusLabel(payment.status),
    date: fmtDate(payment.paid_at || payment.created_at),
  }, payload);
}

const visaStatusLabel = (value: unknown) => {
  const raw = String(value ?? "").trim().toLowerCase();
  const labels: Record<string, string> = {
    draft: "Brouillon",
    submitted: "Soumise",
    awaiting_documents: "En attente des documents",
    documents_received: "Documents reçus",
    in_review: "En traitement",
    submitted_to_embassy: "Soumise à l'ambassade",
    approved: "Approuvée",
    rejected: "Rejetée",
    completed: "Terminée",
  };
  return labels[raw] ?? plainMissing(value);
};

const professionalSituationLabel = (value: unknown) => {
  const labels: Record<string, string> = {
    private_employee: "Salarié du secteur privé",
    civil_servant: "Fonctionnaire",
    business_owner: "Chef d'entreprise / entrepreneur",
    liberal_profession: "Profession libérale / médecin",
    student: "Étudiant",
    retired: "Retraité",
    unemployed: "Sans emploi",
    other: "Autre",
    tourism: "Tourisme",
  };
  return labels[String(value ?? "")] ?? plainMissing(value);
};

async function visaRequestEmail(admin: any, applicationId: string, applicationPayload?: any): Promise<EmailPayload> {
  const { data: fetchedApp, error } = applicationPayload
    ? { data: applicationPayload, error: null }
    : await admin.from("visa_applications").select("*").eq("id", applicationId).maybeSingle();
  const app = fetchedApp;
  if (error || !app) throw new Error(error?.message ?? "Visa application not found");

  let trip: any = null;
  let booking: any = null;
  const tripId = app.selected_trip_id || app.document_trip_id || app.trip_id || null;
  if (tripId) {
    const { data } = await admin.from("trips").select("id,title,season,start_date,end_date").eq("id", tripId).maybeSingle();
    trip = data ?? null;
  }
  if (!trip && app.booking_id) {
    const { data } = await admin
      .from("bookings")
      .select("id,reference,trip_id,trips(id,title,season,start_date,end_date)")
      .eq("id", app.booking_id)
      .maybeSingle();
    booking = data ?? null;
    trip = booking?.trips ?? null;
  }

  const adminUrl = `${adminBaseUrl()}/admin/visa/${app.id}`;
  const clientName = [app.surname, app.given_names].filter(Boolean).join(" ") || missing;
  const tripLabel = trip ? [trip.season, trip.title].filter(Boolean).join(" — ") : missing;
  const subject = "Nouvelle demande de visa - LeJapon.ma";
  const html = emailShell("Nouvelle demande de visa reçue", "Une nouvelle demande de visa vient d'être soumise depuis l'espace client.", [
    ["Client", clientName],
    ["Type de visa", professionalSituationLabel(app.professional_situation || app.category || app.visa_type || "tourism")],
    ["Statut", visaStatusLabel(app.status)],
    ["Date de demande", fmtDate(app.submitted_at || app.created_at)],
    ["Téléphone", app.residential_mobile || app.residential_tel],
    ["Email", app.residential_email],
    ["Passeport", app.passport_no],
    ["Voyage", tripLabel],
    ["Réservation", booking?.reference || app.booking_id],
  ], { label: "Ouvrir le dossier visa", href: adminUrl });

  return {
    eventType: "new_visa_request",
    recipient: adminRecipient(),
    subject,
    html,
    text: `Nouvelle demande de visa reçue

Client: ${clientName}
Type de visa: ${professionalSituationLabel(app.professional_situation || app.category || app.visa_type || "tourism")}
Statut: ${visaStatusLabel(app.status)}
Date de demande: ${fmtDate(app.submitted_at || app.created_at)}
Téléphone: ${plainMissing(app.residential_mobile || app.residential_tel)}
Email: ${plainMissing(app.residential_email)}
Passeport: ${plainMissing(app.passport_no)}
Voyage: ${tripLabel}
Réservation: ${plainMissing(booking?.reference || app.booking_id)}

Lien admin: ${adminUrl}`,
    metadata: {
      visa_application_id: app.id,
      reference: app.reference,
      admin_url: adminUrl,
      client_name: clientName,
      status: visaStatusLabel(app.status),
    },
  };
}

async function agencyFitRequestEmail(admin: any, requestId: string): Promise<EmailPayload> {
  const { data: request, error } = await admin
    .from("agency_fit_requests")
    .select("*, organizations(display_name,legal_name,email)")
    .eq("id", requestId)
    .maybeSingle();
  if (error || !request) throw new Error(error?.message ?? "Agency FIT request not found");

  const agencyName = request.organizations?.display_name || request.organizations?.legal_name || "Agence partenaire";
  const adminUrl = `${adminBaseUrl()}/admin/agency-fit-requests`;
  const travelers = `${Number(request.adults || 0)} adulte(s), ${Number(request.children || 0)} enfant(s), ${Number(request.babies || 0)} bébé(s)`;
  return {
    eventType: "agency_fit_request",
    recipient: adminRecipient(),
    subject: "Nouvelle demande FIT agence - LeJapon.ma",
    html: emailShell("Nouvelle demande FIT agence", "Une agence partenaire vient d'envoyer une demande de devis FIT sur mesure.", [
      ["Agence", agencyName],
      ["Client", request.client_full_name],
      ["Téléphone client", request.client_phone],
      ["Email client", request.client_email],
      ["Voyageurs", travelers],
      ["Destination", request.destination_country],
      ["Villes", safeArray(request.cities).join(", ")],
      ["Dates", `${fmtDateOnly(request.desired_departure_date)} → ${fmtDateOnly(request.desired_return_date)}`],
      ["Durée", request.duration_days ? `${request.duration_days} jours` : missing],
      ["Budget", request.budget_per_person ? `${Number(request.budget_per_person).toLocaleString("fr-FR")} ${request.currency || ""}` : missing],
      ["Style", safeArray(request.travel_styles).join(", ")],
    ], { label: "Ouvrir les demandes FIT", href: adminUrl }),
    text: `Nouvelle demande FIT agence

Agence: ${plainMissing(agencyName)}
Client: ${plainMissing(request.client_full_name)}
Téléphone: ${plainMissing(request.client_phone)}
Email: ${plainMissing(request.client_email)}
Voyageurs: ${travelers}
Destination: ${plainMissing(request.destination_country)}
Villes: ${safeArray(request.cities).join(", ") || missing}
Dates: ${fmtDateOnly(request.desired_departure_date)} → ${fmtDateOnly(request.desired_return_date)}
Durée: ${request.duration_days ? `${request.duration_days} jours` : missing}
Budget: ${request.budget_per_person ? `${Number(request.budget_per_person).toLocaleString("fr-FR")} ${request.currency || ""}` : missing}

Ouvrir: ${adminUrl}`,
    metadata: {
      agency_fit_request_id: request.id,
      agency_name: agencyName,
      client_name: plainMissing(request.client_full_name),
      admin_url: adminUrl,
    },
  };
}

async function agencyFitQuoteReadyEmail(admin: any, requestId: string): Promise<EmailPayload> {
  const { data: request, error } = await admin
    .from("agency_fit_requests")
    .select("*, organizations(display_name,legal_name,email)")
    .eq("id", requestId)
    .maybeSingle();
  if (error || !request) throw new Error(error?.message ?? "Agency FIT request not found");

  const agencyName = request.organizations?.display_name || request.organizations?.legal_name || "Agence partenaire";
  const recipient = normalizeEmail(request.organizations?.email);
  if (!recipient) throw new Error("Agency email is missing");
  const agencyUrl = `${adminBaseUrl()}/agency/fit-quotes`;
  return {
    eventType: "agency_fit_quote_ready",
    recipient,
    subject: "Votre devis FIT est prêt - LeJapon.ma",
    html: emailShell("Devis FIT prêt", "Le devis FIT demandé par votre agence est prêt. Vous pouvez ajouter votre marge et partager le lien final avec votre client depuis votre espace agence.", [
      ["Agence", agencyName],
      ["Client", request.client_full_name],
      ["Destination", request.destination_country],
      ["Prix base LeJapon.ma", request.base_total_price ? fmtMAD(request.base_total_price) : missing],
      ["Lien devis", request.quote_link],
    ], { label: "Ouvrir mon espace agence", href: agencyUrl }),
    text: `Devis FIT prêt

Agence: ${plainMissing(agencyName)}
Client: ${plainMissing(request.client_full_name)}
Destination: ${plainMissing(request.destination_country)}
Prix base LeJapon.ma: ${request.base_total_price ? fmtMAD(request.base_total_price) : missing}
Lien devis: ${plainMissing(request.quote_link)}

Ouvrir mon espace agence: ${agencyUrl}`,
    metadata: {
      agency_fit_request_id: request.id,
      agency_name: agencyName,
      client_name: plainMissing(request.client_full_name),
      quote_link: request.quote_link,
    },
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
    ], { label: "Répondre au client", href: mailto(contact.email, "Votre message LeJapon.ma") }),
    text: `Nouveau message depuis LeJapon.ma\n\nNom: ${contact.name}\nEmail: ${contact.email}\nTéléphone: ${contact.phone ?? "—"}\nSujet: ${contact.subject ?? "—"}\nDate: ${sentAt}\n\nMessage:\n${contact.message}`,
    related_contact_id: contact.id,
    metadata: { email: contact.email, name: contact.name },
  };
}

function contactClientEmailPayload(contact: any): EmailPayload {
  const subject = "Nous avons bien reçu votre message — LeJapon.ma";
  return {
    eventType: "contact_client",
    recipient: normalizeEmail(contact.email),
    subject,
    html: emailShell(
      "Nous avons bien reçu votre message",
      `Bonjour ${plain(contact.name)},\n\nMerci pour votre message.\n\nNous avons bien reçu votre demande et un conseiller LeJapon.ma va vous répondre dans les plus brefs délais.\n\nCordialement,\nL'équipe LeJapon.ma`,
      [
        ["Nom", contact.name],
        ["Email", contact.email],
        ["Téléphone", contact.phone],
        ["Message", contact.message],
      ],
      undefined,
      "LeJapon.ma",
    ),
    text: `Bonjour ${plain(contact.name)},\n\nMerci pour votre message.\n\nNous avons bien reçu votre demande et un conseiller LeJapon.ma va vous répondre dans les plus brefs délais.\n\nRésumé de votre demande :\n- Nom : ${plain(contact.name)}\n- Email : ${plain(contact.email)}\n- Téléphone : ${plain(contact.phone)}\n- Message : ${plain(contact.message)}\n\nCordialement,\nL'équipe LeJapon.ma`,
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
  if (type === "booking" || type === "new_booking") return "booking_internal";
  if (type === "client_portal_invitation") return "client_portal_invitation";
  if (type === "agency_booking") return "agency_booking_internal";
  if (type === "agency_fit_request") return "agency_fit_request";
  if (type === "agency_fit_quote_ready") return "agency_fit_quote_ready";
  if (type === "payment" || type === "new_payment") return "payment_recorded";
  if (type === "visa_request" || type === "new_visa_request") return "new_visa_request";
  if (type === "agency_payment") return "agency_payment_recorded";
  if (type === "contact") return "contact_internal";
  if (type === "test") return "test";
  if (type === "test_template") return "test_template";
  if (type === "resend") return "resend_log";
  if (["contact_internal", "contact_client", "booking_internal", "booking_client", "client_portal_invitation", "new_visa_request", "agency_fit_request", "agency_fit_quote_ready"].includes(type)) return type as EventType;

  const eventType = String(body?.event_type ?? "");
  if (["booking_created", "new_booking", "client_portal_invitation", "agency_booking_internal", "agency_fit_request", "agency_fit_quote_ready", "payment_recorded", "new_payment", "new_visa_request", "visa_request", "agency_payment_recorded", "contact_message", "test_email", "test", "resend_log"].includes(eventType)) {
    if (eventType === "new_booking") return "booking_created";
    if (eventType === "new_payment") return "payment_recorded";
    if (eventType === "visa_request") return "new_visa_request";
    return eventType as EventType;
  }
  return "unknown";
}

function sanitizeRequestBody(body: any) {
  const payload = body?.payload && typeof body.payload === "object" ? body.payload : {};
  return {
    action: body?.action ?? null,
    type: body?.type ?? null,
    event_type: body?.event_type ?? null,
    booking_id: body?.booking_id ?? payload.booking_id ?? null,
    agency_fit_request_id: body?.request_id ?? payload.request_id ?? null,
    payment_id: body?.payment_id ?? payload.payment_id ?? null,
    visa_application_id: body?.application_id ?? body?.visa_application_id ?? payload.application_id ?? payload.visa_application_id ?? null,
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
  const payload = body?.payload && typeof body.payload === "object" ? body.payload : {};
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
  if (type === "booking" || type === "new_booking") {
    const bookingId = String(payload.booking_id ?? body.booking_id ?? payload.id ?? "");
    const fullBookingData = body.payload?.fullBookingData;
    if (!fullBookingData && !bookingId) throw new Error("missing_booking_email_data");
    return [await bookingEmail(admin, bookingId, fullBookingData), await bookingClientEmail(admin, bookingId, fullBookingData)];
  }
  if (type === "client_portal_invitation") {
    await requireStaff(admin, req);
    return [await clientPortalInvitationEmail(admin, String(payload.booking_id ?? body.booking_id ?? payload.id ?? ""))];
  }
  if (type === "agency_booking") {
    return [await agencyBookingEmail(admin, String(body.payload?.request_id ?? body.payload?.id ?? body.request_id ?? ""))];
  }
  if (type === "agency_fit_request") return [await agencyFitRequestEmail(admin, String(payload.request_id ?? payload.id ?? body.request_id ?? ""))];
  if (type === "agency_fit_quote_ready") return [await agencyFitQuoteReadyEmail(admin, String(payload.request_id ?? payload.id ?? body.request_id ?? ""))];
  if (type === "booking_internal") return [await bookingEmail(admin, String(payload.booking_id ?? payload.id ?? body.booking_id ?? ""), payload.fullBookingData)];
  if (type === "booking_client") return [await bookingClientEmail(admin, String(payload.booking_id ?? payload.id ?? body.booking_id ?? ""), payload.fullBookingData)];
  if (type === "payment" || type === "new_payment") return [await paymentEmail(admin, String(payload.payment_id ?? body.payment_id ?? payload.id ?? ""), payload.payment, String(payload.booking_id ?? body.booking_id ?? ""))];
  if (type === "visa_request" || type === "new_visa_request") return [await visaRequestEmail(admin, String(payload.application_id ?? payload.visa_application_id ?? body.application_id ?? body.visa_application_id ?? payload.id ?? ""), payload.application)];
  if (type === "agency_payment") return [await agencyPaymentEmail(admin, String(body.payload?.request_id ?? body.request_id ?? ""), String(body.payload?.payment_id ?? body.payment_id ?? ""))];
  if (type === "test") {
    await requireStaff(admin, req);
    return [testEmail()];
  }
  if (type === "test_template") {
    await requireStaff(admin, req);
    const recipient = normalizeEmail(payload.recipient ?? body.recipient ?? "");
    const subject = String(payload.subject ?? body.subject ?? "Test template email — LeJapon.ma");
    const html = String(payload.html ?? body.html ?? "");
    const text = String(payload.text ?? body.text ?? "Test template email — LeJapon.ma");
    const templateKey = String(payload.template_key ?? body.template_key ?? "test_template");
    if (!recipient || !html) throw new Error("missing_test_template_fields: recipient and html are required");
    return [{
      eventType: "test_template",
      recipient,
      subject,
      html,
      text,
      metadata: { test_template: true, template_key: templateKey, fallback_used: false },
    }];
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
  if (eventType === "booking_created" || eventType === "new_booking") {
    const bookingId = String(body.booking_id ?? body.payload?.booking_id ?? "");
    return [await bookingEmail(admin, bookingId, body.fullBookingData), await bookingClientEmail(admin, bookingId, body.fullBookingData)];
  }
  if (eventType === "client_portal_invitation") {
    await requireStaff(admin, req);
    return [await clientPortalInvitationEmail(admin, String(body.booking_id ?? body.payload?.booking_id ?? ""))];
  }
  if (eventType === "agency_booking_internal") return [await agencyBookingEmail(admin, String(body.request_id ?? body.payload?.request_id ?? ""))];
  if (eventType === "agency_fit_request") return [await agencyFitRequestEmail(admin, String(body.request_id ?? body.payload?.request_id ?? body.payload?.id ?? ""))];
  if (eventType === "agency_fit_quote_ready") return [await agencyFitQuoteReadyEmail(admin, String(body.request_id ?? body.payload?.request_id ?? body.payload?.id ?? ""))];
  if (eventType === "payment_recorded" || eventType === "new_payment") return [await paymentEmail(admin, String(body.payment_id ?? body.payload?.payment_id ?? ""), body.payload?.payment, String(body.booking_id ?? body.payload?.booking_id ?? ""))];
  if (eventType === "new_visa_request" || eventType === "visa_request") return [await visaRequestEmail(admin, String(body.application_id ?? body.visa_application_id ?? body.payload?.application_id ?? body.payload?.visa_application_id ?? ""), body.payload?.application)];
  if (eventType === "agency_payment_recorded") return [await agencyPaymentEmail(admin, String(body.request_id ?? body.payload?.request_id ?? ""), String(body.payment_id ?? body.payload?.payment_id ?? ""))];
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

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

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
  let failureLogId: string | undefined;

  try {
    const payloads = await payloadFromBody(admin, body, req);
    const results = [];
    for (const payload of payloads) {
      const adminNotification = notificationFromEmailPayload(payload);
      if (adminNotification) {
        results.push(await sendAdminNotification(admin, adminNotification, payload));
      } else {
        results.push(await sendEmail(admin, payload));
      }
    }
    const failed = results.filter((result: any) => result.ok === false);
    const result = {
      ok: failed.length === 0,
      results,
      log_ids: results.map((item: any) => item?.log_id).filter(Boolean),
      error: failed.length ? "one_or_more_emails_failed" : undefined,
      detail: failed.length ? failed.map((item: any) => item?.detail || item?.error).filter(Boolean).join(" | ") : undefined,
    };
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
