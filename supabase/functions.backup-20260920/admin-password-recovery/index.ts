import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const baseCorsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_MAX_PER_EMAIL = 5;
const RATE_LIMIT_MAX_PER_IP = 25;
const rateLimitHits = new Map<string, { count: number; resetAt: number }>();

const GENERIC_MESSAGE = "Si un compte admin existe avec cette adresse, un email vous sera envoyé.";
const CANONICAL_SITE_URL = "https://lejapon.ma";
const ADMIN_RECOVERY_PATH = "/admin/nouveau-mot-de-passe";
const INTERNAL_ADMIN_RECOVERY_ROLES = new Set([
  "super_admin",
  "admin",
  "manager",
  "sales",
  "sales_user",
  "sales_manager",
  "agent",
  "content_manager",
  "marketing_manager",
]);

const allowedOrigins = () => {
  const configured = (Deno.env.get("ADMIN_RECOVERY_ALLOWED_ORIGINS") || "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter(Boolean);
  return Array.from(new Set([CANONICAL_SITE_URL, "https://www.lejapon.ma", ...configured]));
};

const corsHeadersFor = (req: Request): Record<string, string> => {
  const origin = (req.headers.get("origin") || "").replace(/\/$/, "");
  if (!origin) return { ...baseCorsHeaders, "Access-Control-Allow-Origin": CANONICAL_SITE_URL };
  if (allowedOrigins().includes(origin)) return { ...baseCorsHeaders, "Access-Control-Allow-Origin": origin, Vary: "Origin" };
  return { ...baseCorsHeaders, Vary: "Origin" };
};

const json = (payload: Record<string, unknown>, status = 200, headers: Record<string, string>) =>
  new Response(JSON.stringify(payload), { status, headers: { ...headers, "Content-Type": "application/json" } });

const genericSuccess = (headers: Record<string, string>) => json({ ok: true, message: GENERIC_MESSAGE }, 200, headers);
const normalizeEmail = (value: unknown) => String(value ?? "").trim().toLowerCase();
const isEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const normalizeHostname = (value: unknown) =>
  String(value ?? "").trim().replace(/^smtp:\/\//i, "").replace(/^https?:\/\//i, "").replace(/\/.*$/, "").trim().toLowerCase();
const escapeHtml = (value: unknown) =>
  String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function clientIp(req: Request) {
  const forwarded = req.headers.get("x-forwarded-for") || "";
  return forwarded.split(",")[0]?.trim() || req.headers.get("cf-connecting-ip") || "unknown";
}

function hitRateLimit(key: string, maxHits: number) {
  const now = Date.now();
  const current = rateLimitHits.get(key);
  if (!current || current.resetAt <= now) {
    rateLimitHits.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  current.count += 1;
  return current.count > maxHits;
}

function isRateLimited(req: Request, email: string) {
  const ip = clientIp(req);
  return hitRateLimit(`ip:${ip}`, RATE_LIMIT_MAX_PER_IP) || hitRateLimit(`email:${email}`, RATE_LIMIT_MAX_PER_EMAIL);
}

function safeErrorDetails(error: unknown) {
  if (!error) return "unknown_error";
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (typeof error === "object") {
    const record = error as Record<string, unknown>;
    return String(record.message || record.error_description || record.details || record.code || "unknown_error");
  }
  return String(error);
}

function logStep(step: string, data: Record<string, unknown> = {}) {
  console.log("[admin-password-recovery]", { step, function_version: "2026-07-11.1", ...data });
}

function logError(step: string, error: unknown, data: Record<string, unknown> = {}) {
  console.error("[admin-password-recovery]", {
    step,
    function_version: "2026-07-11.1",
    detail: safeErrorDetails(error),
    ...data,
  });
}

function emailDomain(email: string) {
  return email.split("@")[1] || "unknown";
}

async function findAuthUserByEmail(admin: any, email: string) {
  const normalized = normalizeEmail(email);
  let page = 1;
  const perPage = 1000;
  while (page <= 20) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const users = data?.users ?? [];
    const found = users.find((user: any) => normalizeEmail(user.email) === normalized);
    if (found) return found;
    if (users.length < perPage) break;
    page += 1;
  }
  return null;
}

async function userHasAdminRecoveryRole(admin: any, userId: string) {
  const { data, error } = await admin.from("user_roles").select("role").eq("user_id", userId);
  if (error) throw error;
  const roles = (data ?? []).map((row: any) => String(row.role ?? ""));
  return roles.some((role: string) => INTERNAL_ADMIN_RECOVERY_ROLES.has(role));
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
      hostname: normalizeHostname(settings.smtp_host),
      port: Number(settings.smtp_port) || 465,
      secure: String(settings.smtp_secure || "ssl"),
      username: normalizeEmail(settings.smtp_username),
      password: String(settings.smtp_password ?? ""),
      from: normalizeEmail(settings.from_email) || "info@lejapon.ma",
      fromName: String(settings.from_name || "LeJapon.ma").trim(),
      replyTo: normalizeEmail(settings.reply_to) || "info@lejapon.ma",
    }
    : {
      hostname: normalizeHostname(Deno.env.get("SMTP_HOST")),
      port: Number(Deno.env.get("SMTP_PORT") || 465),
      secure: Number(Deno.env.get("SMTP_PORT") || 465) === 465 ? "ssl" : "starttls",
      username: normalizeEmail(Deno.env.get("SMTP_USER")),
      password: String(Deno.env.get("SMTP_PASS") ?? ""),
      from: normalizeEmail(Deno.env.get("EMAIL_FROM") || Deno.env.get("SMTP_FROM")) || "info@lejapon.ma",
      fromName: "LeJapon.ma",
      replyTo: "info@lejapon.ma",
    };

  const missing = [
    ["SMTP_HOST", config.hostname],
    ["SMTP_USER", config.username],
    ["SMTP_PASS", config.password],
    ["SMTP_FROM", config.from],
  ].filter(([, value]) => !value).map(([key]) => key);
  if (missing.length) throw new Error(`Missing SMTP settings: ${missing.join(", ")}`);

  return {
    connection: {
      hostname: config.hostname,
      port: config.port,
      tls: config.secure === "ssl",
      auth: { username: config.username, password: config.password },
    },
    from: "info@lejapon.ma",
    fromName: "LeJapon.ma",
    replyTo: config.replyTo,
  };
}

async function fetchEmailTemplate(admin: any, key: string, language = "fr") {
  const byKey = await admin.from("email_templates").select("*").eq("key", key).eq("language", language).limit(1).maybeSingle();
  if (!byKey.error && byKey.data) return byKey.data;
  const byName = await admin.from("email_templates").select("*").eq("name", key).eq("language", language).limit(1).maybeSingle();
  if (!byName.error && byName.data) return byName.data;
  return null;
}

const renderTemplateString = (content: unknown, variables: Record<string, unknown>) =>
  String(content ?? "").replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, key) => {
    const value = variables[key];
    return value === null || value === undefined || value === "" ? "" : String(value);
  });

function defaultEmailHtml(recoveryLink: string) {
  return `
    <div style="margin:0;padding:0;background:#f6f3ef;font-family:Arial,Helvetica,sans-serif;color:#171412">
      <div style="max-width:640px;margin:0 auto;padding:28px 14px">
        <div style="padding:0 0 16px;text-align:center">
          <div style="font-size:26px;font-weight:800;color:#E21B2D">LeJapon.ma</div>
          <div style="margin-top:4px;font-size:12px;color:#766f68">Administration sécurisée</div>
        </div>
        <div style="background:#ffffff;border-radius:18px;border:1px solid #eadfd7;padding:28px">
          <h1 style="margin:0 0 16px;font-size:23px;line-height:1.3;color:#171412">Réinitialisation mot de passe admin</h1>
          <p style="font-size:15px;line-height:1.7;margin:0 0 20px;color:#3a3531">
            Utilisez ce lien pour créer un nouveau mot de passe pour votre espace administration LeJapon.ma.
          </p>
          <p style="margin:28px 0">
            <a href="${escapeHtml(recoveryLink)}" style="display:inline-block;background:#E21B2D;color:#ffffff;text-decoration:none;padding:13px 18px;border-radius:10px;font-weight:700">
              Créer un nouveau mot de passe
            </a>
          </p>
          <p style="font-size:13px;line-height:1.6;margin:0;color:#6b625c">
            Si vous n'avez pas demandé cette opération, ignorez cet email et vérifiez votre compte.
          </p>
        </div>
      </div>
    </div>
  `;
}

async function renderRecoveryEmail(admin: any, variables: Record<string, unknown>) {
  const fallback = {
    subject: "Réinitialisation mot de passe admin — LeJapon.ma",
    html: defaultEmailHtml(String(variables.recovery_link)),
    text: `Réinitialisez votre mot de passe admin LeJapon.ma : ${variables.recovery_link}\n\nSi vous n'avez pas demandé cette opération, ignorez cet email.`,
  };
  const template = await fetchEmailTemplate(admin, "admin_password_recovery");
  const isActive = template?.is_active ?? template?.is_system ?? true;
  const html = template?.body_html ?? template?.html_body;
  if (!template || isActive === false || !template.subject || !html) return fallback;
  return {
    subject: renderTemplateString(template.subject, variables),
    html: renderTemplateString(html, variables),
    text: renderTemplateString(template.body_text ?? template.preheader ?? fallback.text, variables),
  };
}

Deno.serve(async (req) => {
  const responseCorsHeaders = corsHeadersFor(req);
  const requestOrigin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { headers: responseCorsHeaders });
  if (requestOrigin && !responseCorsHeaders["Access-Control-Allow-Origin"]) {
    return json({ ok: false, message: "Origin not allowed." }, 403, responseCorsHeaders);
  }
  if (req.method !== "POST") return json({ ok: false, message: "Method not allowed." }, 405, responseCorsHeaders);

  try {
    const body = await req.json().catch(() => ({}));
    const email = normalizeEmail((body as Record<string, unknown>).email);
    if (!email || !isEmail(email)) return json({ ok: false, message: "Adresse email invalide." }, 400, responseCorsHeaders);
    if (isRateLimited(req, email)) {
      logStep("rate_limited", { domain: emailDomain(email) });
      return genericSuccess(responseCorsHeaders);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      logError("configuration_missing", "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY", { domain: emailDomain(email) });
      return genericSuccess(responseCorsHeaders);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const authUser = await findAuthUserByEmail(admin, email);
    if (!authUser) {
      logStep("unknown_email_generic_response", { domain: emailDomain(email) });
      return genericSuccess(responseCorsHeaders);
    }

    const allowedAdmin = await userHasAdminRecoveryRole(admin, authUser.id);
    if (!allowedAdmin) {
      logStep("recovery_blocked_non_admin_user", { domain: emailDomain(email), user_id: authUser.id });
      return genericSuccess(responseCorsHeaders);
    }

    const generated = await admin.auth.admin.generateLink({ type: "recovery", email });
    if (generated.error) {
      logError("generate_link_failed", generated.error, { domain: emailDomain(email), user_id: authUser.id });
      return genericSuccess(responseCorsHeaders);
    }

    const tokenHash = generated.data?.properties?.hashed_token;
    if (!tokenHash) {
      logError("missing_hashed_token", "generateLink returned no hashed_token", { domain: emailDomain(email), user_id: authUser.id });
      return genericSuccess(responseCorsHeaders);
    }

    const recoveryLink = `${CANONICAL_SITE_URL}${ADMIN_RECOVERY_PATH}?token_hash=${encodeURIComponent(tokenHash)}&type=recovery`;
    const emailPayload = await renderRecoveryEmail(admin, { recovery_link: recoveryLink, login_link: `${CANONICAL_SITE_URL}/admin/login` });
    const smtp = await smtpConfig(admin);
    const client = new SMTPClient({ connection: smtp.connection });
    await client.send({
      from: `${smtp.fromName} <${smtp.from}>`,
      to: email,
      replyTo: smtp.replyTo,
      subject: emailPayload.subject,
      content: emailPayload.text,
      html: emailPayload.html,
    });
    await client.close();

    logStep("email_sent", { domain: emailDomain(email), user_id: authUser.id });
    return genericSuccess(responseCorsHeaders);
  } catch (error) {
    logError("unhandled_error", error);
    return genericSuccess(responseCorsHeaders);
  }
});
