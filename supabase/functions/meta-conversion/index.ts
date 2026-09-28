import { createClient } from "npm:@supabase/supabase-js@^2.104.0";

type MetaEventName = "Lead" | "Purchase";
type RequestBody = {
  event_name?: unknown;
  event_id?: unknown;
  booking_id?: unknown;
  event_source_url?: unknown;
  fbp?: unknown;
  fbc?: unknown;
};

const allowedOrigins = new Set(["https://lejapon.ma", "https://www.lejapon.ma"]);
const jsonHeaders = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const encoder = new TextEncoder();

const corsHeaders = (request: Request) => {
  const origin = request.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://www.lejapon.ma",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
};

const response = (request: Request, status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(request), ...jsonHeaders } });

const sha256 = async (value: string) => {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

const normalizeEmail = (value: string) => value.trim().toLowerCase();
const normalizePhone = (value: string) => value.replace(/\D/g, "");
const safeOpaque = (value: unknown) => typeof value === "string" && value.length <= 500 ? value : undefined;
const validUuid = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const validEventId = (value: unknown): value is string =>
  typeof value === "string" && value.length >= 8 && value.length <= 120 && /^[a-zA-Z0-9._:-]+$/.test(value);

const validatedSourceUrl = (value: unknown) => {
  if (typeof value !== "string" || value.length > 500) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !["lejapon.ma", "www.lejapon.ma"].includes(url.hostname)) return null;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(request) });
  if (request.method !== "POST") return response(request, 405, { ok: false, error: "method_not_allowed" });

  try {
    const body = await request.json() as RequestBody;
    const eventName = body.event_name as MetaEventName;
    const sourceUrl = validatedSourceUrl(body.event_source_url);
    if (!["Lead", "Purchase"].includes(eventName)) return response(request, 400, { ok: false, error: "event_not_allowed" });
    if (!validEventId(body.event_id) || !validUuid(body.booking_id) || !sourceUrl) {
      return response(request, 400, { ok: false, error: "invalid_payload" });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serverKey = Deno.env.get("SUPABASE_SECRET_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const accessToken = Deno.env.get("META_CAPI_ACCESS_TOKEN") || "";
    const pixelId = Deno.env.get("META_PIXEL_ID") || "";
    const graphVersion = Deno.env.get("META_GRAPH_API_VERSION") || "";
    if (!supabaseUrl || !serverKey || !accessToken || !pixelId || !graphVersion) {
      return response(request, 503, { ok: false, error: "server_not_configured" });
    }

    const admin = createClient(supabaseUrl, serverKey, { auth: { persistSession: false } });
    const { data: booking, error: bookingError } = await admin
      .from("bookings")
      .select("id,contact_email,contact_phone,status,total_amount_mad")
      .eq("id", body.booking_id)
      .maybeSingle();
    if (bookingError || !booking) return response(request, 404, { ok: false, error: "booking_not_found" });

    let value: number | undefined;
    if (eventName === "Purchase") {
      const { data: payment, error: paymentError } = await admin
        .from("payments")
        .select("amount_mad,paid_at,status")
        .eq("booking_id", booking.id)
        .eq("status", "received")
        .not("paid_at", "is", null)
        .order("paid_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (paymentError || !payment) return response(request, 409, { ok: false, error: "payment_not_confirmed" });
      value = Number(payment.amount_mad);
    }

    const email = normalizeEmail(String(booking.contact_email || ""));
    const phone = normalizePhone(String(booking.contact_phone || ""));
    const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    const userData: Record<string, unknown> = {
      external_id: [await sha256(String(booking.id))],
      client_user_agent: request.headers.get("user-agent") || undefined,
      client_ip_address: forwardedFor || undefined,
      fbp: safeOpaque(body.fbp),
      fbc: safeOpaque(body.fbc),
    };
    if (email) userData.em = [await sha256(email)];
    if (phone) userData.ph = [await sha256(phone)];

    const event = {
      event_name: eventName,
      event_time: Math.floor(Date.now() / 1000),
      event_id: body.event_id,
      action_source: "website",
      event_source_url: sourceUrl,
      user_data: userData,
      custom_data: eventName === "Purchase" ? { currency: "MAD", value } : { booking_status: booking.status },
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    let metaResponse: Response;
    try {
      metaResponse = await fetch(`https://graph.facebook.com/${encodeURIComponent(graphVersion)}/${encodeURIComponent(pixelId)}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: [event], access_token: accessToken }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!metaResponse.ok) {
      console.error("[meta-conversion] provider rejected event", { eventName, status: metaResponse.status });
      return response(request, 502, { ok: false, error: "provider_rejected_event" });
    }
    return response(request, 200, { ok: true, event_id: body.event_id });
  } catch (error) {
    console.error("[meta-conversion] request failed", {
      type: error instanceof DOMException && error.name === "AbortError" ? "timeout" : "unexpected",
    });
    return response(request, 500, { ok: false, error: "conversion_delivery_failed" });
  }
});
