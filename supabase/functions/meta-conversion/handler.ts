export type MetaConversionRequestBody = {
  event_name?: unknown;
  event_id?: unknown;
  booking_id?: unknown;
  event_source_url?: unknown;
  fbp?: unknown;
  fbc?: unknown;
};

export type MetaLeadBooking = {
  id: string;
  created_at: string;
  source: string | null;
  status: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  measurement_consent: unknown;
};

export type MetaLeadDelivery = {
  request: Request;
  body: MetaConversionRequestBody & {
    event_name: "Lead";
    event_id: string;
    booking_id: string;
  };
  booking: MetaLeadBooking;
  sourceUrl: string;
};

export type MetaConversionDependencies = {
  loadBooking: (bookingId: string) => Promise<MetaLeadBooking | null>;
  deliverLead: (delivery: MetaLeadDelivery) => Promise<void>;
  now?: () => number;
};

export const META_LEAD_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
export const META_ALLOWED_ORIGINS = new Set(["https://lejapon.ma", "https://www.lejapon.ma"]);

const jsonHeaders = { "Content-Type": "application/json", "Cache-Control": "no-store" };

const corsHeaders = (request: Request) => {
  const origin = request.headers.get("origin") || "";
  return {
    ...(META_ALLOWED_ORIGINS.has(origin) ? { "Access-Control-Allow-Origin": origin } : {}),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
};

const response = (request: Request, status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(request), ...jsonHeaders } });

const validUuid = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const validEventId = (value: unknown): value is string =>
  typeof value === "string" && value.length >= 8 && value.length <= 120 && /^[a-zA-Z0-9._:-]+$/.test(value);

const validatedSourceUrl = (value: unknown) => {
  if (typeof value !== "string" || value.length > 500) return null;
  try {
    const url = new URL(value);
    if (!META_ALLOWED_ORIGINS.has(url.origin)) return null;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
};

const isRecentBooking = (createdAt: string, now: number) => {
  const createdAtMs = Date.parse(createdAt);
  if (!Number.isFinite(createdAtMs)) return false;
  const age = now - createdAtMs;
  return age >= 0 && age <= META_LEAD_MAX_AGE_MS;
};

export const handleMetaConversionRequest = async (
  request: Request,
  dependencies: MetaConversionDependencies,
) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request) });
  if (request.method !== "POST") return response(request, 405, { ok: false, error: "method_not_allowed" });

  const origin = request.headers.get("origin") || "";
  if (!META_ALLOWED_ORIGINS.has(origin)) {
    return response(request, 403, { ok: false, error: "origin_not_allowed" });
  }

  let body: MetaConversionRequestBody;
  try {
    body = await request.json() as MetaConversionRequestBody;
  } catch {
    return response(request, 400, { ok: false, error: "invalid_payload" });
  }

  if (body.event_name !== "Lead") {
    return response(request, 400, { ok: false, error: "event_not_allowed" });
  }

  const sourceUrl = validatedSourceUrl(body.event_source_url);
  if (!validEventId(body.event_id) || !validUuid(body.booking_id) || !sourceUrl) {
    return response(request, 400, { ok: false, error: "invalid_payload" });
  }

  let booking: MetaLeadBooking | null;
  try {
    booking = await dependencies.loadBooking(body.booking_id);
  } catch {
    return response(request, 503, { ok: false, error: "booking_lookup_failed" });
  }
  if (!booking) return response(request, 404, { ok: false, error: "booking_not_found" });

  if (body.event_id !== `lead-${booking.id}`) {
    return response(request, 400, { ok: false, error: "invalid_event_id" });
  }

  const consent = booking.measurement_consent;
  if (!consent || typeof consent !== "object" || Array.isArray(consent)
    || (consent as Record<string, unknown>).version !== 1
    || (consent as Record<string, unknown>).marketing !== true) {
    return response(request, 403, { ok: false, error: "marketing_consent_required" });
  }

  if (booking.source && booking.source !== "website") {
    return response(request, 403, { ok: false, error: "booking_source_not_allowed" });
  }

  if (!isRecentBooking(booking.created_at, (dependencies.now ?? Date.now)())) {
    return response(request, 409, { ok: false, error: "booking_not_recent" });
  }

  try {
    await dependencies.deliverLead({
      request,
      body: {
        ...body,
        event_name: "Lead",
        event_id: body.event_id,
        booking_id: body.booking_id,
      },
      booking,
      sourceUrl,
    });
  } catch {
    return response(request, 502, { ok: false, error: "conversion_delivery_failed" });
  }

  return response(request, 200, { ok: true, event_id: body.event_id });
};
