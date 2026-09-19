import { describe, expect, it, vi } from "vitest";
import { renderSupplierWorkflowEmail, supplierEmailLanguage, supplierEmailRecipients, type SupplierEmailEvent } from "../../supabase/functions/_shared/supplier-workflow-email";

const trip = { title: "Kyoto / Société 日本", total_slots: 19, start_date: "2026-10-01", end_date: "2026-10-15", visa_japan_arrival_date: "2026-10-03", visa_japan_departure_date: "2026-10-13", visa_arrival_port: "Narita NRT", visa_arrival_flight_number: "JL123" };
const render = (event: SupplierEmailEvent, language: "en" | "ja", fields = trip) => renderSupplierWorkflowEmail({ event, language, trip: fields, version: 3, url: "https://example.invalid/supplier/trips/existing/quote", feedback: "Veuillez conserver Hôtel Sakura / 桜", comment: "Hôtel Sakura — merci" });

describe("supplier notification language and Japan operational dates", () => {
  it.each(["en", "ja"] as const)("uses canonical Japan dates for %s revision emails", language => {
    const email = render("supplier_quote_revision_requested", language);
    expect(email.text).toContain(language === "en" ? "Arrival in Japan: 3 Oct 2026" : "日本到着日: 2026年10月3日");
    expect(email.text).toContain(language === "en" ? "Departure from Japan: 13 Oct 2026" : "日本出発日: 2026年10月13日");
    expect(email.text).not.toMatch(/1 Oct 2026|15 Oct 2026|2026年10月1日|2026年10月15日/);
    expect(email.text).toContain("JL123"); expect(email.text).toContain("Narita NRT");
    expect(email.text).toContain("Veuillez conserver Hôtel Sakura / 桜");
    expect(email.html).toContain(`lang="${language}"`);
  });
  it.each(["en", "ja"] as const)("shows unconfirmed dates without a commercial fallback for %s", language => {
    const email = render("supplier_quote_revision_requested", language, { ...trip, visa_japan_arrival_date: "", visa_japan_departure_date: "" });
    const missing = language === "en" ? "To be confirmed" : "未確定";
    expect(email.text.split(missing)).toHaveLength(3);
    expect(email.text).not.toMatch(/2026|October|10月/);
  });
  it.each(["2026-02-30", "garbage", "2026-10-03T00:00:00Z"])("does not display invalid date %s", date => {
    expect(render("supplier_trip_assigned", "en", { ...trip, visa_japan_arrival_date: date }).text).toContain("Arrival in Japan: To be confirmed");
  });
  it.each([
    ["supplier_trip_assigned", "Prepare quotation", "見積を作成する"],
    ["supplier_quote_revision_requested", "Review requested changes", "修正内容を確認する"],
    ["supplier_quote_approved", "View approved quotation", "承認済み見積を確認する"],
    ["supplier_quote_comment", "View comment", "コメントを確認する"],
  ])("matches the CTA to %s in both languages", (event, en, ja) => {
    expect(render(event as SupplierEmailEvent, "en").text).toContain(en);
    expect(render(event as SupplierEmailEvent, "ja").text).toContain(ja);
  });
  it.each(["en", "ja"] as const)("shows canonical departure reservation text unchanged in %s", language => {
    const returnFlight = "EY 871 G NRTAUH 1730 0005+1\nEY 613 G AUHCMN 0225 0740 — 桜 Travel";
    const email = renderSupplierWorkflowEmail({ event: "supplier_quote_approved", language, trip: { ...trip, return_flight_text: returnFlight }, url: "https://example.invalid/quote" });
    expect(email.text).toContain(`${language === "en" ? "Departure flight details" : "日本出発便の詳細"}: ${returnFlight}`);
    expect(email.html).toContain(returnFlight);
    expect(email.text).not.toContain("Departure airport:");
  });
  it("omits missing departure flight details rather than inferring them from arrival", () => {
    const email = renderSupplierWorkflowEmail({ event: "supplier_trip_assigned", language: "en", trip: { ...trip, return_flight_text: "  " }, url: "https://example.invalid/quote" });
    expect(email.text).not.toContain("Departure flight details");
    expect(email.text).not.toContain("Departure airport:");
    expect(email.text).toContain("Arrival flight number: JL123");
  });
  it("preserves free text and escapes email HTML", () => {
    const email = renderSupplierWorkflowEmail({ event: "supplier_quote_comment", language: "ja", trip: { title: '<b>Hôtel Sakura</b>' }, url: "https://example.invalid/quote", comment: '<script>alert("comment")</script>' });
    expect(email.text).toContain('<script>alert("comment")</script>');
    expect(email.html).toContain("&lt;script&gt;"); expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("Hôtel Sakura");
  });
  it("keeps mobile layout rules and branding", () => {
    const html = render("supplier_quote_approved", "ja").html;
    expect(html).toContain("max-width:480px"); expect(html).toContain("width=device-width");
    expect(html).toContain("LeJapon.ma"); expect(html).toContain("Moroccan Express Travel &amp; Events");
  });
  it("defaults unknown or absent user preferences to English", () => {
    expect(supplierEmailLanguage(null)).toBe("en");
    expect(supplierEmailLanguage({ user_metadata: { supplier_language: "fr" } })).toBe("en");
    expect(supplierEmailLanguage({ user_metadata: { supplier_language: "ja" } })).toBe("ja");
  });
  it("resolves members individually and deduplicates a contact with its member preference", async () => {
    const users: Record<string, any> = { a: { email: "Sakura@example.invalid", user_metadata: { supplier_language: "ja" } }, b: { email: "other@example.invalid", user_metadata: { supplier_language: "en" } } };
    const admin = { from: vi.fn(() => ({ select: () => ({ eq: async () => ({ data: [{ user_id: "a" }, { user_id: "b" }], error: null }) }) })), auth: { admin: { getUserById: vi.fn(async (id: string) => ({ data: { user: users[id] }, error: null })) } } };
    expect(await supplierEmailRecipients(admin, { id: "supplier", contact_email: "SAKURA@example.invalid" })).toEqual([{ email: "sakura@example.invalid", language: "ja" }, { email: "other@example.invalid", language: "en" }]);
  });
  it("reports recipient lookup errors instead of silently omitting members", async () => {
    const error = { code: "42501", message: "permission denied" };
    const admin = { from: () => ({ select: () => ({ eq: async () => ({ data: null, error }) }) }) };
    await expect(supplierEmailRecipients(admin, { id: "supplier" })).rejects.toEqual(error);
  });
});
