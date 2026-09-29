import { createClient } from "npm:@supabase/supabase-js@^2.104.0";
import { handleMetaConversionRequest, type MetaLeadDelivery } from "./handler.ts";

const encoder = new TextEncoder();

const sha256 = async (value: string) => {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

const normalizeEmail = (value: string) => value.trim().toLowerCase();
const normalizePhone = (value: string) => value.replace(/\D/g, "");
const safeOpaque = (value: unknown) => typeof value === "string" && value.length <= 500 ? value : undefined;

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const serverKey = Deno.env.get("SUPABASE_SECRET_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const accessToken = Deno.env.get("META_CAPI_ACCESS_TOKEN") || "";
const pixelId = Deno.env.get("META_PIXEL_ID") || "";
const graphVersion = Deno.env.get("META_GRAPH_API_VERSION") || "";
const admin = supabaseUrl && serverKey
  ? createClient(supabaseUrl, serverKey, { auth: { persistSession: false } })
  : null;

const loadBooking = async (bookingId: string) => {
  if (!admin) throw new Error("server_not_configured");
  const { data, error } = await admin
    .from("bookings")
    .select("id,created_at,source,status,contact_email,contact_phone,measurement_consent")
    .eq("id", bookingId)
    .maybeSingle();
  if (error) return null;
  return data;
};

const deliverLead = async ({ request, body, booking, sourceUrl }: MetaLeadDelivery) => {
  if (!accessToken || !pixelId || !graphVersion) throw new Error("server_not_configured");

  const email = normalizeEmail(String(booking.contact_email || ""));
  const phone = normalizePhone(String(booking.contact_phone || ""));
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const userData: Record<string, unknown> = {
    external_id: [await sha256(booking.id)],
    client_user_agent: request.headers.get("user-agent") || undefined,
    client_ip_address: forwardedFor || undefined,
    fbp: safeOpaque(body.fbp),
    fbc: safeOpaque(body.fbc),
  };
  if (email) userData.em = [await sha256(email)];
  if (phone) userData.ph = [await sha256(phone)];

  const event = {
    event_name: "Lead",
    event_time: Math.floor(Date.now() / 1_000),
    event_id: body.event_id,
    action_source: "website",
    event_source_url: sourceUrl,
    user_data: userData,
    custom_data: { booking_status: booking.status },
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
  if (!metaResponse.ok) throw new Error("provider_rejected_event");
};

Deno.serve((request) => handleMetaConversionRequest(request, { loadBooking, deliverLead }));
