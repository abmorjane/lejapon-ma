export const PAYMENT_METHOD_OPTIONS = [
  { value: "cash", label: "Espèces", legacy: ["especes", "espèces", "cash"] },
  { value: "bank_transfer", label: "Virement bancaire", legacy: ["virement", "virement bancaire", "bank_transfer", "wire"] },
  { value: "card", label: "Carte bancaire", legacy: ["carte", "carte bancaire", "card"] },
  { value: "cheque", label: "Chèque", legacy: ["cheque", "chèque", "check"] },
  { value: "agency_payment", label: "Versement agence", legacy: ["versement agence", "agency_payment", "agency"] },
  { value: "other", label: "Autre", legacy: ["other", "autre"] },
] as const;

export type PaymentMethodValue = (typeof PAYMENT_METHOD_OPTIONS)[number]["value"];

export const normalisePaymentMethod = (value: string | null | undefined): PaymentMethodValue => {
  const raw = String(value ?? "").trim().toLowerCase();
  const found = PAYMENT_METHOD_OPTIONS.find((option) =>
    option.value === raw || option.legacy.includes(raw)
  );
  return found?.value ?? "other";
};

export const paymentMethodLabel = (value: string | null | undefined) => {
  const normalised = normalisePaymentMethod(value);
  return PAYMENT_METHOD_OPTIONS.find((option) => option.value === normalised)?.label ?? value ?? "Autre";
};
