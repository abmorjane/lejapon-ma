export type SupplierEmailLanguage = "en" | "ja";
export type SupplierEmailEvent = "supplier_trip_assigned" | "supplier_quote_revision_requested" | "supplier_quote_approved" | "supplier_quote_comment";
export const supplierEmailLanguage = (user: { user_metadata?: Record<string, unknown> } | null | undefined): SupplierEmailLanguage => user?.user_metadata?.supplier_language === "ja" ? "ja" : "en";
export async function supplierEmailRecipients(admin: any, supplier: { id: string; contact_email?: string | null }) {
  const recipients = new Map<string, SupplierEmailLanguage>();
  const normalize = (value: unknown) => {
    const email = String(value || "").trim().toLowerCase();
    return email === "info@japon.ma" ? "info@lejapon.ma" : email;
  };
  const contact = normalize(supplier.contact_email);
  if (contact) recipients.set(contact, "en");
  const { data: members, error } = await admin.from("supplier_members").select("user_id").eq("supplier_id", supplier.id);
  if (error) throw error;
  for (const member of members || []) {
    const { data, error: userError } = await admin.auth.admin.getUserById(member.user_id);
    if (userError) throw userError;
    const email = normalize(data?.user?.email);
    if (email) recipients.set(email, supplierEmailLanguage(data?.user));
  }
  return [...recipients].map(([email, language]) => ({ email, language }));
}
const copy = {
  en: {
    supplier_trip_assigned: ["New trip assigned — Quotation requested", "A new trip has been assigned to your Japan Office. Please prepare a supplier quotation in your portal.", "Prepare quotation"],
    supplier_quote_revision_requested: ["Quotation revision requested", "The LeJapon.ma team has requested changes to your quotation. Please review the feedback and prepare a new revision.", "Review requested changes"],
    supplier_quote_approved: ["Quotation approved", "LeJapon.ma has approved your quotation. You may now proceed with bookings and operational preparation.", "View approved quotation"],
    supplier_quote_comment: ["New quotation comment", "The LeJapon.ma team has added a shared comment to your quotation.", "View comment"],
    trip: "Trip", version: "Quotation version", arrival: "Arrival in Japan", departure: "Departure from Japan", airport: "Arrival airport / port", flight: "Arrival flight number", returnFlight: "Departure flight details", participants: "Expected participants", missing: "To be confirmed", footer: "Automatic notification — LeJapon.ma", feedback: "Requested changes", comment: "Comment",
  },
  ja: {
    supplier_trip_assigned: ["新規旅行の見積依頼", "新しい旅行案件を担当いただくことになりました。Japan Officeポータルよりお見積りの作成をお願いいたします。", "見積を作成する"],
    supplier_quote_revision_requested: ["見積り修正のお願い", "LeJapon.maよりお見積りの修正をお願いしております。ご確認のうえ、改訂版の作成をお願いいたします。", "修正内容を確認する"],
    supplier_quote_approved: ["見積り承認のお知らせ", "LeJapon.maがお見積りを承認しました。各サービスの手配および運営準備を進めていただけます。", "承認済み見積を確認する"],
    supplier_quote_comment: ["見積りへの新しいコメント", "LeJapon.maよりお見積りに共有コメントが追加されました。内容をご確認ください。", "コメントを確認する"],
    trip: "旅行名", version: "見積りバージョン", arrival: "日本到着日", departure: "日本出発日", airport: "到着空港・港", flight: "到着便名", returnFlight: "日本出発便の詳細", participants: "予定参加人数", missing: "未確定", footer: "LeJapon.maからの自動通知", feedback: "修正依頼内容", comment: "コメント",
  },
} as const;
const escape = (value: unknown) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
function japanDate(value: unknown, language: SupplierEmailLanguage, missing: string) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return missing;
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return missing;
  return new Intl.DateTimeFormat(language === "ja" ? "ja-JP" : "en-GB", { year: "numeric", month: language === "ja" ? "long" : "short", day: "numeric", timeZone: "UTC" }).format(date);
}
export function renderSupplierWorkflowEmail({ event, language, trip, version, url, feedback, comment }: {
  event: SupplierEmailEvent; language: SupplierEmailLanguage;
  trip: { title: string; visa_japan_arrival_date?: string | null; visa_japan_departure_date?: string | null; visa_arrival_port?: string | null; visa_arrival_flight_number?: string | null; return_flight_text?: string | null; total_slots?: number | null };
  version?: number; url: string; feedback?: string | null; comment?: string | null;
}) {
  const c = copy[language];
  const [heading, intro, cta] = c[event];
  const subject = `${heading} — ${trip.title}${version ? ` — V${version}` : ""}`;
  const rows: [string, unknown][] = [[c.trip, trip.title]];
  if (version) rows.push([c.version, `V${version}`]);
  rows.push([c.arrival, japanDate(trip.visa_japan_arrival_date, language, c.missing)], [c.departure, japanDate(trip.visa_japan_departure_date, language, c.missing)]);
  if (trip.visa_arrival_port?.trim()) rows.push([c.airport, trip.visa_arrival_port]);
  if (trip.visa_arrival_flight_number?.trim()) rows.push([c.flight, trip.visa_arrival_flight_number]);
  if (trip.return_flight_text?.trim()) rows.push([c.returnFlight, trip.return_flight_text]);
  rows.push([c.participants, trip.total_slots ?? c.missing]);
  if (event === "supplier_quote_revision_requested" && feedback) rows.push([c.feedback, feedback]);
  if (event === "supplier_quote_comment" && comment) rows.push([c.comment, comment]);
  const html = `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>@media(max-width:480px){.card{padding:18px!important}.label,.value{display:block!important;width:auto!important}.label{padding-bottom:2px!important;border:0!important}.value{padding-top:2px!important}h1{font-size:20px!important}.cta{display:block!important;text-align:center}}</style></head><body style="margin:0;background:#f4f4f4;color:#171412;font-family:Arial,'Noto Sans JP','Hiragino Kaku Gothic ProN',Meiryo,sans-serif"><div style="max-width:680px;margin:0 auto;padding:28px 14px"><div style="text-align:center;padding-bottom:16px"><div style="font-size:24px;font-weight:700;color:#E21B2D">LeJapon.ma</div><div style="font-size:12px;color:#766f68;margin-top:4px">Moroccan Express Travel &amp; Events</div></div><div class="card" style="background:#fff;border-radius:14px;border:1px solid #e8e4e1;padding:26px;overflow-wrap:anywhere"><h1 style="font-size:22px;line-height:1.5;border-bottom:3px solid #E21B2D;padding-bottom:14px;margin:0 0 20px">${escape(subject)}</h1><p style="font-size:15px;line-height:1.8">${escape(intro)}</p><table role="presentation" style="width:100%;border-collapse:collapse;font-size:14px;line-height:1.7">${rows.map(([label, value]) => `<tr><td class="label" style="padding:12px 8px 12px 0;width:40%;vertical-align:top;color:#6b625c;border-bottom:1px solid #eee">${escape(label)}</td><td class="value" style="padding:12px 0;vertical-align:top;border-bottom:1px solid #eee;white-space:pre-line"><strong>${escape(value)}</strong></td></tr>`).join("")}</table><p style="margin-top:26px"><a class="cta" href="${escape(url)}" style="display:inline-block;background:#E21B2D;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700;line-height:1.6">${escape(cta)}</a></p></div><p style="text-align:center;color:#8a8178;font-size:12px">${escape(c.footer)}</p></div></body></html>`;
  const text = `${subject}\n\n${intro}\n\n${rows.map(([label, value]) => `${label}: ${value}`).join("\n")}\n\n${cta}\n${url}\n\n${c.footer}`;
  return { subject, html, text };
}
