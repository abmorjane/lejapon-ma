import { supplierErrorMessage, useSupplierTranslation } from "@/i18n/supplier/SupplierLanguageProvider";
import { SupplierHandlingFields } from "./SupplierHandlingFields";
import { HANDLING_CATEGORY_LABELS, type SupplierHandlingTerms } from "@/admin/lib/supplier-quote-business-model";
import { AlertTriangle, CheckCircle2, MinusCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  supplierQuoteImportRowImpactJpy,
  supplierQuoteImportHandlingErrors, supplierQuoteImportHandlingDifference,
  type SupplierQuoteAmbiguousResolution,
  type SupplierQuoteExcelPreview,
  type SupplierQuoteImportSection,
} from "@/admin/lib/supplier-quote-excel-import";

type Props = {
  open: boolean;
  preview: SupplierQuoteExcelPreview | null;
  importMode: "direct" | "new_version";
  nextVersionNumber: number;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  onHandlingChange: (terms: SupplierHandlingTerms, acknowledged?: boolean) => void;
  onResolutionChange: (sourceRow: number, resolution: SupplierQuoteAmbiguousResolution) => void;
};

const sectionLabels: Record<SupplierQuoteImportSection, string> = {
  hotels: "Hébergement",
  transport: "Transport",
  activities: "Activités",
  guides: "Guides",
  other: "Autres",
};

const stateLabel = {
  recognized: "Reconnue",
  review: "À vérifier",
  ignored: "Ignorée",
} as const;

const StateIcon = ({ state }: { state: "recognized" | "review" | "ignored" }) => {
  if (state === "recognized") return <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />;
  if (state === "review") return <AlertTriangle className="h-4 w-4 text-amber-600" aria-hidden="true" />;
  return <MinusCircle className="h-4 w-4 text-muted-foreground" aria-hidden="true" />;
};

const formatJpy = (value: number | null) => value === null ? "—" : `${Math.round(value).toLocaleString("fr-FR")} ¥`;
const formatPercentage = (value: number | null) => value === null
  ? "non détecté"
  : `${value.toLocaleString("fr-FR", { maximumFractionDigits: 4 })}%`;

export function SupplierQuoteExcelImportDialog({
  open,
  preview,
  importMode,
  nextVersionNumber,
  busy,
  onOpenChange,
  onConfirm,
  onResolutionChange, onHandlingChange,
}: Props) {
  const { t } = useSupplierTranslation();
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !busy && onOpenChange(nextOpen)}>
      <DialogContent className="flex max-h-[92dvh] max-w-6xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b px-6 py-4 pr-12">
          <DialogTitle>{t("Import Excel")}</DialogTitle>
          <DialogDescription> {t("Prévisualisation de la première feuille uniquement. Les autres feuilles ne sont jamais analysées.")} </DialogDescription>
        </DialogHeader>

        {preview && (
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">{t("Première feuille détectée")}</p>
                <p className="mt-1 font-medium">{preview.sheetName}</p>
                <p className="mt-1 truncate text-xs text-muted-foreground" title={preview.fileName}>{preview.fileName}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">{t("Lignes reconnues")}</p>
                <p className="mt-1 text-xl font-semibold">{preview.counts.recognized}</p>
              </div>
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-950">
                <p className="text-xs">{t("Lignes à vérifier")}</p>
                <p className="mt-1 text-xl font-semibold">{preview.counts.review}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">{t("Lignes ignorées")}</p>
                <p className="mt-1 text-xl font-semibold">{preview.counts.ignored}</p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {(Object.keys(sectionLabels) as SupplierQuoteImportSection[]).map((section) => (
                <Badge key={section} variant="outline">
                  {t(sectionLabels[section])} {preview.counts.bySection[section]}
                </Badge>
              ))}
              <Badge variant="secondary">{preview.ignoredSheetCount} {t("autre(s) feuille(s) ignorée(s)")}</Badge>
            </div>

            {preview.handling.detected && (
              <div className="space-y-3 rounded-lg border border-sky-200 bg-sky-50 p-4 text-sky-950">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <div>
                    <p className="text-xs">{t("Sous-total services avant handling (source)")}</p>
                    <p className="mt-1 text-lg font-semibold tabular-nums">{formatJpy(preview.financialSummary.sourceServiceSubtotalJpy)}</p>
                  </div>
                  <div>
                    <p className="text-xs">{t("Handling fournisseur :")} {t(formatPercentage(preview.financialSummary.supplierHandlingPercentage))}</p>
                    <p className="mt-1 text-lg font-semibold tabular-nums">{formatJpy(preview.financialSummary.supplierHandlingJpy)}</p>
                  </div>
                  <div>
                    <p className="text-xs">{t("Total fournisseur final (source)")}</p>
                    <p className="mt-1 text-lg font-semibold tabular-nums">{formatJpy(preview.financialSummary.sourceFinalSupplierTotalJpy)}</p>
                  </div>
                  <div>
                    <p className="text-xs">{t("Total fournisseur projeté")}</p>
                    <p className="mt-1 text-lg font-semibold tabular-nums">{formatJpy(preview.financialSummary.calculatedSupplierTotalJpy)}</p>
                  </div>
                </div>
                {preview.handling.suggestedCategories && <p className="text-sm">{t("Périmètre suggéré par le montant source :")} {preview.handling.suggestedCategories.map(category=>t(HANDLING_CATEGORY_LABELS[category])).join(", ")}{t(". Vérifiez les conditions retenues ci-dessous.")}</p>}
                <SupplierHandlingFields value={preview.handling} disabled={busy} onChange={terms=>onHandlingChange(terms)} />
                <p className="text-sm">{preview.handling.scopeOrigin==="inferred" ? t("Périmètre suggéré par le montant source : à confirmer.") : !preview.handling.confirmed ? t("Handling scope: confirmation required") : t("Périmètre confirmé par le fournisseur.")}</p>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={preview.handling.confirmed} disabled={busy} onChange={event=>event.target.checked && onHandlingChange(preview.handling)} /> {t("Je confirme le pourcentage et les catégories du handling.")}</label>
                {supplierQuoteImportHandlingDifference(preview)!==null && Math.abs(supplierQuoteImportHandlingDifference(preview)!)>0.01 && <div role="alert" className="space-y-2 text-sm">
                  <p>{t("Écart du handling calculé avec le montant source :")} {formatJpy(supplierQuoteImportHandlingDifference(preview))}{t(". Le montant source ne sera pas modifié.")}</p>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={preview.handling.mismatchAcknowledged} disabled={busy} onChange={event=>onHandlingChange(preview.handling,event.target.checked)} /> {t("J’accepte explicitement le handling recalculé et son écart avec la source.")}</label>
                </div>}
                {supplierQuoteImportHandlingErrors(preview).map(error=><p role="alert" className="text-sm" key={error}>{supplierErrorMessage(t, error)}</p>)}
                <p className="text-xs"> {t("Le handling est calculé au niveau du devis sur les catégories confirmées. Le montant source reste conservé dans l’audit.")} </p>
              </div>
            )}

            {preview.financialSummary.travelOsVarianceJpy !== null
              && Math.abs(preview.financialSummary.travelOsVarianceJpy) > 1 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
                  <div className="flex items-center gap-2 font-medium">
                    <AlertTriangle className="h-4 w-4" aria-hidden="true" /> {t("Réconciliation à vérifier avant confirmation")} </div>
                  <p className="mt-1 text-xs"> {t("Services recalculés")} {formatJpy(preview.financialSummary.calculatedServiceSubtotalJpy)} {t("+ handling")} {formatJpy(preview.financialSummary.supplierHandlingJpy)} {t("= total fournisseur importé")} {formatJpy(preview.financialSummary.calculatedSupplierTotalJpy)}{t(". Écart avec le total fournisseur Excel :")} {formatJpy(preview.financialSummary.travelOsVarianceJpy)}.
                  </p>
                </div>
              )}

            <div className={`rounded-lg border p-3 text-sm ${importMode === "new_version" ? "border-amber-200 bg-amber-50 text-amber-950" : "bg-muted/40"}`}>
              {importMode === "new_version"
                ? t("Sécurité versioning : le devis courant reste intact. L’import créera V{{value0}} en brouillon.", { value0: nextVersionNumber })
                : t("Le brouillon courant ne contient aucune ligne enregistrée : l’import sera ajouté directement à cette version.")}
            </div>

            {preview.counts.unresolved > 0 && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
                <div className="flex items-center gap-2 font-medium">
                  <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                  {preview.counts.unresolved} {t("ligne(s) nécessitent une décision")} </div>
                <p className="mt-1 text-xs">{t("L’import reste bloqué tant que chaque sous-total Excel non renseigné n’a pas été traité explicitement.")}</p>
              </div>
            )}

            {preview.workbookWarnings.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
                <div className="flex items-center gap-2 font-medium">
                  <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                  {preview.workbookWarnings.length} {t("erreur(s) Excel neutralisée(s)")} </div>
                <p className="mt-1 text-xs">{preview.workbookWarnings.map(warning => t(warning)).join(" ")}</p>
              </div>
            )}

            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[110px]">{t("Catégorie")}</TableHead>
                    <TableHead className="min-w-[260px]">{t("Description")}</TableHead>
                    <TableHead className="min-w-[170px]">{t("Dates")}</TableHead>
                    <TableHead className="text-right">{t("Quantité")}</TableHead>
                    <TableHead className="text-right">{t("Prix")}</TableHead>
                    <TableHead className="text-right">{t("Sous-total Excel")}</TableHead>
                    <TableHead className="text-right">{t("Calcul Travel OS")}</TableHead>
                    <TableHead className="text-right">{t("Impact retenu")}</TableHead>
                    <TableHead className="min-w-[190px]">{t("Décision")}</TableHead>
                    <TableHead className="min-w-[130px]">{t("État")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.rows.map((row) => (
                    <TableRow key={`${row.sourceRow}-${row.section}-${row.description}`}>
                      <TableCell className="py-3 text-xs">{row.kind==="supplier_handling" ? t("Handling du devis") : t(sectionLabels[row.section])}</TableCell>
                      <TableCell className="py-3">
                        <p className="font-medium">{row.state === "ignored" && row.warnings.includes("Total Excel conservé uniquement pour contrôle et non importé comme prestation.") ? t(row.description) : row.description}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">{t("Ligne Excel")} {row.sourceRow}</p>
                        {row.warnings.length > 0 && <p className="mt-1 text-xs text-amber-700">{row.warnings.map(warning => t(warning)).join(" ")}</p>}
                      </TableCell>
                      <TableCell className="py-3 text-xs">
                        {row.startDate || row.endDate ? `${row.startDate ?? "—"}${row.endDate ? ` → ${row.endDate}` : ""}` : "—"}
                      </TableCell>
                      <TableCell className="py-3 text-right tabular-nums">{row.quantity ?? "—"}</TableCell>
                      <TableCell className="py-3 text-right tabular-nums">{formatJpy(row.unitPriceJpy)}</TableCell>
                      <TableCell className="py-3 text-right tabular-nums">{row.excelSubtotalJpy === null ? t("Non renseigné") : formatJpy(row.excelSubtotalJpy)}</TableCell>
                      <TableCell className="py-3 text-right font-medium tabular-nums">{formatJpy(row.calculatedSubtotalJpy)}</TableCell>
                      <TableCell className="py-3 text-right font-medium tabular-nums">{formatJpy(supplierQuoteImportRowImpactJpy(row))}</TableCell>
                      <TableCell className="py-3">
                        {row.requiresResolution ? (
                          <Select
                            value={row.resolution ?? undefined}
                            onValueChange={(value) => onResolutionChange(row.sourceRow, value as SupplierQuoteAmbiguousResolution)}
                            disabled={busy}
                          >
                            <SelectTrigger className="h-8"><SelectValue placeholder={t("Choisir…")} /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="include_recalculated">{t("Inclure le recalcul")}</SelectItem>
                              <SelectItem value="import_uncharged">{t("Importer non chiffré")}</SelectItem>
                              <SelectItem value="ignore">{t("Ignorer la ligne")}</SelectItem>
                            </SelectContent>
                          </Select>
                        ) : "—"}
                      </TableCell>
                      <TableCell className="py-3">
                        <span className="inline-flex items-center gap-1.5 text-xs">
                          <StateIcon state={row.state} /> {t(stateLabel[row.state])}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <p className="text-xs text-muted-foreground"> {t("Les lignes sans sous-total Excel exigent une décision. « Inclure le recalcul » retient le montant Travel OS, « Importer non chiffré » conserve la prestation avec un impact nul, et « Ignorer » ne crée aucune ligne.")} </p>
          </div>
        )}

        <DialogFooter className="gap-2 px-6 py-4 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>{t("Annuler")}</Button>
          <Button onClick={onConfirm} disabled={busy || !preview || preview.counts.importable === 0 || preview.counts.unresolved > 0 || Boolean(preview && supplierQuoteImportHandlingErrors(preview).length)}>
            {busy ? t("Import en cours…") : t("Confirmer l’import")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
