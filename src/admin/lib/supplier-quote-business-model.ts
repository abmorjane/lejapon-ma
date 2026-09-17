import type { SupplierQuoteSection } from "./supplier-quote-section-loader";

export const HANDLING_CATEGORIES: SupplierQuoteSection[] = ["hotels", "transport", "activities", "guides", "other"];
export const HANDLING_CATEGORY_LABELS: Record<SupplierQuoteSection, string> = {
  hotels: "Hôtels", transport: "Transport", activities: "Activités / tickets", guides: "Guides", other: "Autres coûts",
};
export type SupplierHandlingTerms = { percentage: number; categories: SupplierQuoteSection[] };
export type SupplierCategoryTotals = Record<SupplierQuoteSection, number>;
export type SupplierExecutionStatus = "to_book" | "booking_in_progress" | "operationally_confirmed";
export const EXECUTION_STATUS_LABELS: Record<SupplierExecutionStatus, string> = {
  to_book: "À réserver", booking_in_progress: "Réservations en cours", operationally_confirmed: "Réservations confirmées",
};

export function supplierHandlingErrors(terms: SupplierHandlingTerms): string[] {
  if (!Number.isFinite(terms.percentage) || terms.percentage < 0 || terms.percentage > 100) return ["Le handling fournisseur doit être un pourcentage valide entre 0 et 100 %."];
  if (terms.categories.some((category) => !HANDLING_CATEGORIES.includes(category)) || new Set(terms.categories).size !== terms.categories.length) return ["Le périmètre du handling contient une catégorie invalide ou dupliquée."];
  if (terms.percentage > 0 && !terms.categories.length) return ["Sélectionnez au moins une catégorie pour le handling fournisseur."];
  return [];
}

// Client projections only. Persisted amounts must be calculated by PostgreSQL.
export function calculateSupplierHandling(totals: SupplierCategoryTotals, terms: SupplierHandlingTerms) {
  const errors = supplierHandlingErrors(terms);
  if (errors.length) throw new Error(errors[0]);
  if (Object.values(totals).some((amount) => !Number.isFinite(amount) || amount < 0)) throw new Error("Sous-total fournisseur invalide.");
  const servicesSubtotalJpy = HANDLING_CATEGORIES.reduce((sum, category) => sum + totals[category], 0);
  const handlingBaseJpy = terms.categories.reduce((sum, category) => sum + totals[category], 0);
  const handlingAmountJpy = Math.round((handlingBaseJpy * terms.percentage / 100 + Number.EPSILON) * 100) / 100;
  return { servicesSubtotalJpy, handlingBaseJpy, handlingAmountJpy, supplierTotalJpy: servicesSubtotalJpy + handlingAmountJpy };
}

// Suggest a scope only when exactly one of the 31 category combinations matches.
// Zero-value categories still make scopes distinct: never silently choose all.
export function inferSupplierHandlingScope(totals: SupplierCategoryTotals, percentage: number | null, sourceAmount: number | null): SupplierQuoteSection[] | null {
  if (percentage === null || sourceAmount === null || !Number.isFinite(percentage) || percentage <= 0 || percentage > 100 || !Number.isFinite(sourceAmount) || sourceAmount < 0) return null;
  const matches: SupplierQuoteSection[][] = [];
  for (let mask = 1; mask < 32; mask++) {
    const categories = HANDLING_CATEGORIES.filter((_, index) => mask & (1 << index));
    if (Math.abs(calculateSupplierHandling(totals, { percentage, categories }).handlingAmountJpy - sourceAmount) <= 0.01) matches.push(categories);
  }
  return matches.length === 1 ? matches[0] : null;
}

export function quoteCommercialActionAllowed(actor: "supplier" | "staff", action: "draft" | "submitted" | "revision_requested" | "approved") {
  return actor === "supplier" ? ["draft", "submitted"].includes(action) : ["revision_requested", "approved"].includes(action);
}

export function quotationFinancialErrors(totals: SupplierCategoryTotals, terms: SupplierHandlingTerms): string[] {
  const errors = supplierHandlingErrors(terms);
  if (Object.values(totals).some((amount) => !Number.isFinite(amount) || amount < 0)) errors.push("Les montants actifs du devis doivent être valides.");
  if (!Object.values(totals).some((amount) => amount > 0)) errors.push("Renseignez au moins un montant fournisseur avant de soumettre le devis.");
  return errors;
}
