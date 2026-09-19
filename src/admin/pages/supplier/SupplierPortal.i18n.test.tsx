import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SupplierTripCosts, { QuoteTable } from "./SupplierTripCosts";
import SupplierTrips from "./SupplierTrips";
import SupplierFitRequests from "./SupplierFitRequests";
import { SupplierQuoteExcelImportDialog } from "./SupplierQuoteExcelImportDialog";
import { SupplierLanguageProvider, SupplierLanguageSelector } from "@/i18n/supplier/SupplierLanguageProvider";
import { supplierQuoteSectionTables } from "@/admin/lib/supplier-quote-section-loader";
import { buildSupplierQuoteImportPayload, parseSupplierQuoteWorkBook } from "@/admin/lib/supplier-quote-excel-import";
import * as XLSX from "xlsx";

const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), error: vi.fn(), updateUser: vi.fn(), sectionError: false }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { ...mocks, auth: { updateUser: mocks.updateUser }, storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: "https://example.invalid/private" }, error: null }) }) } } }));
vi.mock("@/hooks/useAuth", () => { const user = { id: "supplier-user", user_metadata: { supplier_language: "en" } }; return { useAuth: () => ({ user, roles: ["supplier"], isInternalStaff: false, isAdmin: false }) }; });
vi.mock("sonner", () => ({ toast: { error: mocks.error, success: vi.fn(), warning: vi.fn() } }));
const quote = { id: "existing-v3", version_number: 3, trip_id: "trip", supplier_id: "supplier", status: "draft", supplier_handling_percentage: 10, supplier_handling_categories: ["hotels", "transport"] };
const versions = [1, 2, 3, 4].map(version => ({ ...quote, id: `existing-v${version}`, version_number: version }));
const records: Record<string, any[]> = {
  supplier_members: [{ supplier_id: "supplier", suppliers: { name: "Société 桜" } }], trip_suppliers: [{ supplier_id: "supplier" }],
  trip_messages: [{ id: "message", trip_id: "trip", body: "Bonjour Hôtel Sakura / 東京", message_type: "hotel", sender_id: "staff", sender_name: "LeJapon.ma", created_at: "2026-09-18T00:00:00Z" }],
  trip_documents: [{ id: "document", trip_id: "trip", category: "hotel_vouchers", title: "Bon hôtel / 桜", file_name: "Chambre-Tokyo.pdf", uploaded_at: "2026-09-18T00:00:00Z", version: 1 }],
  fit_supplier_requests: [{ id: "fit", service_label: "Hôtel Sakura 東京", service_type: "hotel", status: "waiting_supplier", version_number: 2 }],
  supplier_portal_notifications: [{ id: "notification", type: "quote_revision_requested", title: "Correction demandée sur le devis", message: "Veuillez conserver Hôtel Sakura", created_at: "2026-09-18T00:00:00Z" }],
};
function Portal({ language, children }: { language: "en" | "ja"; children: React.ReactNode }) {
  return <SupplierLanguageProvider user={{ id: "supplier-user", user_metadata: { supplier_language: language } }}><SupplierLanguageSelector />{children}</SupplierLanguageProvider>;
}
const renderPage = (language: "en" | "ja") => render(<Portal language={language}><MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }} initialEntries={["/supplier/trips/trip"]}><Routes><Route path="/supplier/trips/:tripId" element={<SupplierTripCosts />} /></Routes></MemoryRouter></Portal>);
const openTab = async (name: string) => act(async () => { fireEvent.mouseDown(screen.getByRole("tab", { name: new RegExp(`^${name}`) }), { button: 0, ctrlKey: false }); });
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); mocks.sectionError = false;
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  mocks.updateUser.mockResolvedValue({ data: {}, error: null });
  mocks.rpc.mockImplementation(async (name: string, args: any) => {
    if (name === "get_supplier_trip_workspace") return { data: { trip: { id: "trip", title: "Kyoto 桜", start_date: "2026-10-01", end_date: "2026-10-15", duration_days: 15 } }, error: null };
    if (name === "get_supplier_trip_quote") return { data: quote, error: null };
    if (name === "get_supplier_quote_version_v2") return { data: versions.find(version => version.id === args.p_quote_id), error: null };
    if (name === "get_supplier_quote_versions_v2") return { data: versions, error: null };
    if (name === "get_supplier_trip_dashboard") return { data: [{ id: "trip", title: "Kyoto 桜", quote_status: "revision_requested", participant_count: 19, room_count: 10, extras_count: 2 }], error: null };
    return { data: [], error: null };
  });
  mocks.from.mockImplementation((table: string) => {
    const section = Object.entries(supplierQuoteSectionTables).find(([, name]) => name === table)?.[0];
    const data = section ? [{ id: `${section}-row`, local_id: `${section}-row`, quote_id: quote.id, sort_order: 0, status: "todo", hotel_name: "Hôtel Sakura 東京", description: "Bus 京都", activity_name: "Visite Sakura", label: "Repas Sakura", guide_type: "francophone", quantity: 1, nights: 1, rooms_count: 1, participant_count: 1, guides_count: 1, unit_price_jpy: 100, daily_price_jpy: 100 }] : records[table] || [];
    const query: any = {};
    for (const method of ["select", "eq", "in", "is", "order", "limit"]) query[method] = vi.fn(() => query);
    query.upsert = vi.fn(async () => ({ data: [], error: null }));
    query.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: section === "hotels" && mocks.sectionError ? null : data, error: section === "hotels" && mocks.sectionError ? { code: "42501", message: "permission denied for supplier_can_access_quote" } : null }).then(resolve);
    return query;
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("complete supplier portal presentation", () => {
  it.each(["en", "ja"] as const)("renders all quote categories and handling in %s without translating supplier data", async language => {
    renderPage(language);
    expect(await screen.findByDisplayValue("Hôtel Sakura 東京")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Bus 京都")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Visite Sakura")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Repas Sakura")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: language === "en" ? "Submit quotation" : "見積りを提出" })).toBeEnabled();
    expect(screen.getByLabelText(language === "en" ? "Supplier handling percentage" : "サプライヤー手配手数料率")).toHaveValue(10);
    expect(screen.queryByText("Commission office (%)")).not.toBeInTheDocument();
    await openTab(language === "en" ? "Messages" : "メッセージ");
    expect(screen.getByText("Bonjour Hôtel Sakura / 東京")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: language === "en" ? "Send message" : "メッセージを送信" })).toBeInTheDocument();
    await openTab(language === "en" ? "Documents" : "書類");
    expect(screen.getByText("Bon hôtel / 桜")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: language === "en" ? "Upload" : "アップロード" })).toBeInTheDocument();
    await openTab(language === "en" ? "Operational view" : "運営情報");
    expect(screen.getAllByText(language === "en" ? "Preparation not started" : "準備未開始").length).toBeGreaterThan(0);
    expect(screen.getAllByText(language === "en" ? "To book" : "手配待ち").length).toBeGreaterThan(0);
    expect(mocks.rpc.mock.calls.every(([name]) => name.startsWith("get_"))).toBe(true);
  });
  it("switches an already loaded quotation to Japanese without saving or creating a version", async () => {
    renderPage("en"); await screen.findByDisplayValue("Hôtel Sakura 東京");
    fireEvent.click(screen.getByRole("button", { name: "日本語" }));
    expect(screen.getByRole("button", { name: "見積りを提出" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("Hôtel Sakura 東京")).toBeInTheDocument();
    await waitFor(() => expect(mocks.updateUser).toHaveBeenCalledWith({ data: { supplier_language: "ja" } }));
    expect(mocks.rpc.mock.calls.every(([name]) => name.startsWith("get_"))).toBe(true);
  });
  it.each(["en", "ja"] as const)("selects fixture V1/V2/V3/V4 in %s without creating a version", async language => {
    renderPage(language); await screen.findByDisplayValue("Hôtel Sakura 東京");
    const card = screen.getByText(language === "en" ? "Supplier quotation versions" : "サプライヤー見積りの各バージョン").closest(".p-4") as HTMLElement;
    for (const number of [1, 2, 3, 4]) {
      fireEvent.keyDown(within(card).getByRole("combobox"), { key: "ArrowDown" });
      fireEvent.keyDown(await screen.findByRole("option", { name: new RegExp(`^V${number} `) }), { key: "Enter" });
      await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith("get_supplier_quote_version_v2", { p_quote_id: `existing-v${number}` }));
    }
    expect(mocks.rpc.mock.calls.every(([name]) => name.startsWith("get_"))).toBe(true);
  });
  it.each(["en", "ja"] as const)("keeps permission errors visible and distinct from empty rows in %s", async language => {
    mocks.sectionError = true; vi.spyOn(console, "error").mockImplementation(() => {}); renderPage(language);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("42501"));
    expect(screen.getByRole("alert")).toHaveTextContent(language === "en" ? "Permission denied." : "操作権限がありません");
    expect(screen.getByRole("alert")).toHaveTextContent("permission denied for supplier_can_access_quote");
    expect(screen.queryByText(language === "en" ? "No lines." : "明細はありません。")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: language === "en" ? "Submit quotation" : "見積りを提出" })).toBeDisabled();
  });
  it.each(["en", "ja"] as const)("localizes dashboard notifications while preserving revision comments in %s", async language => {
    render(<Portal language={language}><MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><SupplierTrips /></MemoryRouter></Portal>);
    expect(await screen.findByText("Veuillez conserver Hôtel Sakura")).toBeInTheDocument();
    expect(screen.getByText(language === "en" ? "Quotation revision requested" : "見積り修正のお願い")).toBeInTheDocument();
    expect(screen.getByText("Kyoto 桜")).toBeInTheDocument();
  });
  it.each(["en", "ja"] as const)("localizes assigned FIT labels while preserving service names in %s", async language => {
    render(<Portal language={language}><SupplierFitRequests /></Portal>);
    expect(await screen.findByText("Hôtel Sakura 東京")).toBeInTheDocument();
    expect(screen.getByText(language === "en" ? "Quoted cost" : "見積金額")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: language === "en" ? "Save response" : "回答を保存" })).toBeInTheDocument();
  });
});

describe("Excel preview localization preserves import semantics", () => {
  it.each(["en", "ja"] as const)("renders ambiguity and handling decisions in %s without altering the parsed workbook", language => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      [null, "1. ACCOMMODATION"],
      [null, "Check-in date", "Check-out date", "Hotel Name:", "Rate", "Pax", "Nts.", null, "Subtotal", "Notes"],
      [null, 46340, 46342, "Hôtel Sakura 東京", 1000, 2, 2, null, 4000],
      [null, null, null, null, "Total", null, null, null, 4000],
      [null, "3. Transport"],
      [null, null, null, "Contents", "Price", "No", "Times", null, "Subtotal", "Notes"],
      [null, null, null, "Bus Kyoto", 500, 1, 1, null, null],
      [null, null, null, null, "Total", null, null, null, 500],
      [null, "6. Other"],
      [null, "Date", null, "Contents", "Price", "No", "Times", null, "Subtotal", "Notes"],
      [null, null, null, "Tapis volant Handling 10%", 4500, 1, 1, null, 450],
    ]), "Supplier original");
    const preview = parseSupplierQuoteWorkBook(workbook, "source.xlsx", XLSX.SSF.parse_date_code);
    const unchanged = JSON.stringify(preview);
    render(<Portal language={language}><SupplierQuoteExcelImportDialog open preview={preview} importMode="new_version" nextVersionNumber={4} busy={false} onOpenChange={vi.fn()} onConfirm={vi.fn()} onResolutionChange={vi.fn()} onHandlingChange={vi.fn()} /></Portal>);
    expect(screen.getByRole("dialog")).toHaveTextContent(language === "en" ? "Excel import" : "Excelインポート");
    expect(screen.getByText("Hôtel Sakura 東京")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: language === "en" ? "Confirm import" : "インポートを確定" })).toBeDisabled();
    expect(screen.getByRole("dialog")).not.toHaveTextContent("Sous-total Excel absent");
    expect(screen.getByRole("dialog")).toHaveTextContent(language === "en" ? "Handling scope: confirmation required" : "手数料の適用範囲：確認が必要です");
    expect(JSON.stringify(preview)).toBe(unchanged);
    expect(() => buildSupplierQuoteImportPayload(preview)).toThrow();
  });
});
