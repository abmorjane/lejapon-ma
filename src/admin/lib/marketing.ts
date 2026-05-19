import { fmtMAD } from "@/lib/format";

export type MarketingContact = {
  client_id: string | null;
  email: string;
  full_name: string | null;
  phone: string | null;
  city: string | null;
  country: string | null;
  language: string | null;
  source: string | null;
  marketing_status: "subscribed" | "unsubscribed" | "bounced" | "complained";
  unsubscribe_token: string | null;
  tags: string[] | null;
  loyalty_tier: string | null;
  is_returning: boolean;
  trips_completed: number;
  last_trip_label: string | null;
  last_trip_at: string | null;
  created_at: string;
};

export type SegmentFilters = {
  language?: "fr" | "en" | "ar";
  cities?: string[];
  min_trips?: number;
  max_trips?: number;
  loyalty_tiers?: string[];
  sources?: string[];
  tag?: string;
  returning_only?: boolean;
  has_unpaid_balance?: boolean;
  season?: string;
  has_visa_request?: boolean;
};

export const MARKETING_VARIABLES = [
  { token: "{{first_name}}", label: "Prénom du contact" },
  { token: "{{last_name}}", label: "Nom de famille" },
  { token: "{{full_name}}", label: "Nom complet" },
  { token: "{{email}}", label: "Email" },
  { token: "{{trip_label}}", label: "Voyage choisi" },
  { token: "{{trip_start_date}}", label: "Date de départ" },
  { token: "{{trips_completed}}", label: "Nombre de voyages" },
  { token: "{{remaining_amount}}", label: "Reste à payer" },
  { token: "{{company_name}}", label: "Nom société" },
  { token: "{{unsubscribe_url}}", label: "Lien désinscription" },
] as const;

/** Replace {{tokens}} for preview, using a sample contact. */
export function renderPreview(html: string, ctx: Partial<Record<string, string | number | null>> = {}) {
  const sample: Record<string, string> = {
    first_name: String(ctx.first_name ?? "Yasmine"),
    last_name: String(ctx.last_name ?? "Bennani"),
    full_name: String(ctx.full_name ?? "Yasmine Bennani"),
    email: String(ctx.email ?? "yasmine@example.com"),
    trip_label: String(ctx.trip_label ?? "Japon — Avril 2026"),
    trip_start_date: String(ctx.trip_start_date ?? "12/04/2026"),
    trips_completed: String(ctx.trips_completed ?? 2),
    remaining_amount: String(ctx.remaining_amount ?? fmtMAD(45000)),
    company_name: String(ctx.company_name ?? "lejapon.ma"),
    unsubscribe_url: String(ctx.unsubscribe_url ?? "#"),
  };
  return html.replace(/\{\{(\w+)\}\}/g, (_, k) => sample[k] ?? `{{${k}}}`);
}

/** Build a responsive email shell (max 600px, table-based) with a mandatory footer. */
export function wrapEmailHtml(opts: {
  bodyHtml: string;
  preheader?: string | null;
  ctaLabel?: string | null;
  ctaUrl?: string | null;
  heroImageUrl?: string | null;
  companyName: string;
  companyAddress: string;
  unsubscribeUrl: string;
}) {
  const cta =
    opts.ctaLabel && opts.ctaUrl
      ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px auto;"><tr><td style="background:#0f172a;border-radius:9999px;"><a href="${opts.ctaUrl}" style="display:inline-block;padding:14px 28px;color:#ffffff;font-family:Inter,Arial,sans-serif;font-size:14px;font-weight:600;text-decoration:none;">${opts.ctaLabel}</a></td></tr></table>`
      : "";
  const hero = opts.heroImageUrl
    ? `<img src="${opts.heroImageUrl}" alt="" style="display:block;width:100%;max-width:600px;height:auto;border:0;" />`
    : "";
  const preheader = opts.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${opts.preheader}</div>`
    : "";
  return `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title></title></head>
<body style="margin:0;padding:0;background:#f5f5f4;font-family:Inter,Arial,sans-serif;color:#0f172a;">
${preheader}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f5f4;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;">
<tr><td>${hero}</td></tr>
<tr><td style="padding:32px 28px;font-size:15px;line-height:1.6;">${opts.bodyHtml}${cta}</td></tr>
<tr><td style="padding:20px 28px;background:#fafaf9;font-size:12px;color:#6b7280;line-height:1.5;border-top:1px solid #e7e5e4;">
<strong>${opts.companyName}</strong><br/>
${opts.companyAddress}<br/><br/>
Vous recevez cet email car vous êtes inscrit à notre liste de diffusion.<br/>
<a href="${opts.unsubscribeUrl}" style="color:#6b7280;text-decoration:underline;">Se désinscrire</a>
</td></tr>
</table>
</td></tr></table>
</body></html>`;
}