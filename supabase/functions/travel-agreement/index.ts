import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import nodemailer from "npm:nodemailer@6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type LogStatus = "pending" | "sent" | "failed";

type DebugIssue = {
  step: string;
  code: string;
  message: string;
};

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

function strictPublicSiteUrl() {
  const raw = Deno.env.get("PUBLIC_SITE_URL") || Deno.env.get("SITE_URL");
  if (!raw) return null;
  return raw.replace(/\/$/, "");
}

function initSupabaseAdminClient() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl) throw httpError(500, "missing_supabase_url", "Configuration Supabase manquante: SUPABASE_URL.");
  if (!serviceRoleKey) throw httpError(500, "missing_service_role_key", "Configuration Supabase manquante: SUPABASE_SERVICE_ROLE_KEY.");
  return createClient(supabaseUrl, serviceRoleKey);
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

  if (error) {
    throw httpError(
      500,
      "email_settings_query_failed",
      "Erreur lecture configuration email.",
      error,
    );
  }

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
  if (missing.length) {
    throw httpError(
      500,
      "email_configuration_missing",
      "Configuration email absente ou incomplète.",
      `Champs manquants: ${missing.join(", ")}`,
    );
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
    if (error instanceof HttpError) {
      await updateLog(admin, logId, "failed", `${error.code}: ${error.message}`);
      return { ok: false, log_id: logId, code: error.code, error: error.message, details: error.detail };
    }
    const message = error instanceof Error ? error.message : String(error);
    await updateLog(admin, logId, "failed", message);
    return { ok: false, log_id: logId, code: "email_provider_failed", error: message };
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

const stringifyDetail = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

class HttpError extends Error {
  status: number;
  code: string;
  detail?: unknown;

  constructor(status: number, code: string, message: string, detail?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

class StepFailure extends Error {
  step: string;
  originalError: unknown;

  constructor(step: string, originalError: unknown) {
    super(`step_failed:${step}`);
    this.step = step;
    this.originalError = originalError;
  }
}

const httpError = (status: number, code: string, message: string, detail?: unknown) =>
  new HttpError(status, code, message, detail);

async function runStep<T>(stepName: string, fn: () => Promise<T> | T): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    console.error("[travel-agreement] step failed", {
      step: stepName,
      message: safeErrorDetails(error),
    });
    if (error instanceof HttpError) throw error;
    throw new StepFailure(stepName, error);
  }
}

const jsonResponse = (payload: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const jsonError = (message: string, code: string, status = 400, details: unknown = null) =>
  jsonResponse({
    ok: false,
    message,
    code,
    details: safeErrorDetail(details) ?? null,
  }, status);

const safeErrorDetail = (value: unknown) => {
  const message = String(stringifyDetail(value) ?? "").trim();
  if (!message) return undefined;
  return message
    .replace(/(apikey|api_key|authorization|bearer|token|password|secret|service_role)[^,\s]*/gi, "$1:[hidden]")
    .slice(0, 500);
};

function safeErrorDetails(error: unknown) {
  if (error instanceof HttpError) {
    return safeErrorDetail({
      code: error.code,
      message: error.message,
      details: error.detail,
    }) ?? error.message;
  }
  const record = error && typeof error === "object" ? error as Record<string, unknown> : null;
  const details = record
    ? {
      message: record.message,
      code: record.code,
      details: record.details,
      hint: record.hint,
      error: record.error,
    }
    : error;
  return safeErrorDetail(details) ?? String(error ?? "unknown_error");
}

const errorPayload = (error: unknown) => {
  if (error instanceof HttpError) {
    return {
      status: error.status,
      body: {
        ok: false,
        message: error.message,
        code: error.code,
        details: safeErrorDetail(error.detail) ?? null,
      },
    };
  }
  if (error instanceof StepFailure) {
    const original = error.originalError;
    const originalCode = original && typeof original === "object" ? String((original as any).code ?? "") : "";
    const status = originalCode === "PGRST116" ? 404 : 500;
    return {
      status,
      body: {
        ok: false,
        message: `Erreur interne pendant ${error.step}.`,
        code: `${error.step}_failed`,
        details: safeErrorDetails(original),
      },
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  const code = message === "unauthorized"
    ? "unauthorized"
    : message === "forbidden"
      ? "forbidden"
      : "internal_unhandled_error";
  const status = code === "unauthorized" ? 401 : code === "forbidden" ? 403 : 500;
  return {
    status,
    body: {
      ok: false,
      message: code === "internal_unhandled_error" ? "Erreur interne inattendue pendant le traitement de l'accord de voyage." : message,
      code,
      details: safeErrorDetails(error),
    },
  };
};

const logStep = (step: string, details: Record<string, unknown> = {}) => {
  console.info("[travel-agreement]", step, details);
};

const validEmail = (value: unknown) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));
const emailDomain = (value: unknown) => normalizeEmail(value).split("@")[1] || null;

const schemaMismatch = (error: unknown) => {
  const text = safeErrorDetails(error).toLowerCase();
  return /column|relation|schema cache|does not exist|pgrst204|pgrst205|42703|42p01/.test(text);
};

async function loadAgreementForSend(admin: any, agreementId: string, options: { strict?: boolean } = {}) {
  const strict = options.strict !== false;
  const { data: agreement, error } = await runStep("agreement_query", () =>
    admin
      .from("travel_agreements")
      .select("*")
      .eq("id", agreementId)
      .maybeSingle()
  );
  if (error) {
    throw httpError(
      schemaMismatch(error) ? 500 : 500,
      schemaMismatch(error) ? "schema_mismatch" : "agreement_query_failed",
      schemaMismatch(error) ? "La fonction cherche une colonne qui n’existe pas en production." : "Erreur lecture accord.",
      error,
    );
  }
  if (!agreement) throw httpError(404, "agreement_not_found", "Accord de voyage introuvable.");

  let booking: any = null;
  let client: any = null;
  let leadParticipant: any = null;

  if (agreement.booking_id) {
    const { data: bookingRow, error: bookingError } = await runStep("booking_query", () =>
      admin
        .from("bookings")
        .select("id,client_id,contact_email,contact_name,reference")
        .eq("id", agreement.booking_id)
        .maybeSingle()
    );
    if (bookingError && strict) {
      throw httpError(
        schemaMismatch(bookingError) ? 500 : 500,
        schemaMismatch(bookingError) ? "schema_mismatch" : "booking_query_failed",
        schemaMismatch(bookingError) ? "La fonction cherche une colonne qui n’existe pas en production." : "Erreur lecture réservation.",
        bookingError,
      );
    }
    if (bookingError) console.warn("[travel-agreement] booking lookup failed", safeErrorDetails(bookingError));
    booking = bookingRow ?? null;

    if (booking?.client_id) {
      const { data: clientRow, error: clientError } = await runStep("client_email_lookup", () =>
        admin
          .from("clients")
          .select("id,email,full_name")
          .eq("id", booking.client_id)
          .maybeSingle()
      );
      if (clientError && strict) {
        throw httpError(
          schemaMismatch(clientError) ? 500 : 500,
          schemaMismatch(clientError) ? "schema_mismatch" : "client_email_lookup_failed",
          schemaMismatch(clientError) ? "La fonction cherche une colonne qui n’existe pas en production." : "Erreur recherche email client.",
          clientError,
        );
      }
      if (clientError) console.warn("[travel-agreement] client lookup failed", safeErrorDetails(clientError));
      client = clientRow ?? null;
    }

    const { data: participantRow, error: participantError } = await runStep("participant_email_lookup", () =>
      admin
        .from("booking_participants")
        .select("id,email,is_lead")
        .eq("booking_id", agreement.booking_id)
        .order("is_lead", { ascending: false })
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle()
    );
    if (participantError && strict && schemaMismatch(participantError)) {
      throw httpError(
        500,
        "schema_mismatch",
        "La fonction cherche une colonne qui n’existe pas en production.",
        participantError,
      );
    }
    if (participantError) console.warn("[travel-agreement] participant lookup failed", safeErrorDetails(participantError));
    leadParticipant = participantRow ?? null;
  }

  const recipient = normalizeEmail(
    agreement.client_email ||
    client?.email ||
    booking?.contact_email ||
    leadParticipant?.email ||
    "",
  );

  return { agreement, booking, client, leadParticipant, recipient };
}

async function emailConfigDiagnostics(admin: any) {
  const errors: DebugIssue[] = [];
  const warnings: DebugIssue[] = [];
  const { data: settings, error } = await admin
    .from("email_settings")
    .select("id,smtp_host,smtp_port,smtp_username,smtp_password,from_email,is_active")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  if (!error && settings) {
    const complete = Boolean(settings.smtp_host && settings.smtp_username && settings.smtp_password && settings.from_email);
    if (!complete) {
      warnings.push({
        step: "email_configuration",
        code: "email_configuration_missing",
        message: "Une configuration email active existe mais elle est incomplète.",
      });
    }
    return { hasEmailConfig: complete, emailTransport: "smtp", warnings, errors };
  }
  if (error) {
    errors.push({
      step: "email_settings_query",
      code: schemaMismatch(error) ? "schema_mismatch" : "email_settings_query_failed",
      message: safeErrorDetails(error),
    });
  }
  const envComplete = Boolean(
    Deno.env.get("SMTP_HOST") &&
    Deno.env.get("SMTP_USER") &&
    Deno.env.get("SMTP_PASS") &&
    (Deno.env.get("EMAIL_FROM") || Deno.env.get("SMTP_FROM"))
  );
  return {
    hasEmailConfig: envComplete,
    emailTransport: envComplete ? "smtp" : "none",
    warnings,
    errors,
  };
}

function debugIssueFromError(step: string, error: unknown): DebugIssue {
  const payload = errorPayload(error);
  return {
    step,
    code: String(payload.body.code ?? `${step}_failed`),
    message: String(payload.body.details || payload.body.message || safeErrorDetails(error)),
  };
}

const hasAgreementContent = (agreement: any) =>
  Boolean(agreement?.content && Array.isArray(agreement.content.sections) && agreement.content.sections.length > 0);

async function collectSendRequirements(admin: any, agreementId: string) {
  const checks = {
    agreementFound: false,
    hasBookingId: false,
    bookingFound: false,
    hasClientEmail: false,
    clientEmailValid: false,
    hasSecureToken: false,
    hasContent: false,
    hasPublicSiteUrl: false,
    hasEmailConfig: false,
    emailTransport: "none",
    canBuildEmail: false,
  };
  const missing: string[] = [];
  const warnings: DebugIssue[] = [];
  const errors: DebugIssue[] = [];

  try {
    const { agreement, booking, recipient } = await loadAgreementForSend(admin, agreementId, { strict: false });
    checks.agreementFound = true;
    checks.hasBookingId = Boolean(agreement.booking_id);
    checks.bookingFound = !agreement.booking_id || Boolean(booking);
    checks.hasClientEmail = Boolean(recipient);
    checks.clientEmailValid = validEmail(recipient);
    checks.hasSecureToken = Boolean(agreement.secure_token);
    checks.hasContent = hasAgreementContent(agreement);
  } catch (error) {
    errors.push(debugIssueFromError("agreement_lookup", error));
  }

  try {
    const emailDiagnostics = await emailConfigDiagnostics(admin);
    checks.hasEmailConfig = emailDiagnostics.hasEmailConfig;
    checks.emailTransport = emailDiagnostics.emailTransport;
    warnings.push(...emailDiagnostics.warnings);
    errors.push(...emailDiagnostics.errors);
  } catch (error) {
    errors.push(debugIssueFromError("email_settings_query", error));
  }

  checks.hasPublicSiteUrl = Boolean(strictPublicSiteUrl());
  checks.canBuildEmail = Boolean(
    checks.agreementFound &&
    checks.hasBookingId &&
    checks.bookingFound &&
    checks.clientEmailValid &&
    checks.hasSecureToken &&
    checks.hasContent &&
    checks.hasPublicSiteUrl &&
    checks.hasEmailConfig
  );

  if (!checks.agreementFound) missing.push("agreement");
  if (!checks.hasBookingId) missing.push("booking_id");
  if (!checks.bookingFound) missing.push("booking");
  if (!checks.hasClientEmail) missing.push("client_email");
  if (checks.hasClientEmail && !checks.clientEmailValid) missing.push("client_email_invalid");
  if (!checks.hasSecureToken) missing.push("secure_token");
  if (!checks.hasContent) missing.push("content");
  if (!checks.hasPublicSiteUrl) missing.push("public_site_url");
  if (!checks.hasEmailConfig) missing.push("email_config");

  return {
    ok: errors.length === 0,
    checks,
    missing: Array.from(new Set(missing)),
    warnings,
    errors,
  };
}

async function sendRequirementChecks(admin: any, agreementId: string) {
  const diagnostics = await collectSendRequirements(admin, agreementId);
  return {
    ok: diagnostics.ok,
    checks: diagnostics.checks,
    missing: diagnostics.missing,
    warnings: diagnostics.warnings,
    errors: diagnostics.errors,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  let requestAction = "";
  let requestAgreementId = "";
  try {
    const admin = await runStep("supabase_client_init", () => initSupabaseAdminClient());
    const body = await runStep("payload_parse", async () => req.json());
    const action = String(body.action ?? "");
    requestAction = action;
    requestAgreementId = String(body.agreement_id ?? "").trim();
    logStep("payload_received", {
      action,
      agreement_id: requestAgreementId || null,
      has_token: Boolean(body.token),
      has_pdf: Boolean(body.pdf_base64),
    });

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
      if (!token) throw httpError(400, "missing_token", "Token public de l'accord manquant.");
      const agreement = await agreementByToken(admin, token);
      if (agreement.status !== "accepted") throw httpError(400, "agreement_not_accepted", "L'accord doit être accepté avant de stocker le PDF final.");
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
      logStep("send:start", { agreement_id: requestAgreementId || null });
      await runStep("staff_authorization", () => requireStaff(req, admin));
      if (!requestAgreementId) throw httpError(400, "missing_agreement_id", "Identifiant de l'accord manquant.");
      const { agreement, booking, client, recipient } = await runStep("load_agreement_context", () =>
        loadAgreementForSend(admin, requestAgreementId, { strict: true })
      );
      const hasContent = Boolean(agreement.content && Array.isArray(agreement.content.sections) && agreement.content.sections.length > 0);
      logStep("send:agreement_loaded", {
        agreement_id: agreement.id,
        hasBookingId: Boolean(agreement.booking_id),
        hasClientEmail: Boolean(recipient),
        hasSecureToken: Boolean(agreement.secure_token),
        hasContent,
      });
      if (!agreement.booking_id) throw httpError(400, "missing_booking_id", "Cet accord n’est lié à aucune réservation.");
      if (!recipient) throw httpError(400, "missing_client_email", "Email client absent sur cet accord ou cette réservation.");
      if (!validEmail(recipient)) throw httpError(400, "invalid_client_email", "Email client invalide.");
      if (!agreement.secure_token) throw httpError(400, "missing_secure_token", "Lien sécurisé de l'accord manquant.");
      if (!hasContent) throw httpError(400, "missing_agreement_content", "Contenu de l'accord de voyage vide ou incomplet.");
      const siteUrl = strictPublicSiteUrl();
      if (!siteUrl) throw httpError(500, "public_site_url_missing", "URL publique du site absente. Impossible de générer le lien de l'accord.");

      const link = `${siteUrl}/accord-voyage/${agreement.secure_token}`;
      logStep("send:email_ready", {
        agreement_id: agreement.id,
        toDomain: emailDomain(recipient),
        hasPublicUrl: Boolean(siteUrl),
      });
      const variables = {
        agreement_id: agreement.id,
        client_name: agreement.client_name || client?.full_name || booking?.contact_name || "Client",
        participant_first_name: String(agreement.client_name || client?.full_name || booking?.contact_name || "").split(/\s+/)[0] || "",
        booking_reference: agreement.booking_reference || booking?.reference,
        trip_title: agreement.trip_title,
        trip_name: agreement.trip_title,
        agreement_link: link,
      };
      const result = await runStep("send_email", () => sendTemplatedEmail(admin, {
        templateKey: "travel_agreement_sent_client",
        recipient,
        variables,
        fallbackSubject: `Votre accord de voyage — ${agreement.trip_title || "LeJapon.ma"}`,
        fallbackHtml: `<p>Bonjour ${escapeHtml(variables.client_name)},</p><p>Votre accord de voyage est prêt.</p><p><a href="${escapeHtml(link)}">Lire et accepter mon accord de voyage</a></p>`,
        fallbackText: `Bonjour ${variables.client_name || ""},\n\nVotre accord de voyage est prêt.\n${link}`,
        eventType: "travel_agreement_sent_client",
        bookingId: agreement.booking_id,
      }));
      if (!result.ok) {
        const resultCode = String((result as any).code || "");
        const resultError = String((result as any).error || "email_send_failed");
        if (resultCode === "email_settings_query_failed") {
          throw httpError(500, "email_settings_query_failed", "Erreur lecture configuration email.", (result as any).details || resultError);
        }
        if (resultCode === "email_configuration_missing" || /missing smtp settings/i.test(resultError)) {
          throw httpError(500, "email_configuration_missing", "Configuration email absente ou incomplète.", (result as any).details || resultError);
        }
        if (resultCode === "email_transport_not_supported") {
          throw httpError(500, "email_transport_not_supported", "Le transport SMTP/Nodemailer n’est pas compatible ou pas configuré dans l’Edge Runtime.", resultError);
        }
        throw httpError(502, "email_provider_failed", "Le fournisseur email a refusé l’envoi.", (result as any).details || resultError);
      }
      const now = new Date().toISOString();
      const { data: updated, error: updateError } = await runStep("agreement_update", () =>
        admin
          .from("travel_agreements")
          .update({ status: "sent", sent_at: now, client_email: agreement.client_email || recipient })
          .eq("id", agreement.id)
          .select("*")
          .single()
      );
      if (updateError) throw httpError(500, "agreement_update_failed", "Erreur mise à jour du statut de l'accord.", updateError);
      logStep("send:success", {
        agreement_id: agreement.id,
      });
      return jsonResponse({ ok: true, agreement: updated, email: result });
    }

    if (action === "debug_send_requirements") {
      await runStep("staff_authorization", () => requireStaff(req, admin));
      if (!requestAgreementId) throw httpError(400, "missing_agreement_id", "Identifiant de l'accord manquant.");
      const diagnostics = await sendRequirementChecks(admin, requestAgreementId);
      return jsonResponse(diagnostics);
    }

    throw httpError(400, "unknown_action", "Action travel-agreement inconnue.");
  } catch (error) {
    const { status, body } = errorPayload(error);
    if (requestAction === "send") {
      console.error("[travel-agreement] send:error", {
        agreement_id: requestAgreementId || null,
        code: body.code,
        message: body.message,
        status,
      });
    } else {
      console.warn("[travel-agreement] error", body);
    }
    return jsonResponse(body, status);
  }
});
