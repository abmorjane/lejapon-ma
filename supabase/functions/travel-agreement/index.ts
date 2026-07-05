import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import nodemailer from "npm:nodemailer@6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type LogStatus = "pending" | "sent" | "failed";

const escapeHtml = (value: unknown) =>
  String(value ?? "—")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const renderTemplateString = (content: unknown, variables: Record<string, unknown>) =>
  String(content ?? "").replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, key) => {
    const value = variables[key];
    return value === null || value === undefined || value === "" ? "—" : String(value);
  });

const normalizeEmail = (value: unknown) => String(value ?? "").trim().toLowerCase();

function adminBaseUrl() {
  return (Deno.env.get("ADMIN_BASE_URL") || Deno.env.get("SITE_URL") || "https://www.lejapon.ma").replace(/\/$/, "");
}

function publicSiteUrl() {
  return (Deno.env.get("PUBLIC_SITE_URL") || Deno.env.get("SITE_URL") || "https://www.lejapon.ma").replace(/\/$/, "");
}

const ACCEPTANCE_STATEMENT =
  "J'ai lu et compris le présent accord de voyage. J'en accepte les conditions et je m'engage à respecter les règles d'organisation du voyage.";

function adminRecipients() {
  const raw = Deno.env.get("ADMIN_NOTIFICATION_EMAILS") || Deno.env.get("ADMIN_NOTIFICATION_EMAIL") || "info@lejapon.ma";
  return raw
    .split(",")
    .map((email) => normalizeEmail(email))
    .filter((email, index, list) => email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && list.indexOf(email) === index);
}

function clientIp(req: Request) {
  const raw = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || req.headers.get("cf-connecting-ip") || "";
  const first = raw.split(",")[0]?.trim();
  return first && /^[a-f0-9:.]+$/i.test(first) ? first : null;
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
      hostname: String(settings.smtp_host ?? "").replace(/^https?:\/\//i, "").replace(/^smtp:\/\//i, "").replace(/\/.*$/, ""),
      port: Number(settings.smtp_port) || 465,
      secure: String(settings.smtp_secure || "ssl"),
      username: normalizeEmail(settings.smtp_username),
      password: String(settings.smtp_password ?? ""),
      from: normalizeEmail(settings.from_email),
      fromName: String(settings.from_name || "LeJapon.ma / Moroccan Express Travel and Events").trim(),
      replyTo: normalizeEmail(settings.reply_to) || undefined,
    }
    : {
      hostname: String(Deno.env.get("SMTP_HOST") ?? ""),
      port: Number(Deno.env.get("SMTP_PORT") || 465),
      secure: Number(Deno.env.get("SMTP_PORT") || 465) === 465 ? "ssl" : "starttls",
      username: normalizeEmail(Deno.env.get("SMTP_USER")),
      password: String(Deno.env.get("SMTP_PASS") ?? ""),
      from: normalizeEmail(Deno.env.get("EMAIL_FROM") || Deno.env.get("SMTP_FROM")),
      fromName: "LeJapon.ma / Moroccan Express Travel and Events",
      replyTo: undefined,
    };

  const missing = [
    ["SMTP_HOST", config.hostname],
    ["SMTP_USER", config.username],
    ["SMTP_PASS", config.password],
    ["SMTP_FROM", config.from],
  ].filter(([, value]) => !value).map(([key]) => key);
  if (missing.length) throw new Error(`Missing SMTP settings: ${missing.join(", ")}`);

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

async function fetchEmailTemplate(admin: any, key: string) {
  const { data, error } = await admin
    .from("email_templates")
    .select("*")
    .eq("key", key)
    .eq("language", "fr")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  if (error) console.warn("[travel-agreement] template lookup failed", error.message);
  return data ?? null;
}

async function createLog(admin: any, payload: { event_type: string; recipient: string; subject: string; booking_id?: string | null; metadata?: Record<string, unknown> }, status: LogStatus = "pending", errorMessage?: string) {
  const { data, error } = await admin
    .from("email_logs")
    .insert({
      event_type: payload.event_type,
      recipient: payload.recipient,
      subject: payload.subject,
      status,
      error_message: errorMessage ?? null,
      related_booking_id: payload.booking_id ?? null,
      metadata: payload.metadata ?? {},
      sent_at: status === "sent" ? new Date().toISOString() : null,
    })
    .select("id")
    .single();
  if (error) console.warn("[travel-agreement] email log insert failed", error.message);
  return data?.id as string | undefined;
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
  if (error) console.warn("[travel-agreement] email log update failed", error.message);
}

async function sendTemplatedEmail(admin: any, input: {
  templateKey: string;
  recipient: string;
  variables: Record<string, unknown>;
  fallbackSubject: string;
  fallbackHtml: string;
  fallbackText: string;
  eventType: string;
  bookingId?: string | null;
  attachments?: Array<{ filename: string; content: Uint8Array; contentType: string }>;
}) {
  const recipient = normalizeEmail(input.recipient);
  const template = await fetchEmailTemplate(admin, input.templateKey);
  const subject = renderTemplateString(template?.subject || input.fallbackSubject, input.variables);
  const html = renderTemplateString(template?.body_html || template?.html_body || input.fallbackHtml, input.variables);
  const text = renderTemplateString(template?.body_text || template?.preheader || input.fallbackText, input.variables);
  const logId = await createLog(admin, {
    event_type: input.eventType,
    recipient,
    subject,
    booking_id: input.bookingId,
    metadata: { template_key: input.templateKey, agreement_id: input.variables.agreement_id },
  });

  if (!recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
    await updateLog(admin, logId, "failed", "missing_or_invalid_recipient");
    return { ok: false, log_id: logId, error: "missing_or_invalid_recipient" };
  }

  try {
    const smtp = await smtpConfig(admin);
    const transporter = nodemailer.createTransport(smtp.transport);
    await transporter.sendMail({
      from: `${smtp.fromName} <${smtp.from}>`,
      to: recipient,
      replyTo: smtp.replyTo,
      subject,
      text,
      html,
      attachments: input.attachments,
    });
    transporter.close();
    await updateLog(admin, logId, "sent");
    return { ok: true, log_id: logId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateLog(admin, logId, "failed", message);
    return { ok: false, log_id: logId, error: message };
  }
}

async function requireStaff(req: Request, admin: any) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) throw new Error("unauthorized");
  const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user) throw new Error("unauthorized");
  const { data: isStaff, error: staffError } = await admin.rpc("v2_is_staff", { _user_id: user.id });
  if (staffError) throw staffError;
  if (!isStaff) throw new Error("forbidden");
  return user;
}

async function agreementByToken(admin: any, token: string) {
  const { data, error } = await admin
    .from("travel_agreements")
    .select("*")
    .eq("secure_token", token)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("agreement_not_found");
  return data;
}

async function agreementAcceptance(admin: any, agreementId: string) {
  const { data, error } = await admin
    .from("travel_agreement_acceptances")
    .select("*")
    .eq("agreement_id", agreementId)
    .eq("status", "accepted")
    .order("accepted_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) console.warn("[travel-agreement] acceptance lookup failed", error.message);
  return data ?? null;
}

function enrichedAcceptance(acceptance: any, agreement: any) {
  if (!acceptance) return null;
  const evidence = agreement?.content?.acceptance_evidence ?? {};
  return {
    ...acceptance,
    accepted_first_name: evidence.accepted_first_name ?? null,
    accepted_last_name: evidence.accepted_last_name ?? null,
    accepted_passport_number: evidence.accepted_passport_number ?? null,
  };
}

function decodeBase64Pdf(value: unknown) {
  const raw = String(value ?? "").replace(/^data:application\/pdf;base64,/i, "").trim();
  if (!raw) throw new Error("missing_pdf_base64");
  const binary = atob(raw);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function safeFilename(value: unknown, fallback: string) {
  const name = String(value ?? fallback).trim() || fallback;
  return name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").slice(0, 120);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "");

    if (action === "get") {
      const token = String(body.token ?? "").trim();
      if (!token) throw new Error("missing_token");
      const agreement = await agreementByToken(admin, token);
      if (agreement.status === "sent") {
        const { data } = await admin
          .from("travel_agreements")
          .update({ status: "opened", opened_at: new Date().toISOString() })
          .eq("id", agreement.id)
          .select("*")
          .single();
        Object.assign(agreement, data);
      }
      const acceptance = await agreementAcceptance(admin, agreement.id);
      return new Response(JSON.stringify({ ok: true, agreement, acceptance: enrichedAcceptance(acceptance, agreement) }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "accept") {
      const token = String(body.token ?? "").trim();
      const firstName = String(body.first_name ?? "").trim();
      const lastName = String(body.last_name ?? "").trim();
      const passportNumber = String(body.passport_number ?? "").trim();
      const typedName = [firstName, lastName].filter(Boolean).join(" ").trim();
      if (!token) throw new Error("missing_token");
      if (firstName.length < 2) throw new Error("first_name_required");
      if (lastName.length < 2) throw new Error("last_name_required");
      if (passportNumber.length < 5) throw new Error("passport_number_required");
      const agreement = await agreementByToken(admin, token);
      const existing = await agreementAcceptance(admin, agreement.id);
      if (existing) {
        return new Response(JSON.stringify({ ok: true, agreement, acceptance: enrichedAcceptance(existing, agreement), already_accepted: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const now = new Date().toISOString();
      const { data: acceptance, error: acceptError } = await admin
        .from("travel_agreement_acceptances")
        .insert({
          agreement_id: agreement.id,
          booking_id: agreement.booking_id,
          client_email: normalizeEmail(body.email || agreement.client_email),
          typed_name: typedName,
          ip_address: clientIp(req),
          user_agent: req.headers.get("user-agent"),
          status: "accepted",
          message: ACCEPTANCE_STATEMENT,
          accepted_at: now,
        })
        .select("*")
        .single();
      if (acceptError) throw acceptError;

      const content = agreement.content ?? {};
      const nextContent = {
        ...content,
        acceptance_evidence: {
          ...(content.acceptance_evidence ?? {}),
          accepted_full_name: typedName,
          accepted_first_name: firstName,
          accepted_last_name: lastName,
          accepted_passport_number: passportNumber,
          accepted_at: now,
          agreement_version: content.agreement_version ?? "TRAVEL-AGREEMENT-FR-V2.0",
          agreement_reference: content.agreement_reference ?? agreement.booking_reference ?? agreement.id,
          acceptance_statement: ACCEPTANCE_STATEMENT,
        },
      };

      const { data: updated, error: updateError } = await admin
        .from("travel_agreements")
        .update({ status: "accepted", accepted_at: now, content: nextContent })
        .eq("id", agreement.id)
        .select("*")
        .single();
      if (updateError) throw updateError;

      const adminUrl = `${adminBaseUrl()}/admin/travel-agreements`;
      const agreementLink = `${publicSiteUrl()}/accord-voyage/${agreement.secure_token}`;
      const variables = {
        agreement_id: agreement.id,
        client_name: agreement.client_name,
        participant_first_name: firstName,
        booking_reference: agreement.booking_reference,
        trip_title: agreement.trip_title,
        trip_name: agreement.trip_title,
        typed_name: typedName,
        passport_number: passportNumber,
        accepted_at: new Date(now).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" }),
        admin_link: adminUrl,
        agreement_link: agreementLink,
      };
      const notifications = await Promise.allSettled([
        ...adminRecipients().map((recipient) => sendTemplatedEmail(admin, {
          templateKey: "travel_agreement_accepted_admin",
          recipient,
          variables,
          fallbackSubject: `Accord de voyage accepté — ${agreement.client_name || typedName}`,
          fallbackHtml: `<p><strong>${escapeHtml(agreement.client_name || typedName)}</strong> a accepté son accord de voyage.</p><p><a href="${escapeHtml(adminUrl)}">Ouvrir dans l’admin</a></p>`,
          fallbackText: `Accord de voyage accepté\nClient: ${agreement.client_name || typedName}\nAdmin: ${adminUrl}`,
          eventType: "travel_agreement_accepted_admin",
          bookingId: agreement.booking_id,
        })),
      ]);

      return new Response(JSON.stringify({ ok: true, agreement: updated, acceptance: enrichedAcceptance(acceptance, updated), notifications }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "needs_review") {
      const token = String(body.token ?? "").trim();
      if (!token) throw new Error("missing_token");
      const agreement = await agreementByToken(admin, token);
      const now = new Date().toISOString();
      await admin.from("travel_agreement_acceptances").insert({
        agreement_id: agreement.id,
        booking_id: agreement.booking_id,
        client_email: agreement.client_email,
        typed_name: agreement.client_name || "Client",
        ip_address: clientIp(req),
        user_agent: req.headers.get("user-agent"),
        status: "needs_review",
        message: String(body.message ?? "").trim() || null,
        accepted_at: now,
      });
      const { data: updated, error } = await admin
        .from("travel_agreements")
        .update({ status: "needs_review", declined_at: now })
        .eq("id", agreement.id)
        .select("*")
        .single();
      if (error) throw error;
      return new Response(JSON.stringify({ ok: true, agreement: updated }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "store_final_pdf") {
      const token = String(body.token ?? "").trim();
      if (!token) throw new Error("missing_token");
      const agreement = await agreementByToken(admin, token);
      if (agreement.status !== "accepted") throw new Error("agreement_not_accepted");
      const pdfBytes = decodeBase64Pdf(body.pdf_base64);
      const filename = safeFilename(body.filename, `accord-voyage-${agreement.booking_reference || agreement.id}.pdf`);
      const storagePath = `travel-agreements/${agreement.id}/${filename}`;
      const { error: uploadError } = await admin.storage
        .from("booking-docs")
        .upload(storagePath, pdfBytes, {
          contentType: "application/pdf",
          upsert: true,
        });
      if (uploadError) throw uploadError;

      const now = new Date().toISOString();
      const content = {
        ...(agreement.content ?? {}),
        final_pdf: {
          storage_bucket: "booking-docs",
          storage_path: storagePath,
          filename,
          generated_at: now,
          emailed_at: null,
        },
      };
      const { data: updated, error: updateError } = await admin
        .from("travel_agreements")
        .update({ content })
        .eq("id", agreement.id)
        .select("*")
        .single();
      if (updateError) throw updateError;

      const evidence = updated.content?.acceptance_evidence ?? {};
      const typedName = evidence.accepted_full_name || agreement.client_name || "Participant";
      const agreementLink = `${publicSiteUrl()}/accord-voyage/${agreement.secure_token}`;
      const variables = {
        agreement_id: agreement.id,
        client_name: agreement.client_name || typedName,
        participant_first_name: evidence.accepted_first_name || "",
        booking_reference: agreement.booking_reference,
        trip_title: agreement.trip_title,
        trip_name: agreement.trip_title,
        typed_name: typedName,
        passport_number: evidence.accepted_passport_number || "",
        accepted_at: evidence.accepted_at ? new Date(evidence.accepted_at).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" }) : "—",
        agreement_link: agreementLink,
      };
      const emailResult = agreement.client_email ? await sendTemplatedEmail(admin, {
        templateKey: "travel_agreement_accepted_client",
        recipient: agreement.client_email,
        variables,
        fallbackSubject: `Votre accord de voyage accepté — ${agreement.trip_title || "LeJapon.ma"}`,
        fallbackHtml: `<p>Bonjour ${escapeHtml(agreement.client_name || typedName)},</p><p>Votre accord de voyage accepté est joint à cet email.</p><p><a href="${escapeHtml(agreementLink)}">Relire / télécharger mon accord</a></p>`,
        fallbackText: `Bonjour ${agreement.client_name || typedName},\n\nVotre accord de voyage accepté est joint à cet email.\nRelire / télécharger : ${agreementLink}`,
        eventType: "travel_agreement_accepted_client",
        bookingId: agreement.booking_id,
        attachments: [{ filename, content: pdfBytes, contentType: "application/pdf" }],
      }) : { ok: true, skipped: "missing_client_email" };

      const emailedContent = {
        ...(updated.content ?? {}),
        final_pdf: {
          ...(updated.content?.final_pdf ?? {}),
          emailed_at: (emailResult as any).ok ? new Date().toISOString() : null,
          email_status: (emailResult as any).ok ? "sent" : "failed",
          email_error: (emailResult as any).ok ? null : (emailResult as any).error,
        },
      };
      await admin.from("travel_agreements").update({ content: emailedContent }).eq("id", agreement.id);

      return new Response(JSON.stringify({ ok: true, storage_path: storagePath, email: emailResult }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "send") {
      await requireStaff(req, admin);
      const agreementId = String(body.agreement_id ?? "").trim();
      if (!agreementId) throw new Error("missing_agreement_id");
      const { data: agreement, error } = await admin
        .from("travel_agreements")
        .select("*")
        .eq("id", agreementId)
        .single();
      if (error || !agreement) throw new Error(error?.message || "agreement_not_found");
      if (!agreement.client_email) throw new Error("missing_client_email");

      const link = `${publicSiteUrl()}/accord-voyage/${agreement.secure_token}`;
      const variables = {
        agreement_id: agreement.id,
        client_name: agreement.client_name,
        participant_first_name: String(agreement.client_name ?? "").split(/\s+/)[0] || "",
        booking_reference: agreement.booking_reference,
        trip_title: agreement.trip_title,
        trip_name: agreement.trip_title,
        agreement_link: link,
      };
      const result = await sendTemplatedEmail(admin, {
        templateKey: "travel_agreement_sent_client",
        recipient: agreement.client_email,
        variables,
        fallbackSubject: `Votre accord de voyage — ${agreement.trip_title || "LeJapon.ma"}`,
        fallbackHtml: `<p>Bonjour ${escapeHtml(agreement.client_name)},</p><p>Votre accord de voyage est prêt.</p><p><a href="${escapeHtml(link)}">Lire et accepter mon accord de voyage</a></p>`,
        fallbackText: `Bonjour ${agreement.client_name || ""},\n\nVotre accord de voyage est prêt.\n${link}`,
        eventType: "travel_agreement_sent_client",
        bookingId: agreement.booking_id,
      });
      if (!result.ok) throw new Error(String(result.error || "email_send_failed"));
      const now = new Date().toISOString();
      const { data: updated, error: updateError } = await admin
        .from("travel_agreements")
        .update({ status: "sent", sent_at: now })
        .eq("id", agreement.id)
        .select("*")
        .single();
      if (updateError) throw updateError;
      return new Response(JSON.stringify({ ok: true, agreement: updated, email: result }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    throw new Error("unknown_action");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message === "unauthorized" ? 401 : message === "forbidden" ? 403 : 400;
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
