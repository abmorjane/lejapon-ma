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

type SignupBody = {
  first_name?: unknown;
  last_name?: unknown;
  email?: unknown;
  password?: unknown;
  passport_no?: unknown;
};

const allowedOrigins = () => {
  const configured = (Deno.env.get("VISA_SIGNUP_ALLOWED_ORIGINS") || "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter(Boolean);
  const siteUrl = (Deno.env.get("SITE_URL") || "https://lejapon.ma").replace(/\/$/, "");
  return Array.from(new Set([siteUrl, "https://lejapon.ma", "https://www.lejapon.ma", ...configured]));
};

const isDevOrigin = (origin: string) => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);

const corsHeadersFor = (req: Request): Record<string, string> => {
  const origin = (req.headers.get("origin") || "").replace(/\/$/, "");
  if (!origin) return { ...baseCorsHeaders, "Access-Control-Allow-Origin": allowedOrigins()[0] };
  if (allowedOrigins().includes(origin) || isDevOrigin(origin)) {
    return { ...baseCorsHeaders, "Access-Control-Allow-Origin": origin, Vary: "Origin" };
  }
  return { ...baseCorsHeaders, Vary: "Origin" };
};

const fallbackCorsHeaders = { ...baseCorsHeaders, "Access-Control-Allow-Origin": "https://lejapon.ma" };

const json = (payload: Record<string, unknown>, status = 200, headers: Record<string, string> = fallbackCorsHeaders) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });

const clean = (value: unknown) => String(value ?? "").trim();
const normalizeEmail = (value: unknown) => clean(value).toLowerCase();
const normalizePassport = (value: unknown) => clean(value).toUpperCase().replace(/\s+/g, "");
const isEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

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
  const ipLimited = hitRateLimit(`ip:${ip}`, RATE_LIMIT_MAX_PER_IP);
  const emailLimited = hitRateLimit(`email:${email}`, RATE_LIMIT_MAX_PER_EMAIL);
  return ipLimited || emailLimited;
}

function safeLogError(scope: string, error: unknown) {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "unknown_error";
  console.error(`[visa-client-signup] ${scope}`, { message });
}

function safeLogWarn(scope: string, error: unknown) {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "unknown_error";
  console.warn(`[visa-client-signup] ${scope}`, { message });
}

const escapeHtml = (value: unknown) =>
  String(value ?? "")
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
    return value === null || value === undefined || value === "" ? "Non renseigné" : sanitizeBranding(value);
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
  return null;
}

const normalizeComparable = (value: unknown) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

function lastNameMatches(value: unknown, lastName: string) {
  const needle = normalizeComparable(lastName);
  if (!needle) return false;
  return normalizeComparable(value).split(/\s+/).includes(needle);
}

function emailMatches(value: unknown, email: string) {
  return Boolean(value && email && normalizeComparable(value) === normalizeComparable(email));
}

async function findAuthUserByEmail(admin: any, email: string) {
  const perPage = 1000;
  let page = 1;
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const found = data.users.find((user: any) => normalizeEmail(user.email) === email);
    if (found) return found;
    if (data.users.length < perPage) return null;
    page += 1;
  }
}

async function lookupPrefillStatus(admin: any, passportNo: string, lastName: string, email: string) {
  if (!passportNo) return "not_requested";

  const { data: participants, error: participantsError } = await admin
    .from("booking_participants")
    .select("id,last_name,email,passport_no")
    .eq("passport_no", passportNo)
    .limit(3);
  if (!participantsError) {
    const safe = (participants ?? []).filter((row: any) => lastNameMatches(row.last_name, lastName) || emailMatches(row.email, email));
    if ((participants ?? []).length > 1 || safe.length > 1) return "multiple_matches";
    if (safe.length === 1) return "found";
  }

  const { data: clients, error: clientsError } = await admin
    .from("clients")
    .select("id,full_name,email,passport_number")
    .eq("passport_number", passportNo)
    .limit(3);
  if (!clientsError) {
    const safe = (clients ?? []).filter((row: any) => lastNameMatches(row.full_name, lastName) || emailMatches(row.email, email));
    if ((clients ?? []).length > 1 || safe.length > 1) return "multiple_matches";
    if (safe.length === 1) return "found";
  }

  return "not_found";
}

async function upsertClient(admin: any, userId: string, firstName: string, lastName: string, email: string, passportNo: string | null) {
  const fullName = `${firstName} ${lastName}`.trim();
  const basePayload: Record<string, unknown> = {
    email,
    source: "visa_signup",
  };
  if (passportNo) basePayload.passport_number = passportNo;

  const byEmail = await admin
    .from("clients")
    .select("id,full_name,email,passport_number,country")
    .eq("email", email)
    .limit(1)
    .maybeSingle();

  let targetClient = byEmail.data ?? null;
  if (!targetClient && passportNo) {
    const byPassport = await admin
      .from("clients")
      .select("id,full_name,email,passport_number,country")
      .eq("passport_number", passportNo)
      .limit(3);
    if (!byPassport.error) {
      const safe = (byPassport.data ?? []).filter((row: any) => lastNameMatches(row.full_name, lastName) || emailMatches(row.email, email));
      if (safe.length === 1) targetClient = safe[0];
    }
  }

  const result = targetClient?.id
    ? await admin.from("clients").update({
        ...basePayload,
        full_name: targetClient.full_name || fullName,
        country: targetClient.country || "Maroc",
      }).eq("id", targetClient.id).select("id").single()
    : await admin.from("clients").insert({
        ...basePayload,
        full_name: fullName,
        country: "Maroc",
      }).select("id").single();

  if (result.error) {
    safeLogWarn("client upsert skipped", result.error);
    return null;
  }

  await admin.from("profiles").upsert({ id: userId, full_name: fullName }).then(({ error }: any) => {
    if (error) safeLogWarn("profile upsert skipped", error);
  });

  return result.data?.id ?? null;
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
  if (!settings) throw new Error("smtp_not_configured");

  const config = {
    hostname: clean(settings.smtp_host).replace(/^smtp:\/\//i, "").replace(/^https?:\/\//i, "").replace(/\/.*$/, ""),
    port: Number(settings.smtp_port) || 465,
    secure: String(settings.smtp_secure || "ssl"),
    username: normalizeEmail(settings.smtp_username),
    password: String(settings.smtp_password ?? ""),
    from: normalizeEmail(settings.from_email || "info@lejapon.ma"),
    fromName: clean(settings.from_name || "LeJapon.ma"),
    replyTo: normalizeEmail(settings.reply_to) || undefined,
  };

  const missing = [
    ["smtp_host", config.hostname],
    ["smtp_username", config.username],
    ["smtp_password", config.password],
    ["from_email", config.from],
  ].filter(([, value]) => !value).map(([key]) => key);
  if (missing.length) throw new Error(`missing_smtp_settings:${missing.join(",")}`);

  return config;
}

async function sendWelcomeEmail(admin: any, firstName: string, email: string) {
  const siteUrl = "https://lejapon.ma";
  const loginUrl = `${siteUrl}/formulaire-visa/login`;
  const logoUrl = `${siteUrl}/favicon.png`;
  let subject = "Bienvenue sur LeJapon.ma — votre espace visa est prêt";
  let text = `Bonjour ${firstName},

Votre espace visa Japon est prêt.

Vous pouvez compléter votre demande, téléverser vos documents et suivre l’avancement depuis votre espace client.

Accéder à mon espace visa :
${loginUrl}

Identifiant :
${email}

Pour préparer votre demande :
- Préparez votre passeport
- Vérifiez vos informations personnelles
- Téléversez les documents demandés

Si vous n’êtes pas à l’origine de cette demande, veuillez nous contacter.

L’équipe LeJapon.ma
Moroccan Express Travel & Events
info@lejapon.ma`;

  let html = `
    <div style="margin:0;padding:0;background:#f6f3ef;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
      <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">
        Votre espace visa Japon est prêt. Complétez votre demande et suivez son avancement depuis votre espace client LeJapon.ma.
      </div>
      <div style="max-width:600px;margin:0 auto;padding:28px 14px">
        <div style="padding:18px 10px 22px;text-align:center">
          <img src="${escapeHtml(logoUrl)}" width="64" height="64" alt="LeJapon.ma" style="display:block;margin:0 auto 12px;border:0;border-radius:16px" />
          <div style="font-size:28px;font-weight:800;letter-spacing:-0.02em;color:#0f172a;line-height:1">LeJapon.ma</div>
          <div style="font-size:12px;color:#f97316;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;margin-top:8px">Visa Japon</div>
        </div>
        <div style="background:#ffffff;border:1px solid #eadfd7;border-radius:22px;padding:0;box-shadow:0 18px 45px rgba(17,24,39,0.10);overflow:hidden">
          <div style="height:6px;background:#f97316;line-height:6px;font-size:6px">&nbsp;</div>
          <div style="padding:34px 28px 30px">
            <h1 style="font-size:26px;line-height:1.22;margin:0 0 18px;color:#0f172a;font-weight:800;letter-spacing:-0.03em">Bienvenue dans votre espace visa</h1>
            <p style="font-size:16px;line-height:1.7;margin:0 0 14px;color:#2f3746">Bonjour ${escapeHtml(firstName)},</p>
            <p style="font-size:16px;line-height:1.7;margin:0 0 14px;color:#2f3746">Votre espace visa Japon est prêt.</p>
            <p style="font-size:16px;line-height:1.7;margin:0 0 24px;color:#2f3746">Vous pouvez compléter votre demande, téléverser vos documents et suivre l’avancement depuis votre espace client.</p>

            <div style="text-align:center;margin:30px 0 28px">
              <a href="${escapeHtml(loginUrl)}" style="display:inline-block;background:#f97316;color:#ffffff;text-decoration:none;padding:14px 22px;border-radius:999px;font-size:15px;font-weight:800;box-shadow:0 10px 24px rgba(249,115,22,0.28)">Accéder à mon espace visa</a>
            </div>

            <div style="border:1px solid #f4dfcf;background:#fff7ed;border-radius:18px;padding:18px 18px 14px;margin:0 0 24px">
              <p style="font-size:13px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#c2410c;margin:0 0 12px">Avant de commencer</p>
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse">
                <tr>
                  <td style="padding:8px 0;font-size:15px;line-height:1.5;color:#253041"><span style="display:inline-block;width:22px;height:22px;border-radius:50%;background:#f97316;color:#ffffff;text-align:center;line-height:22px;font-weight:800;margin-right:8px">1</span>Préparez votre passeport</td>
                </tr>
                <tr>
                  <td style="padding:8px 0;font-size:15px;line-height:1.5;color:#253041"><span style="display:inline-block;width:22px;height:22px;border-radius:50%;background:#f97316;color:#ffffff;text-align:center;line-height:22px;font-weight:800;margin-right:8px">2</span>Vérifiez vos informations personnelles</td>
                </tr>
                <tr>
                  <td style="padding:8px 0;font-size:15px;line-height:1.5;color:#253041"><span style="display:inline-block;width:22px;height:22px;border-radius:50%;background:#f97316;color:#ffffff;text-align:center;line-height:22px;font-weight:800;margin-right:8px">3</span>Téléversez les documents demandés</td>
                </tr>
              </table>
            </div>

            <div style="border-top:1px solid #f0e6dd;padding-top:18px">
              <p style="font-size:13px;line-height:1.6;color:#667085;margin:0">Identifiant de connexion&nbsp;: <strong style="color:#0f172a">${escapeHtml(email)}</strong></p>
              <p style="font-size:13px;line-height:1.6;color:#667085;margin:10px 0 0">Si vous n’êtes pas à l’origine de cette demande, veuillez nous contacter.</p>
            </div>
          </div>
        </div>
        <div style="text-align:center;padding:22px 12px 8px">
          <p style="font-size:13px;line-height:1.6;color:#3f4654;margin:0;font-weight:700">L’équipe LeJapon.ma</p>
          <p style="font-size:12px;line-height:1.6;color:#7b8494;margin:4px 0 0">Moroccan Express Travel & Events</p>
          <p style="font-size:12px;line-height:1.6;color:#7b8494;margin:2px 0 0"><a href="mailto:info@lejapon.ma" style="color:#f97316;text-decoration:none">info@lejapon.ma</a></p>
        </div>
      </div>
    </div>`;

  const templateKey = "visa_account_created";
  const template = await fetchEmailTemplate(admin, templateKey);
  const templateIsActive = template?.is_active ?? template?.is_system ?? true;
  if (template && templateIsActive !== false && template.subject && (template.body_html || template.html_body)) {
    const variables = {
      client_name: firstName,
      download_link: loginUrl,
      date: new Date().toLocaleDateString("fr-FR"),
    };
    subject = renderTemplateString(template.subject, variables);
    html = renderTemplateString(template.body_html ?? template.html_body, variables);
    text = renderTemplateString(template.body_text ?? template.preheader ?? text, variables);
  }
  subject = sanitizeBranding(subject);
  html = sanitizeBranding(html);
  text = sanitizeBranding(text);

  const smtp = await smtpConfig(admin);
  const client = new SMTPClient({
    connection: {
      hostname: smtp.hostname,
      port: smtp.port,
      tls: smtp.secure === "ssl",
      auth: { username: smtp.username, password: smtp.password },
    },
  });

  try {
    await client.send({
      from: `${smtp.fromName} <${smtp.from}>`,
      to: email,
      replyTo: smtp.replyTo,
      subject,
      html,
      content: text,
    });
  } finally {
    await client.close();
  }
}

Deno.serve(async (req) => {
  const responseCorsHeaders = corsHeadersFor(req);
  const reply = (payload: Record<string, unknown>, status = 200) => json(payload, status, responseCorsHeaders);
  const requestOrigin = req.headers.get("origin");

  if (req.method === "OPTIONS") return new Response(null, { headers: responseCorsHeaders });
  if (requestOrigin && !responseCorsHeaders["Access-Control-Allow-Origin"]) {
    return reply({ success: false, error: "origin_not_allowed" }, 403);
  }
  if (req.method !== "POST") return reply({ success: false, error: "method_not_allowed" }, 405);

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(SUPABASE_URL, SERVICE);

    const body = (await req.json()) as SignupBody;
    const firstName = clean(body.first_name);
    const lastName = clean(body.last_name);
    const email = normalizeEmail(body.email);
    const password = String(body.password ?? "");
    const passportNo = normalizePassport(body.passport_no);

    if (!firstName) return reply({ success: false, error: "first_name_required" }, 400);
    if (!lastName) return reply({ success: false, error: "last_name_required" }, 400);
    if (!email || !isEmail(email)) return reply({ success: false, error: "invalid_email" }, 400);
    if (!password || password.length < 8) {
      return reply({ success: false, error: "weak_password", message: "Le mot de passe doit contenir au moins 8 caractères." }, 400);
    }
    if (isRateLimited(req, email)) {
      return reply({ success: false, error: "rate_limited", message: "Trop de tentatives. Merci de réessayer dans quelques minutes." }, 429);
    }

    const existingUser = await findAuthUserByEmail(admin, email);
    if (existingUser) {
      return reply({ success: false, error: "email_exists", message: "Un compte existe déjà avec cet email. Connectez-vous ou utilisez mot de passe oublié." }, 409);
    }

    const prefillStatus = await lookupPrefillStatus(admin, passportNo, lastName, email);
    if (prefillStatus === "multiple_matches") {
      return reply({
        success: false,
        error: "multiple_passport_matches",
        message: "Plusieurs dossiers correspondent. Merci de contacter l’agence.",
        prefill_status: prefillStatus,
      }, 409);
    }

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: `${firstName} ${lastName}`.trim(),
        first_name: firstName,
        last_name: lastName,
        passport_no: passportNo || null,
        visa_prefill_requested: Boolean(passportNo),
        account_type: "visa_client",
        role: "visa_client",
      },
    });
    if (createError || !created.user?.id) {
      const message = String(createError?.message ?? "");
      if (/already|registered|exists/i.test(message)) {
        return reply({ success: false, error: "email_exists", message: "Un compte existe déjà avec cet email. Connectez-vous ou utilisez mot de passe oublié." }, 409);
      }
      safeLogError("auth create failed", createError);
      return reply({ success: false, error: "signup_failed", message: "Création du compte impossible. Merci de réessayer." }, 500);
    }

    const clientId = await upsertClient(admin, created.user.id, firstName, lastName, email, passportNo || null);

    let emailSent = true;
    let emailError: string | null = null;
    try {
      await sendWelcomeEmail(admin, firstName, email);
    } catch (error) {
      emailSent = false;
      emailError = error instanceof Error ? error.message : String(error);
      safeLogError("welcome email failed", emailError);
    }

    return reply({
      success: true,
      user_id: created.user.id,
      client_id: clientId,
      prefill_status: prefillStatus,
      email_sent: emailSent,
      email_error: emailSent ? null : "email_send_failed",
      next_action: prefillStatus === "found" ? "login_then_create_prefilled_visa" : "login",
      message: emailSent
        ? "Compte créé. Vous pouvez maintenant vous connecter."
        : "Compte créé, mais l’email de confirmation n’a pas pu être envoyé. Vous pouvez quand même vous connecter.",
    });
  } catch (error) {
    safeLogError("failed", error);
    return reply({ success: false, error: "server_error", message: "Création du compte impossible. Merci de réessayer." }, 500);
  }
});
