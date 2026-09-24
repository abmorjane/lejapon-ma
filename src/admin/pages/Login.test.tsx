import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminLogin from "./Login";

const mocks = vi.hoisted(() => ({
  signIn: vi.fn(),
  signUp: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  recaptcha: {
    enabled: true,
    bypass: false,
    error: null as string | null,
    executeRecaptcha: vi.fn(),
    verify: vi.fn(),
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: null,
    roles: [],
    loading: false,
    signIn: mocks.signIn,
    signUp: mocks.signUp,
  }),
}));

vi.mock("@/hooks/useRecaptcha", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/hooks/useRecaptcha")>(),
  useRecaptcha: () => mocks.recaptcha,
}));
vi.mock("@/lib/pwa-display-mode", () => ({ isStandalonePwa: () => false }));
vi.mock("sonner", () => ({ toast: { error: mocks.toastError, success: mocks.toastSuccess } }));
vi.mock("@/i18n/supplier/SupplierLanguageProvider", () => ({
  useSupplierTranslation: () => ({ t: (value: string) => value, language: "fr" }),
  supplierErrorMessage: (_translate: unknown, message: string) => message,
  SupplierLanguageSelector: () => null,
}));

const fillCredentials = () => {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "admin@lejapon.test" } });
  fireEvent.change(screen.getByLabelText("Mot de passe"), { target: { value: "password123" } });
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.recaptcha.enabled = true;
  mocks.recaptcha.bypass = false;
  mocks.recaptcha.error = null;
  mocks.recaptcha.executeRecaptcha.mockResolvedValue("captcha-token");
  mocks.recaptcha.verify.mockResolvedValue({ ok: true });
  mocks.signIn.mockResolvedValue({ error: null });
  mocks.signUp.mockResolvedValue({ error: null });
});

describe("AdminLogin reCAPTCHA policy", () => {
  it("continues password sign-in after a technical captcha failure", async () => {
    mocks.recaptcha.error = "recaptcha_script_unavailable";
    mocks.recaptcha.executeRecaptcha.mockRejectedValue(new Error("script unavailable"));
    render(<MemoryRouter><AdminLogin /></MemoryRouter>);
    fillCredentials();
    fireEvent.click(screen.getByRole("button", { name: "Se connecter" }));
    await waitFor(() => expect(mocks.signIn).toHaveBeenCalledWith("admin@lejapon.test", "password123"));
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it("blocks password sign-in after an explicit low-score response", async () => {
    mocks.recaptcha.verify.mockResolvedValue({ ok: false, reason: "low_score" });
    render(<MemoryRouter><AdminLogin /></MemoryRouter>);
    fillCredentials();
    fireEvent.click(screen.getByRole("button", { name: "Se connecter" }));
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalled());
    expect(mocks.signIn).not.toHaveBeenCalled();
  });

  it("keeps signup blocked after a technical captcha failure", async () => {
    mocks.recaptcha.error = "recaptcha_script_unavailable";
    mocks.recaptcha.executeRecaptcha.mockRejectedValue(new Error("script unavailable"));
    render(<MemoryRouter><AdminLogin /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Créer" }));
    fireEvent.change(screen.getByLabelText("Nom complet"), { target: { value: "Admin Test" } });
    fillCredentials();
    fireEvent.click(screen.getByRole("button", { name: "Créer le compte" }));
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalled());
    expect(mocks.signUp).not.toHaveBeenCalled();
  });
});
