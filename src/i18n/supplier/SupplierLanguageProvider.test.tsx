import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createSupplierTranslator, initialSupplierLanguage, supplierErrorMessage, SupplierLanguageProvider, SupplierLanguageSelector, useSupplierTranslation } from "./SupplierLanguageProvider";
import catalog from "./catalog.json";

const mocks = vi.hoisted(() => ({ updateUser: vi.fn(), error: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { updateUser: mocks.updateUser } } }));
vi.mock("sonner", () => ({ toast: { error: mocks.error } }));
const user = { id: "supplier-user", user_metadata: { supplier_language: "en" } };
function Sample() { const { t } = useSupplierTranslation(); return <><SupplierLanguageSelector /><h1>{t("Brouillon")}</h1><p>{t("Sélectionnez au moins une catégorie pour le handling fournisseur.")}</p></>; }
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); mocks.updateUser.mockResolvedValue({ data: {}, error: null }); document.documentElement.lang = "fr"; document.documentElement.dir = "ltr"; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("supplier language persistence and isolation", () => {
  it("switches EN ↔ Japanese without changing the public site preference", async () => {
    localStorage.setItem("lang", "fr");
    const view = render(<SupplierLanguageProvider user={user}><Sample /></SupplierLanguageProvider>);
    expect(screen.getByRole("heading")).toHaveTextContent("Draft");
    fireEvent.click(screen.getByRole("button", { name: "日本語" }));
    await waitFor(() => expect(mocks.updateUser).toHaveBeenCalledWith({ data: { supplier_language: "ja" } }));
    expect(screen.getByRole("heading")).toHaveTextContent("下書き");
    expect(screen.getByText("手配手数料の対象カテゴリーを1つ以上選択してください。")).toBeInTheDocument();
    expect(localStorage.getItem("lejapon:supplier-language:supplier-user")).toBe("ja");
    expect(localStorage.getItem("lang")).toBe("fr");
    expect(document.documentElement.lang).toBe("ja");
    await waitFor(() => expect(screen.getByRole("button", { name: "EN" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "EN" }));
    expect(screen.getByRole("heading")).toHaveTextContent("Draft");
    view.unmount(); expect(document.documentElement.lang).toBe("fr");
  });
  it("restores the saved account preference after a refresh", () => {
    render(<SupplierLanguageProvider user={{ ...user, user_metadata: { supplier_language: "ja" } }}><Sample /></SupplierLanguageProvider>);
    expect(screen.getByRole("heading")).toHaveTextContent("下書き");
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });
  it("persists the guest language and adopts it for the first authenticated session", async () => {
    const view = render(<SupplierLanguageProvider><Sample /></SupplierLanguageProvider>);
    fireEvent.click(screen.getByRole("button", { name: "日本語" }));
    view.unmount();
    render(<SupplierLanguageProvider user={{ id: "new-user" }}><Sample /></SupplierLanguageProvider>);
    expect(screen.getByRole("heading")).toHaveTextContent("下書き");
    await waitFor(() => expect(mocks.updateUser).toHaveBeenCalledWith({ data: { supplier_language: "ja" } }));
  });
  it("uses per-account storage so another supplier's language does not leak", () => {
    localStorage.setItem("lejapon:supplier-language:supplier-user", "ja");
    expect(initialSupplierLanguage({ id: "different-user" })).toBe("en");
  });
  it("keeps the local language and exposes failures when email preference synchronization fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.updateUser.mockResolvedValue({ data: null, error: { code: "401", message: "invalid_token" } });
    render(<SupplierLanguageProvider user={user}><Sample /></SupplierLanguageProvider>);
    fireEvent.click(screen.getByRole("button", { name: "日本語" }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining("メールの言語設定を保存できませんでした")));
    expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining("invalid_token"));
    expect(initialSupplierLanguage(user)).toBe("ja");
    expect(console.error).toHaveBeenCalled();
  });
  it("keeps staff pages French when no supplier provider is present", () => {
    render(<Sample />); expect(screen.getByRole("heading")).toHaveTextContent("Brouillon");
  });
});
describe("translation catalogue and diagnostics", () => {
  it("uses distinct commercial and booking workflow terminology", () => {
    const en = createSupplierTranslator("en"), ja = createSupplierTranslator("ja");
    for (const [source, english, japanese] of [
      ["Brouillon", "Draft", "下書き"], ["Soumis", "Submitted", "提出済み"],
      ["Révision demandée", "Revision requested", "修正依頼"], ["Approuvé", "Approved", "承認済み"],
      ["À réserver", "To book", "手配待ち"], ["Réservations en cours", "Booking in progress", "手配中"],
      ["Réservations confirmées", "Confirmed", "手配確定"],
    ]) { expect(en(source)).toBe(english); expect(ja(source)).toBe(japanese); }
  });
  it("provides both languages and preserves every interpolation placeholder", () => {
    const placeholders = (text: string) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map(match => match[1]).sort();
    for (const [source, value] of Object.entries(catalog)) for (const language of ["en", "ja"] as const) {
      expect(value[language], `${language}: ${source}`).toBeTruthy();
      expect(placeholders(value[language]), source).toEqual(placeholders(source));
    }
  });
  it.each(["en", "ja"] as const)("translates generated Excel warnings without translating source values in %s", language => {
    const t = createSupplierTranslator(language);
    const source = "Date Excel non reconnue : Hôtel Sakura 東京.";
    expect(t(source)).toContain("Hôtel Sakura 東京");
    expect(t(source)).not.toContain("Date Excel non reconnue");
    expect(t("Erreur Excel #VALUE! ignorée en H23.")).toContain("H23");
    expect(t("Erreur Excel #VALUE! ignorée en H23.")).not.toContain("Erreur Excel");
  });
  it.each(["en", "ja"] as const)("localizes backend errors while preserving their exact diagnostic details in %s", language => {
    const message = supplierErrorMessage(createSupplierTranslator(language), { code: "42501", message: "permission denied for supplier_can_access_trip", details: "table hotels" });
    expect(message).toContain(language === "en" ? "Permission denied." : "操作権限がありません");
    expect(message).toContain("42501 · permission denied for supplier_can_access_trip · table hotels");
  });
});
