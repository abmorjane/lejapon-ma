import { beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import "@/i18n";
import { setLang } from "@/i18n";
import { getConsent, openConsentPreferences } from "@/lib/consent";
import { ConsentManager } from "./ConsentManager";

const show = (path = "/voyages") => render(<MemoryRouter initialEntries={[path]}><ConsentManager /></MemoryRouter>);

describe("public consent UI", () => {
  beforeEach(() => {
    localStorage.clear();
    window.__LEJAPON_PRERENDER__ = false;
    setLang("fr");
  });

  it("shows equally accessible accept and reject actions without blocking booking", async () => {
    show();
    expect(await screen.findByRole("button", { name: "Tout accepter" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Tout refuser" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Tout refuser" }));
    expect(getConsent().status).toBe("denied");
    expect(screen.queryByRole("button", { name: "Tout accepter" })).toBeNull();
  });

  it("can customize independently and reopen saved preferences", async () => {
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Personnaliser" }));
    fireEvent.click(screen.getByRole("switch", { name: "Mesure d’audience" }));
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer mes choix" }));
    expect(getConsent().preferences).toMatchObject({ analytics: true, marketing: false });
    act(() => openConsentPreferences());
    expect(await screen.findByRole("dialog")).toBeVisible();
    expect(screen.getByRole("switch", { name: "Mesure d’audience" })).toHaveAttribute("aria-checked", "true");
  });

  it("never renders the banner during prerender or on a private route", async () => {
    window.__LEJAPON_PRERENDER__ = true;
    const first = show();
    expect(screen.queryByRole("button", { name: "Tout accepter" })).toBeNull();
    first.unmount();
    window.__LEJAPON_PRERENDER__ = false;
    show("/accord-voyage/private-token");
    expect(screen.queryByRole("button", { name: "Tout accepter" })).toBeNull();
  });

  it("renders Arabic controls in RTL", async () => {
    setLang("ar");
    show("/ar/faq");
    const accept = await screen.findByRole("button", { name: "قبول الكل" });
    expect(accept.closest("aside")).toHaveAttribute("dir", "rtl");
  });

  it("renders the English choice and preferences without changing categories", async () => {
    setLang("en");
    show("/en/faq");
    expect(await screen.findByRole("button", { name: "Accept all" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Reject all" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Customize" }));
    expect(await screen.findByRole("switch", { name: "Audience measurement" })).toBeVisible();
    expect(screen.getByRole("switch", { name: "Marketing" })).toBeVisible();
  });

  it("leaves consent unknown when the preferences dialog closes without saving", async () => {
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Personnaliser" }));
    fireEvent.click(screen.getByRole("switch", { name: "Marketing" }));
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(getConsent().status).toBe("unknown");
    expect(screen.getByRole("button", { name: "Tout refuser" })).toBeVisible();
  });
});
