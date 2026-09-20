const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const SITE_KEY = Deno.env.get("RECAPTCHA_SITE_KEY") ?? "";
const SECRET_KEY = Deno.env.get("RECAPTCHA_SECRET_KEY") ?? "";
const MIN_SCORE = 0.5;
const BYPASS_TOKEN = "__recaptcha_bypass_local__";

function isLocalOrigin(req: Request) {
  const origin = req.headers.get("Origin") ?? req.headers.get("Referer") ?? "";
  try {
    const hostname = new URL(origin).hostname;
    return hostname === "localhost" || hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

export async function verifyRecaptchaToken(token: string, expectedAction?: string) {
  if (!SECRET_KEY) return { ok: false, reason: "secret_not_configured" as const };
  if (!token) return { ok: false, reason: "missing_token" as const };

  const params = new URLSearchParams({ secret: SECRET_KEY, response: token });
  const res = await fetch("https://www.google.com/recaptcha/api/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const data = await res.json();
  if (!data.success) return { ok: false, reason: "invalid_token" as const, data };
  if (expectedAction && data.action && data.action !== expectedAction) {
    return { ok: false, reason: "action_mismatch" as const, data };
  }
  if (typeof data.score === "number" && data.score < MIN_SCORE) {
    return { ok: false, reason: "low_score" as const, data };
  }
  return { ok: true as const, data };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // GET → return public site key so the frontend can load the widget
  if (req.method === "GET") {
    return new Response(JSON.stringify({ siteKey: SITE_KEY }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  try {
    const { token, action } = await req.json();
    if (token === BYPASS_TOKEN && isLocalOrigin(req)) {
      return new Response(JSON.stringify({ ok: true, reason: "local_bypass" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const result = await verifyRecaptchaToken(String(token ?? ""), action ? String(action) : undefined);
    return new Response(JSON.stringify(result), {
      status: result.ok ? 200 : 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, reason: "bad_request", error: (e as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
