import { supplierErrorMessage, useSupplierTranslation } from "@/i18n/supplier/SupplierLanguageProvider";
import { HANDLING_CATEGORIES, HANDLING_CATEGORY_LABELS } from "@/admin/lib/supplier-quote-business-model";
import { Card } from "@/components/ui/card";
import type { SupplierQuoteSection } from "@/admin/lib/supplier-quote-section-loader";

export type SupplierQuoteVersionChange = { section: SupplierQuoteSection | "handling"; detail: string; kind: "added" | "removed" | "changed" };

export function SupplierQuoteVersionHistory({ previousVersion, changes, error, loading }: {
  previousVersion: number; changes: SupplierQuoteVersionChange[]; error?: string | null; loading?: boolean;
}) {
  const { t } = useSupplierTranslation();
  return <Card className="p-4">
    <details key={previousVersion}>
      <summary className="cursor-pointer space-y-2">
        <span className="font-display text-lg">{t("Évolutions depuis V")}{previousVersion}</span>
        <span className="block text-sm text-muted-foreground">
          {loading ? t("Comparaison en cours…") : error ? t("Comparaison indisponible") : t("{{value0}} ajout(s) · {{value1}} retrait(s) · {{value2}} modification(s)", { value0: changes.filter((change) => change.kind === "added").length, value1: changes.filter((change) => change.kind === "removed").length, value2: changes.filter((change) => change.kind === "changed").length })}
        </span>
        {!loading && !error && <span className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {[...HANDLING_CATEGORIES, "handling" as const].map((section) => <span key={section}>
            {section === "handling" ? t("Handling fournisseur") : t(HANDLING_CATEGORY_LABELS[section])} : {changes.filter((change) => change.section === section).length}
          </span>)}
        </span>}
      </summary>
      {error ? <p role="alert" className="mt-3 break-words text-sm text-destructive">{supplierErrorMessage(t, error)}</p> : !loading && <div className="mt-4 space-y-3">
        {!changes.length && <p className="text-sm text-muted-foreground">{t("Aucune différence enregistrée.")}</p>}
        {[...HANDLING_CATEGORIES, "handling" as const].map((section) => {
          const group = changes.filter((change) => change.section === section);
          return group.length > 0 && <details key={section} className="rounded-lg border p-3">
            <summary className="cursor-pointer text-sm font-medium">{section === "handling" ? t("Handling fournisseur") : t(HANDLING_CATEGORY_LABELS[section])} · {group.length}</summary>
            <ul className="mt-3 space-y-2 break-words text-sm">{group.map((change, index) => <li key={index}>{t(change.detail)}</li>)}</ul>
          </details>;
        })}
      </div>}
    </details>
  </Card>;
}
