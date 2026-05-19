import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const RECAPTCHA_SECRET = Deno.env.get("RECAPTCHA_SECRET_KEY") ?? "";

async function verifyRecaptcha(token: string) {
  if (!RECAPTCHA_SECRET) return { ok: true }; // not configured → skip
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

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { name, email, phone, subject, message, recaptchaToken } = await req.json();

    const captcha = await verifyRecaptcha(String(recaptchaToken ?? ""));
    if (!captcha.ok) {
      return new Response(JSON.stringify({ error: "recaptcha_failed", reason: captcha.reason }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!name || !email || !message) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (typeof name !== "string" || name.length > 200) throw new Error("Invalid name");
    if (typeof email !== "string" || email.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Invalid email");
    if (phone && (typeof phone !== "string" || phone.length > 50)) throw new Error("Invalid phone");
    if (subject && (typeof subject !== "string" || subject.length > 200)) throw new Error("Invalid subject");
    if (typeof message !== "string" || message.length > 5000) throw new Error("Invalid message");

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const recipient = Deno.env.get("ADMIN_NOTIFICATION_EMAIL") || "info@lejapon.ma";
    let smtp: ReturnType<typeof smtpConfig>;
    try {
      smtp = smtpConfig();
    } catch (configError) {
      const configMessage = configError instanceof Error ? configError.message : String(configError);
      await logEmail(admin, "contact_message", recipient, "failed", configMessage, { email, name });
      throw configError;
    }

    const client = new SMTPClient({
      connection: smtp.connection,
    });

    const sentAt = new Date().toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });

    const html = `
      <div style="font-family:Arial,sans-serif;color:#1a1a1a;max-width:600px;margin:0 auto">
        <p style="margin:0 0 6px;color:#8a8178;font-size:12px;letter-spacing:.14em;text-transform:uppercase">LeJapon.ma</p>
        <h2 style="border-bottom:2px solid #f28c28;padding-bottom:8px">Nouveau message depuis LeJapon.ma</h2>
        <p style="color:#666">Moroccan Express Travel and Events</p>
        <table style="width:100%;border-collapse:collapse;margin-top:16px">
          <tr><td style="padding:8px 0;color:#666;width:120px">Nom</td><td style="padding:8px 0"><strong>${escapeHtml(name)}</strong></td></tr>
          <tr><td style="padding:8px 0;color:#666">Email</td><td style="padding:8px 0"><a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a></td></tr>
          ${phone ? `<tr><td style="padding:8px 0;color:#666">Téléphone</td><td style="padding:8px 0">${escapeHtml(phone)}</td></tr>` : ""}
          ${subject ? `<tr><td style="padding:8px 0;color:#666">Sujet</td><td style="padding:8px 0">${escapeHtml(subject)}</td></tr>` : ""}
          <tr><td style="padding:8px 0;color:#666">Date d'envoi</td><td style="padding:8px 0">${escapeHtml(sentAt)}</td></tr>
        </table>
        <div style="margin-top:20px;padding:16px;background:#f8f5ef;border-radius:6px;white-space:pre-wrap;line-height:1.6">${escapeHtml(message)}</div>
        <p style="margin-top:24px;font-size:12px;color:#888">Email interne automatique. Ne pas transférer au client.</p>
      </div>`;

    const text = `Nouveau message depuis LeJapon.ma\n\nNom: ${name}\nEmail: ${email}\n${phone ? `Téléphone: ${phone}\n` : ""}${subject ? `Sujet: ${subject}\n` : ""}Date: ${sentAt}\n\nMessage:\n${message}`;

    try {
      await client.send({
        from: `LeJapon.ma / Moroccan Express <${smtp.from}>`,
        to: recipient,
        replyTo: email,
        subject: `Nouveau message depuis LeJapon.ma – ${name}`,
        html,
        content: text,
      });
      await client.close();
      await logEmail(admin, "contact_message", recipient, "sent", undefined, { email, name });
    } catch (sendError) {
      try { await client.close(); } catch { /* noop */ }
      const message = sendError instanceof Error ? sendError.message : String(sendError);
      await logEmail(admin, "contact_message", recipient, "failed", message, { email, name });
      throw sendError;
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("send-contact-email error", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
