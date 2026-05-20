import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const RECAPTCHA_SECRET = Deno.env.get("RECAPTCHA_SECRET_KEY") ?? "";
const BYPASS_TOKEN = "__recaptcha_bypass_local__";

const escapeHtml = (value: unknown) =>
  String(value ?? "—")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function isLocalOrigin(req: Request) {
  const origin = req.headers.get("Origin") ?? req.headers.get("Referer") ?? "";
  try {
    const hostname = new URL(origin).hostname;
    return hostname === "localhost" || hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

async function verifyRecaptcha(token: string, req: Request) {
  if (token === BYPASS_TOKEN && isLocalOrigin(req)) return { ok: true, reason: "local_bypass" };
  if (!RECAPTCHA_SECRET) return { ok: true };
  if (!token) return { ok: false, reason: "missing_token" };
  const body = new URLSearchParams({ secret: RECAPTCHA_SECRET, response: token }).toString();
  const res = await fetch("https://www.google.com/recaptcha/api/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await res.json();
  if (!data.success) return { ok: false, reason: "invalid_token" };
  if (typeof data.score === "number" && data.score < 0.5) return { ok: false, reason: "low_score" };
  return { ok: true };
}

function smtpConfig() {
  const config = {
    hostname: Deno.env.get("SMTP_HOST"),
    port: Number(Deno.env.get("SMTP_PORT") || 465),
    username: Deno.env.get("SMTP_USER"),
    password: Deno.env.get("SMTP_PASS"),
    from: Deno.env.get("SMTP_FROM"),
  };
  const missing = [
    ["SMTP_HOST", config.hostname],
    ["SMTP_USER", config.username],
    ["SMTP_PASS", config.password],
    ["SMTP_FROM", config.from],
  ].filter(([, value]) => !value).map(([key]) => key);
  if (missing.length) {
    throw new Error(`Missing SMTP secrets: ${missing.join(", ")}. Configure them in Supabase Edge Function secrets, not only local .env.`);
  }
  return {
    connection: {
      hostname: config.hostname!,
      port: config.port,
      tls: config.port === 465,
      auth: { username: config.username!, password: config.password! },
    },
    from: config.from!,
  };
}

async function createLog(admin: any, contactId: string, recipient: string, subject: string) {
  const { data, error } = await admin
    .from("email_logs")
    .insert({
      event_type: "contact_message",
      recipient,
      subject,
      status: "pending",
      related_contact_id: contactId,
    })
    .select("id")
    .single();
  if (error) console.error("[contact-email] log insert failed", error);
  return data?.id as string | undefined;
}

async function updateLog(admin: any, id: string | undefined, status: "sent" | "failed", errorMessage?: string) {
  if (!id) return;
  const { error } = await admin
    .from("email_logs")
    .update({
      status,
      error_message: errorMessage ?? null,
      sent_at: status === "sent" ? new Date().toISOString() : null,
    })
    .eq("id", id);
  if (error) console.error("[contact-email] log update failed", error);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const { name, email, phone, subject, message, recaptchaToken } = await req.json();

    const captcha = await verifyRecaptcha(String(recaptchaToken ?? ""), req);
    if (!captcha.ok) {
      return new Response(JSON.stringify({ error: "recaptcha_failed", reason: captcha.reason }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!name || !email || !message) throw new Error("Missing required fields");
    if (typeof name !== "string" || name.length > 200) throw new Error("Invalid name");
    if (typeof email !== "string" || email.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Invalid email");
    if (phone && (typeof phone !== "string" || phone.length > 50)) throw new Error("Invalid phone");
    if (subject && (typeof subject !== "string" || subject.length > 200)) throw new Error("Invalid subject");
    if (typeof message !== "string" || message.length > 5000) throw new Error("Invalid message");

    const { data: contact, error: contactError } = await admin
      .from("contact_messages")
      .insert({
        name: name.trim(),
        email: email.trim(),
        phone: phone?.trim() || null,
        subject: subject?.trim() || null,
        message: message.trim(),
      })
      .select("*")
      .single();
    if (contactError || !contact) throw new Error(contactError?.message ?? "Unable to save contact message");

    const recipient = Deno.env.get("ADMIN_NOTIFICATION_EMAIL") || "info@lejapon.ma";
    const emailSubject = `Nouveau message depuis LeJapon.ma – ${contact.name}`;
    const logId = await createLog(admin, contact.id, recipient, emailSubject);
    const sentAt = new Date(contact.created_at).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });

    const html = `
      <div style="font-family:Arial,sans-serif;color:#171412;max-width:640px;margin:0 auto">
        <p style="margin:0 0 6px;color:#8a8178;font-size:12px;letter-spacing:.14em;text-transform:uppercase">LeJapon.ma</p>
        <h1 style="border-bottom:3px solid #f28c28;padding-bottom:10px;font-size:22px">Nouveau message depuis LeJapon.ma</h1>
        <p style="color:#4b4642">Moroccan Express Travel and Events</p>
        <table style="width:100%;border-collapse:collapse;margin-top:16px;font-size:14px">
          <tr><td style="padding:8px 0;color:#666;width:130px">Nom</td><td><strong>${escapeHtml(contact.name)}</strong></td></tr>
          <tr><td style="padding:8px 0;color:#666">Email</td><td><a href="mailto:${escapeHtml(contact.email)}">${escapeHtml(contact.email)}</a></td></tr>
          <tr><td style="padding:8px 0;color:#666">Téléphone</td><td>${escapeHtml(contact.phone)}</td></tr>
          <tr><td style="padding:8px 0;color:#666">Sujet</td><td>${escapeHtml(contact.subject)}</td></tr>
          <tr><td style="padding:8px 0;color:#666">Date d'envoi</td><td>${escapeHtml(sentAt)}</td></tr>
        </table>
        <div style="margin-top:20px;padding:16px;background:#f8f5ef;border-radius:6px;white-space:pre-wrap;line-height:1.6">${escapeHtml(contact.message)}</div>
        <p style="margin-top:24px;font-size:12px;color:#888">Email interne automatique. Ne pas transférer au client.</p>
      </div>`;
    const text = `Nouveau message depuis LeJapon.ma\n\nNom: ${contact.name}\nEmail: ${contact.email}\nTéléphone: ${contact.phone ?? "—"}\nSujet: ${contact.subject ?? "—"}\nDate: ${sentAt}\n\nMessage:\n${contact.message}`;

    try {
      const smtp = smtpConfig();
      const client = new SMTPClient({ connection: smtp.connection });
      await client.send({
        from: `LeJapon.ma / Moroccan Express <${smtp.from}>`,
        to: recipient,
        replyTo: contact.email,
        subject: emailSubject,
        html,
        content: text,
      });
      await client.close();
      await updateLog(admin, logId, "sent");
      console.info("[contact-email] sent", { contactId: contact.id, logId });
      return new Response(JSON.stringify({ ok: true, contact_id: contact.id, notification_sent: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (sendError) {
      const errorMessage = sendError instanceof Error ? sendError.message : String(sendError);
      await updateLog(admin, logId, "failed", errorMessage);
      console.error("[contact-email] notification failed but contact was saved", { contactId: contact.id, logId, error: errorMessage });
      return new Response(JSON.stringify({ ok: true, contact_id: contact.id, notification_sent: false, error: errorMessage }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } catch (e) {
    console.error("[contact-email] request failed", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
