import { HANDLING_CATEGORIES, HANDLING_CATEGORY_LABELS, supplierHandlingErrors, type SupplierHandlingTerms } from "@/admin/lib/supplier-quote-business-model";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function SupplierHandlingFields({ value, disabled = false, onChange }: {
  value: SupplierHandlingTerms; disabled?: boolean; onChange: (value: SupplierHandlingTerms) => void;
}) {
  const entireQuote = HANDLING_CATEGORIES.every((category) => value.categories.includes(category));
  return <fieldset disabled={disabled} className="space-y-3">
    <legend className="mb-2 font-medium">Handling fournisseur</legend>
    <Label className="flex flex-wrap items-center gap-2">
      Pourcentage fournisseur (%)
      <Input aria-label="Pourcentage handling fournisseur" className="w-28" type="number" min={0} max={100} step={0.01}
        value={Number.isNaN(value.percentage) ? "" : value.percentage} onChange={(event) => onChange({ ...value, percentage: event.target.value === "" ? Number.NaN : Number(event.target.value) })} />
    </Label>
    <p className="text-sm">Le handling s’applique aux catégories suivantes :</p>
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={entireQuote} onChange={(event) => onChange({ ...value, categories: event.target.checked ? [...HANDLING_CATEGORIES] : [] })} />
      Devis entier
    </label>
    {!entireQuote && <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {HANDLING_CATEGORIES.map((category) => <label key={category} className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={value.categories.includes(category)} onChange={(event) => onChange({ ...value,
          categories: HANDLING_CATEGORIES.filter((key) => key === category ? event.target.checked : value.categories.includes(key)),
        })} />{HANDLING_CATEGORY_LABELS[category]}
      </label>)}
    </div>}
    {supplierHandlingErrors(value).map((error) => <p key={error} role="alert" className="text-sm text-destructive">{error}</p>)}
    <p className="text-xs text-muted-foreground">Seules les lignes incluses des catégories sélectionnées entrent dans la base de calcul.</p>
  </fieldset>;
}
