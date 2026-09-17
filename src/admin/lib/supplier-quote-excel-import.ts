import { calculateSupplierHandling, inferSupplierHandlingScope, supplierHandlingErrors, HANDLING_CATEGORIES, type SupplierHandlingTerms } from "./supplier-quote-business-model";
import type { CellObject, WorkBook, WorkSheet } from "xlsx";

export type SupplierQuoteImportSection = "hotels" | "transport" | "activities" | "guides" | "other";
export type SupplierQuoteImportState = "recognized" | "review" | "ignored";
export type SupplierQuoteImportKind = "service" | "supplier_handling";
export type SupplierQuoteAmbiguousResolution = "include_recalculated" | "import_uncharged" | "ignore";

export type SupplierQuoteImportRow = {
  sourceRow: number;
  section: SupplierQuoteImportSection;
  description: string;
  startDate: string | null;
  endDate: string | null;
  quantity: number | null;
  multiplier: number | null;
  unitPriceJpy: number | null;
  excelSubtotalJpy: number | null;
  calculatedSubtotalJpy: number;
  kind?: SupplierQuoteImportKind;
  handlingBaseJpy?: number | null;
  handlingPercentage?: number | null;
  handlingFormula?: string | null;
  handlingPercentageOrigin?: "label" | "cell" | "formula" | "amount_ratio" | "unknown";
  requiresResolution?: boolean;
  resolution?: SupplierQuoteAmbiguousResolution | null;
  state: SupplierQuoteImportState;
  warnings: string[];
  payload: Record<string, unknown> | null;
};

export type SupplierQuoteImportFinancialSummary = {
  sourceServiceSubtotalJpy: number | null;
  supplierHandlingJpy: number | null;
  supplierHandlingPercentage: number | null;
  sourceFinalSupplierTotalJpy: number | null;
  calculatedServiceSubtotalJpy: number;
  calculatedSupplierTotalJpy: number | null;
  sourceReconciliationDifferenceJpy: number | null;
  travelOsVarianceJpy: number | null;
};

export type SupplierQuoteExcelPreview = {
  fileName: string;
  sheetName: string;
  ignoredSheetCount: number;
  participantCount: number | null;
  handling: SupplierHandlingTerms & { detected: boolean; scopeOrigin: "inferred" | "confirmation_required" | "confirmed"; confirmed: boolean; mismatchAcknowledged: boolean; suggestedCategories?: SupplierQuoteImportSection[] | null };
  financialSummary: SupplierQuoteImportFinancialSummary;
  rows: SupplierQuoteImportRow[];
  workbookWarnings: string[];
  counts: {
    recognized: number;
    review: number;
    ignored: number;
    importable: number;
    unresolved: number;
    bySection: Record<SupplierQuoteImportSection, number>;
  };
};

type HistoricalSection = SupplierQuoteImportSection | "meal";

type ColumnMap = {
  date?: number;
  endDate?: number;
  description: number;
  unitPrice: number;
  quantity: number;
  multiplier: number;
  subtotal: number;
  notes: number;
};

type ParsedExcelDate = { y?: number; m?: number; d?: number } | null;
type ParseExcelDateCode = (serial: number) => ParsedExcelDate;

const EMPTY_COUNTS: Record<SupplierQuoteImportSection, number> = {
  hotels: 0,
  transport: 0,
  activities: 0,
  guides: 0,
  other: 0,
};

const EXCEL_ERROR_NAMES: Record<number, string> = {
  0x00: "#NULL!",
  0x07: "#DIV/0!",
  0x0f: "#VALUE!",
  0x17: "#REF!",
  0x1d: "#NAME?",
  0x24: "#NUM!",
  0x2a: "#N/A",
  0x2b: "#GETTING_DATA",
};

const normalizeText = (value: unknown) => String(value ?? "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[\u2010-\u2015]/g, "-")
  .replace(/\s+/g, " ")
  .trim()
  .toLowerCase();

const cleanText = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();

const errorLabel = (cell: CellObject | undefined) => {
  if (!cell) return null;
  if (cell.t === "e") return cell.w || EXCEL_ERROR_NAMES[Number(cell.v)] || "#ERROR!";
  const text = cleanText(cell.v);
  return /^#(?:REF!|VALUE!|N\/A|DIV\/0!|NAME\?|NUM!|NULL!)$/i.test(text) ? text.toUpperCase() : null;
};

const valueOf = (sheet: WorkSheet, row: number, column: number) => sheet[cellAddress(row, column)]?.v;

const cellAddress = (row: number, column: number) => {
  let label = "";
  let current = column + 1;
  while (current > 0) {
    const remainder = (current - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    current = Math.floor((current - 1) / 26);
  }
  return `${label}${row + 1}`;
};

const numberValue = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value instanceof Date) return null;
  const text = cleanText(value);
  if (!text || text === "-" || /^#/.test(text)) return null;
  const normalized = text
    .replace(/[¥￥\s]/g, "")
    .replace(/,(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const dateValue = (value: unknown, parseDateCode: ParseExcelDateCode): string | null => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = parseDateCode(value);
    if (!parsed || !parsed.y || !parsed.m || !parsed.d) return null;
    return `${String(parsed.y).padStart(4, "0")}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
  }
  const text = cleanText(value);
  if (!text || text === "-" || /^tbd$/i.test(text) || /^#/.test(text)) return null;
  const iso = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const european = text.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/);
  if (european) return `${european[3]}-${european[2].padStart(2, "0")}-${european[1].padStart(2, "0")}`;
  return null;
};

const rowCells = (sheet: WorkSheet, row: number, endColumn: number) =>
  Array.from({ length: endColumn + 1 }, (_, column) => sheet[cellAddress(row, column)]);

const rowText = (sheet: WorkSheet, row: number, endColumn: number) =>
  normalizeText(rowCells(sheet, row, Math.min(endColumn, 15)).map((cell) => cell?.v).filter((value) => value !== undefined).join(" | "));

const sectionFromTitle = (text: string): HistoricalSection | null => {
  if (/\baccommodation\b|\bhebergement\b/.test(text)) return "hotels";
  if (/entrance fee|activities|activites|visites?\b/.test(text)) return "activities";
  if (/\bmeal\b|\brepas\b/.test(text)) return "meal";
  if (/\bother\b|\bautres?\b/.test(text)) return "other";
  return null;
};

const findHeaderColumn = (sheet: WorkSheet, row: number, endColumn: number, patterns: RegExp[], fallback: number) => {
  for (let column = 0; column <= Math.min(endColumn, 15); column += 1) {
    const text = normalizeText(valueOf(sheet, row, column));
    if (patterns.some((pattern) => pattern.test(text))) return column;
  }
  return fallback;
};

const headerMap = (sheet: WorkSheet, row: number, endColumn: number, hotels: boolean): ColumnMap => ({
  date: findHeaderColumn(sheet, row, endColumn, hotels ? [/check.?in/] : [/^date$/], 1),
  endDate: hotels ? findHeaderColumn(sheet, row, endColumn, [/check.?out/], 2) : undefined,
  description: findHeaderColumn(sheet, row, endColumn, hotels ? [/hotel/] : [/contents?/, /description/, /prestation/], 3),
  unitPrice: findHeaderColumn(sheet, row, endColumn, [/^rate$/, /^price/, /prix/], 4),
  quantity: findHeaderColumn(sheet, row, endColumn, hotels ? [/^pax$/, /person/] : [/^no\.?$/, /nombre/, /pax/], 5),
  multiplier: findHeaderColumn(sheet, row, endColumn, hotels ? [/^nts?\.?$/, /nuit/] : [/times?/, /fois/], 6),
  subtotal: findHeaderColumn(sheet, row, endColumn, [/subtotal/, /sous.?total/], 8),
  notes: findHeaderColumn(sheet, row, endColumn, [/notes?/, /comment/], 9),
});

const classifyGenericBlock = (sheet: WorkSheet, headerRow: number, descriptionColumn: number, endRow: number) => {
  let guideSignals = 0;
  let otherSignals = 0;
  for (let row = headerRow + 1; row <= Math.min(endRow, headerRow + 20); row += 1) {
    if (rowText(sheet, row, 15).split(" | ").some((value) => value === "total")) break;
    const description = normalizeText(valueOf(sheet, row, descriptionColumn));
    if (!description) continue;
    if (/guide|assistant/.test(description)) guideSignals += 1;
    else otherSignals += 1;
  }
  return guideSignals > otherSignals ? "guides" as const : "transport" as const;
};

const roomMapping = (description: string) => {
  const normalized = normalizeText(description);
  let roomType: "double/twin" | "single" | "triple" | "TL" | null = null;
  let pattern: RegExp | null = null;
  if (/\bguide\s+(?:sgl|single)\b/.test(normalized)) {
    roomType = "TL";
    pattern = /\s+guide\s+(?:sgl|single)\s*$/i;
  } else if (/\btriple\b/.test(normalized)) {
    roomType = "triple";
    pattern = /\s+triple\s*$/i;
  } else if (/\b(?:sgl|single)\b/.test(normalized)) {
    roomType = "single";
    pattern = /\s+(?:sgl|single)(?:\s+deluxe?.*)?\s*$/i;
  } else if (/\b(?:twn|twin)\b/.test(normalized) || /\bking room\s*2\s*pax\b/.test(normalized)) {
    roomType = "double/twin";
    pattern = /\s+(?:(?:deluxe?|delux)\s+)?(?:twn|twin)\s*$|\s+deluxe?\s+king\s+room\s*2\s*pax\s*$/i;
  }
  const hotelName = pattern ? description.replace(pattern, "").trim() : description.trim();
  return { hotelName: hotelName || description.trim(), roomType };
};

const guideType = (description: string) => {
  const normalized = normalizeText(description);
  if (/assistant/.test(normalized)) return "assistant";
  if (/english/.test(normalized) && !/french/.test(normalized)) return "anglophone";
  if (/french|francais|francophone/.test(normalized)) return "francophone";
  return "other";
};

const guideCity = (description: string) => cleanText(description.match(/\(([^)]+)\)/)?.[1] ?? "");

const transportType = (description: string) => {
  const normalized = normalizeText(description);
  if (/metro/.test(normalized)) return "metro";
  if (/taxi/.test(normalized)) return "taxi";
  if (/shinkansen/.test(normalized)) return "shinkansen";
  if (/jr pass|train|station/.test(normalized)) return "train";
  if (/boat|ferry|ship|croisiere/.test(normalized)) return "boat";
  if (/luggage|bagage/.test(normalized)) return "other";
  return "bus";
};

const joinedComment = (...parts: Array<string | null | undefined>) => parts.map(cleanText).filter(Boolean).join(" · ") || null;

const mismatchWarning = (excelSubtotal: number | null, calculatedSubtotal: number) => {
  if (excelSubtotal === null || Math.abs(excelSubtotal - calculatedSubtotal) <= 1) return null;
  return `Écart de sous-total : Excel ${Math.round(excelSubtotal).toLocaleString("fr-FR")} JPY, Travel OS ${Math.round(calculatedSubtotal).toLocaleString("fr-FR")} JPY.`;
};

const rowErrors = (sheet: WorkSheet, row: number, endColumn: number) => rowCells(sheet, row, endColumn)
  .map((cell, column) => {
    const label = errorLabel(cell);
    return label ? `${label} (${cellAddress(row, column)})` : null;
  })
  .filter((value): value is string => Boolean(value));

const ignoredRow = (
  sourceRow: number,
  section: SupplierQuoteImportSection,
  description: string,
  excelSubtotalJpy: number | null,
  warning: string,
): SupplierQuoteImportRow => ({
  sourceRow,
  section,
  description,
  startDate: null,
  endDate: null,
  quantity: null,
  multiplier: null,
  unitPriceJpy: null,
  excelSubtotalJpy,
  calculatedSubtotalJpy: 0,
  state: "ignored",
  warnings: [warning],
  payload: null,
});

const percentageFromFormula = (cell: CellObject | undefined) => {
  const formula = cleanText(cell?.f);
  if (!formula) return null;
  const decimalFactor = formula.match(/\*\s*(0(?:[.,]\d+))/);
  if (decimalFactor) return numberValue(decimalFactor[1])! * 100;
  const percentageFactor = formula.match(/\*\s*(\d+(?:[.,]\d+)?)\s*%/);
  return percentageFactor ? numberValue(percentageFactor[1]) : null;
};

const importRow = (
  sheet: WorkSheet,
  row: number,
  section: HistoricalSection,
  columns: ColumnMap,
  parseDateCode: ParseExcelDateCode,
  endColumn: number,
): SupplierQuoteImportRow | null => {
  const description = cleanText(valueOf(sheet, row, columns.description));
  const notes = cleanText(valueOf(sheet, row, columns.notes));
  const unitPrice = numberValue(valueOf(sheet, row, columns.unitPrice));
  const sourceQuantity = numberValue(valueOf(sheet, row, columns.quantity));
  const sourceMultiplier = numberValue(valueOf(sheet, row, columns.multiplier));
  const excelSubtotal = numberValue(valueOf(sheet, row, columns.subtotal));
  const sourceDate = valueOf(sheet, row, columns.date ?? 1);
  const sourceEndDate = columns.endDate === undefined ? null : valueOf(sheet, row, columns.endDate);
  const startDate = dateValue(sourceDate, parseDateCode);
  const endDate = columns.endDate === undefined ? null : dateValue(sourceEndDate, parseDateCode);
  const errors = rowErrors(sheet, row, endColumn);

  if (!description) {
    if (unitPrice === null && sourceQuantity === null && sourceMultiplier === null && excelSubtotal === null && errors.length === 0) return null;
    return ignoredRow(row + 1, section === "meal" ? "other" : section, "Ligne sans description", excelSubtotal, "Ligne ignorée : aucune prestation identifiable.");
  }

  if (/handling|commission/.test(normalizeText(description))) {
    // This is a supplier handling fee, not supplier_trip_quotes.commission_percentage.
    // The latter is the staff-only agency/office commission and must remain untouched.
    const formulaPercentage = percentageFromFormula(sheet[cellAddress(row, columns.subtotal)]);
    const calculatedPercentage = unitPrice !== null && unitPrice > 0 && excelSubtotal !== null
      ? (excelSubtotal / unitPrice) * 100
      : null;
    const explicitPercentage = description.match(/(\d+(?:[.,]\d+)?)\s*%/);
    const formattedPercentage = [columns.quantity, columns.multiplier, columns.unitPrice].map((column) => {
      const cell=sheet[cellAddress(row,column)];
      const textPercentage=cleanText(cell?.w ?? cell?.v).match(/^(\d+(?:[.,]\d+)?)\s*%$/);
      return textPercentage ? Number(textPercentage[1].replace(",",".")) : cell && /%/.test(String(cell.z ?? "")) && typeof cell.v==="number" ? cell.v*100 : null;
    }).find(value=>value!==null);
    const handlingPercentage = explicitPercentage ? Number(explicitPercentage[1].replace(",",".")) : formattedPercentage ?? formulaPercentage ?? calculatedPercentage;
    const handlingAmount = excelSubtotal ?? (
      unitPrice !== null && handlingPercentage !== null
        ? unitPrice * handlingPercentage / 100
        : null
    );
    const warnings = errors.map((error) => `Erreur Excel ${error} ignorée.`);
    warnings.push("Handling fournisseur au niveau du devis ; son périmètre doit être confirmé. Aucun autre coût ne sera créé.");
    if (handlingAmount === null) warnings.push("Montant du handling fournisseur non reconnu.");
    if (unitPrice === null) warnings.push("Base de calcul du handling fournisseur non reconnue.");
    if (handlingPercentage === null) warnings.push("Pourcentage effectif du handling fournisseur non détecté.");
    const normalizedPercentage = handlingPercentage === null
      ? null
      : Math.round(handlingPercentage * 10000) / 10000;
    const normalizedAmount = handlingAmount ?? 0;
    return {
      sourceRow: row + 1,
      section: "other",
      description,
      startDate: null,
      endDate: null,
      quantity: 1,
      multiplier: 1,
      unitPriceJpy: handlingAmount,
      excelSubtotalJpy: excelSubtotal,
      calculatedSubtotalJpy: normalizedAmount,
      kind: "supplier_handling",
      handlingBaseJpy: unitPrice,
      handlingPercentage: normalizedPercentage,
      handlingFormula:sheet[cellAddress(row,columns.subtotal)]?.f ?? null,
      handlingPercentageOrigin:explicitPercentage ? "label" : formattedPercentage!=null ? "cell" : formulaPercentage!==null ? "formula" : calculatedPercentage!==null ? "amount_ratio" : "unknown",
      state: handlingAmount !== null && unitPrice !== null && handlingPercentage !== null ? "recognized" : "review",
      warnings,
      payload: null,
    };
  }

  const warnings = errors.map((error) => `Erreur Excel ${error} ignorée.`);
  let payload: Record<string, unknown>;
  let targetSection: SupplierQuoteImportSection = section === "meal" ? "other" : section;
  let quantity: number | null = sourceQuantity;
  let multiplier: number | null = sourceMultiplier;
  let calculatedSubtotal = 0;
  let requiresReview = false;

  if (section === "hotels") {
    const room = roomMapping(description);
    quantity = sourceQuantity;
    multiplier = sourceMultiplier;
    calculatedSubtotal = (unitPrice ?? 0) * (quantity ?? 0) * (multiplier ?? 0);
    if (!room.roomType) warnings.push("Type de chambre non reconnu automatiquement.");
    if (!startDate || !endDate) warnings.push("Dates d’hébergement incomplètes ou non reconnues.");
    if (unitPrice === null || quantity === null || multiplier === null) warnings.push("Prix, pax ou nuits manquant : la ligne sera importée avec zéro pour la valeur absente.");
    requiresReview = !room.roomType || !startDate || !endDate || unitPrice === null || quantity === null || multiplier === null;
    payload = {
      city: "",
      hotel_name: room.hotelName,
      check_in: startDate,
      check_out: endDate,
      nights: multiplier ?? 0,
      room_type: room.roomType ?? "double/twin",
      person_count: quantity ?? 0,
      rooms_count: quantity ?? 0,
      room_count: quantity ?? 0,
      price_per_person_per_night_jpy: unitPrice ?? 0,
      unit_price_jpy: unitPrice ?? 0,
      price_per_room_per_night_jpy: unitPrice ?? 0,
      comment: joinedComment(notes, `Libellé Excel : ${description}`),
    };
  } else if (section === "guides") {
    quantity = sourceQuantity !== null && sourceMultiplier !== null ? sourceQuantity * sourceMultiplier : null;
    calculatedSubtotal = (unitPrice ?? 0) * (quantity ?? 0);
    if (unitPrice === null || sourceQuantity === null || sourceMultiplier === null) warnings.push("Prix, nombre ou nombre de fois incomplet.");
    requiresReview = unitPrice === null || sourceQuantity === null || sourceMultiplier === null;
    payload = {
      service_date: startDate,
      day_number: null,
      city: guideCity(description),
      guide_type: guideType(description),
      guides_count: quantity ?? 0,
      guide_count: quantity ?? 0,
      daily_price_jpy: unitPrice ?? 0,
      comment: joinedComment(
        notes,
        `Libellé Excel : ${description}`,
        sourceQuantity !== null && sourceMultiplier === null ? `No Excel : ${sourceQuantity}` : null,
        sourceMultiplier !== null && sourceMultiplier !== 1 ? `Nombre de fois Excel : ${sourceMultiplier}` : null,
      ),
    };
  } else if (section === "transport") {
    quantity = sourceMultiplier;
    calculatedSubtotal = (unitPrice ?? 0) * (quantity ?? 0);
    if (unitPrice === null || sourceMultiplier === null) warnings.push("Prix ou nombre de fois incomplet.");
    requiresReview = unitPrice === null || sourceMultiplier === null;
    payload = {
      service_date: startDate,
      day_number: null,
      city_route: description,
      transport_type: transportType(description),
      description,
      quantity: quantity ?? 0,
      unit_price_jpy: unitPrice ?? 0,
      comment: joinedComment(notes, sourceQuantity !== null ? `No Excel : ${sourceQuantity}` : null),
    };
  } else if (section === "activities") {
    quantity = sourceQuantity !== null && sourceMultiplier !== null ? sourceQuantity * sourceMultiplier : null;
    calculatedSubtotal = (unitPrice ?? 0) * (quantity ?? 0);
    const dateWasProvided = cleanText(sourceDate) !== "";
    if (dateWasProvided && !startDate) warnings.push(`Date Excel non reconnue : ${cleanText(sourceDate)}.`);
    if (unitPrice === null || sourceQuantity === null || sourceMultiplier === null) warnings.push("Prix, participants ou nombre de fois incomplet.");
    requiresReview = (dateWasProvided && !startDate) || unitPrice === null || sourceQuantity === null || sourceMultiplier === null;
    payload = {
      service_date: startDate,
      day_number: null,
      activity_name: description,
      participant_count: quantity ?? 0,
      quantity: quantity ?? 0,
      unit_price_jpy: unitPrice ?? 0,
      optional: /optional|optionnel/.test(normalizeText(description)),
      comment: joinedComment(
        notes,
        sourceQuantity !== null && sourceMultiplier === null ? `No Excel : ${sourceQuantity}` : null,
        sourceMultiplier !== null && sourceMultiplier !== 1 ? `Nombre de fois Excel : ${sourceMultiplier}` : null,
      ),
    };
  } else {
    targetSection = "other";
    quantity = sourceQuantity !== null && sourceMultiplier !== null ? sourceQuantity * sourceMultiplier : null;
    calculatedSubtotal = (unitPrice ?? 0) * (quantity ?? 0);
    if (unitPrice === null || sourceQuantity === null || sourceMultiplier === null) warnings.push("Prix, nombre ou nombre de fois incomplet.");
    requiresReview = unitPrice === null || sourceQuantity === null || sourceMultiplier === null;
    payload = {
      label: section === "meal" ? `Repas — ${description}` : description,
      quantity: quantity ?? 0,
      unit_price_jpy: unitPrice ?? 0,
      comment: joinedComment(
        notes,
        `Section Excel : ${section === "meal" ? "Meal" : "Other"}`,
        sourceQuantity !== null && sourceMultiplier === null ? `No Excel : ${sourceQuantity}` : null,
      ),
    };
  }

  const mismatch = mismatchWarning(excelSubtotal, calculatedSubtotal);
  if (mismatch) {
    warnings.push(mismatch);
    requiresReview = true;
  }
  if (excelSubtotal === null && calculatedSubtotal > 0) {
    warnings.push(`Sous-total Excel absent : une décision explicite est requise pour l’impact de ${Math.round(calculatedSubtotal).toLocaleString("fr-FR")} JPY calculé par Travel OS.`);
    requiresReview = true;
  }
  const requiresResolution = excelSubtotal === null && calculatedSubtotal > 0;

  return {
    sourceRow: row + 1,
    section: targetSection,
    description,
    startDate,
    endDate,
    quantity,
    multiplier,
    unitPriceJpy: unitPrice,
    excelSubtotalJpy: excelSubtotal,
    calculatedSubtotalJpy: calculatedSubtotal,
    kind: "service",
    requiresResolution,
    resolution: requiresResolution ? null : undefined,
    state: requiresReview ? "review" : "recognized",
    warnings,
    payload,
  };
};

const detectParticipantCount = (sheet: WorkSheet, endRow: number, endColumn: number) => {
  for (let row = 0; row <= Math.min(endRow, 30); row += 1) {
    for (let column = 0; column <= Math.min(endColumn, 15); column += 1) {
      if (!/nbr\s*(?:de\s*)?pax|nombre\s*(?:de\s*)?pax|participant/.test(normalizeText(valueOf(sheet, row, column)))) continue;
      for (let offset = 1; offset <= 3; offset += 1) {
        const count = numberValue(valueOf(sheet, row, column + offset));
        if (count !== null && count >= 0) return Math.round(count);
      }
    }
  }
  return null;
};

const detectSourceFinalSupplierTotal = (sheet: WorkSheet, endRow: number, endColumn: number) => {
  for (let row = endRow; row >= 0; row -= 1) {
    let hasGrandTotalLabel = false;
    for (let column = 0; column <= Math.min(endColumn, 2); column += 1) {
      if (/^(?:grand\s+)?total(?:\s+(?:general|final))?$/.test(normalizeText(valueOf(sheet, row, column)))) {
        hasGrandTotalLabel = true;
        break;
      }
    }
    if (!hasGrandTotalLabel) continue;
    for (let column = Math.min(endColumn, 15); column >= 0; column -= 1) {
      const amount = numberValue(valueOf(sheet, row, column));
      if (amount !== null) return amount;
    }
  }
  return null;
};

export const supplierQuoteImportRowImpactJpy = (row: SupplierQuoteImportRow) => {
  if (row.state === "ignored" || row.resolution === "ignore") return 0;
  if (row.requiresResolution && row.resolution !== "include_recalculated") return 0;
  return row.calculatedSubtotalJpy;
};

const calculateFinancialSummary = (
  rows: SupplierQuoteImportRow[],
  sourceServiceSubtotalJpy: number | null,
  sourceFinalSupplierTotalJpy: number | null,
): SupplierQuoteImportFinancialSummary => {
  const importableRows = rows.filter((row) => row.state !== "ignored" && row.resolution !== "ignore");
  const handlingRows = importableRows.filter((row) => row.kind === "supplier_handling");
  const supplierHandlingJpy = handlingRows.length > 0
    ? handlingRows.reduce((sum, row) => sum + supplierQuoteImportRowImpactJpy(row), 0)
    : null;
  const calculatedServiceSubtotalJpy = importableRows
    .filter((row) => row.kind !== "supplier_handling")
    .reduce((sum, row) => sum + supplierQuoteImportRowImpactJpy(row), 0);
  const calculatedSupplierTotalJpy = calculatedServiceSubtotalJpy + (supplierHandlingJpy ?? 0);
  const sourceReconciliationDifferenceJpy = sourceServiceSubtotalJpy !== null
    && supplierHandlingJpy !== null
    && sourceFinalSupplierTotalJpy !== null
    ? sourceFinalSupplierTotalJpy - sourceServiceSubtotalJpy - supplierHandlingJpy
    : null;
  const travelOsVarianceJpy = sourceFinalSupplierTotalJpy === null
    ? null
    : calculatedSupplierTotalJpy - sourceFinalSupplierTotalJpy;

  return {
    sourceServiceSubtotalJpy,
    supplierHandlingJpy,
    supplierHandlingPercentage: handlingRows.find((row) => row.handlingPercentage !== null && row.handlingPercentage !== undefined)?.handlingPercentage ?? null,
    sourceFinalSupplierTotalJpy,
    calculatedServiceSubtotalJpy,
    calculatedSupplierTotalJpy,
    sourceReconciliationDifferenceJpy,
    travelOsVarianceJpy,
  };
};

const buildFinancialSummary = (
  sheet: WorkSheet,
  endRow: number,
  endColumn: number,
  rows: SupplierQuoteImportRow[],
): SupplierQuoteImportFinancialSummary => {
  const handlingRows = rows.filter((row) => row.state !== "ignored" && row.kind === "supplier_handling");
  const sourceFinalSupplierTotalJpy = detectSourceFinalSupplierTotal(sheet, endRow, endColumn);

  const supplierHandlingJpy = handlingRows.length > 0
    ? handlingRows.reduce((sum, row) => sum + row.calculatedSubtotalJpy, 0)
    : null;
  const sourceServiceSubtotalJpy = (
    sourceFinalSupplierTotalJpy !== null && supplierHandlingJpy !== null
      ? sourceFinalSupplierTotalJpy - supplierHandlingJpy
      : rows.filter(row => row.kind !== "supplier_handling" && row.state !== "ignored").reduce((sum,row) => sum+(row.excelSubtotalJpy ?? 0),0)
  );
  return calculateFinancialSummary(rows, sourceServiceSubtotalJpy, sourceFinalSupplierTotalJpy);
};

const buildCounts = (rows: SupplierQuoteImportRow[]) => {
  const bySection = { ...EMPTY_COUNTS };
  let recognized = 0;
  let review = 0;
  let ignored = 0;
  let importable = 0;
  let unresolved = 0;
  rows.forEach((row) => {
    if (row.state === "ignored" || row.resolution === "ignore") {
      ignored += 1;
      return;
    }
    if (row.state === "recognized") recognized += 1;
    else review += 1;
    if (row.kind === "supplier_handling") return;
    bySection[row.section] += 1;
    if (row.requiresResolution && !row.resolution) unresolved += 1;
    else importable += 1;
  });
  return { recognized, review, ignored, importable, unresolved, bySection };
};

export const parseSupplierQuoteWorkbook = async (
  data: ArrayBuffer | Uint8Array,
  fileName: string,
): Promise<SupplierQuoteExcelPreview> => {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(data, {
    type: "array",
    cellDates: false,
    cellFormula: true,
    sheets: 0,
  });
  return parseSupplierQuoteWorkBook(workbook, fileName, XLSX.SSF.parse_date_code);
};

export const parseSupplierQuoteWorkBook = (
  workbook: WorkBook,
  fileName: string,
  parseDateCode: ParseExcelDateCode,
): SupplierQuoteExcelPreview => {
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("Le classeur Excel ne contient aucune feuille.");

  // Security/functional invariant: only the first sheet is ever dereferenced.
  // SheetNames[1+] are counted for the preview, but their cells are never read.
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error("La première feuille du classeur est illisible.");
  const range = sheet["!ref"] ? decodeRange(sheet["!ref"] as string) : { endRow: 0, endColumn: 0 };
  const rows: SupplierQuoteImportRow[] = [];
  const workbookWarnings: string[] = [];
  let pendingSection: HistoricalSection | null = null;
  let currentSection: HistoricalSection | null = null;
  let columns: ColumnMap | null = null;

  for (let row = 0; row <= range.endRow; row += 1) {
    const text = rowText(sheet, row, range.endColumn);
    const explicitNumberedTitle = /^\d+\s*\.?\s*(?:accommodation|hebergement|entrance fee|activities|activites|meal|repas|other|autres?)/.test(text);
    const titleSection = !currentSection || explicitNumberedTitle ? sectionFromTitle(text) : null;
    if (titleSection) {
      pendingSection = titleSection;
      currentSection = null;
      columns = null;
      continue;
    }

    const isHotelHeader = /check.?in/.test(text) && /check.?out/.test(text) && /hotel/.test(text);
    const isGenericHeader = /price|prix/.test(text)
      && /subtotal|sous.?total/.test(text)
      && (/contents?|description|prestation/.test(text) || /\bno\b|\btimes?\b|nombre|fois/.test(text));
    if (isHotelHeader || isGenericHeader) {
      columns = headerMap(sheet, row, range.endColumn, isHotelHeader);
      currentSection = isHotelHeader
        ? "hotels"
        : pendingSection ?? classifyGenericBlock(sheet, row, columns.description, range.endRow);
      pendingSection = null;
      continue;
    }

    if (!currentSection || !columns || !text) continue;
    const exactValues = rowCells(sheet, row, Math.min(range.endColumn, 15)).map((cell) => normalizeText(cell?.v)).filter(Boolean);
    const isTotal = exactValues.some((value) => value === "total" || value === "total brut" || value === "price per pax:") || exactValues[0] === "total";
    if (isTotal) {
      rows.push(ignoredRow(
        row + 1,
        currentSection === "meal" ? "other" : currentSection,
        exactValues.includes("price per pax:") ? "Prix par pax Excel" : "Ligne de total Excel",
        numberValue(valueOf(sheet, row, columns.subtotal)),
        "Total Excel conservé uniquement pour contrôle et non importé comme prestation.",
      ));
      currentSection = null;
      columns = null;
      continue;
    }

    const parsed = importRow(sheet, row, currentSection, columns, parseDateCode, range.endColumn);
    if (parsed) rows.push(parsed);
  }

  for (let row = 0; row <= range.endRow; row += 1) {
    for (let column = 0; column <= range.endColumn; column += 1) {
      const label = errorLabel(sheet[cellAddress(row, column)]);
      if (label) workbookWarnings.push(`Erreur Excel ${label} ignorée en ${cellAddress(row, column)}.`);
    }
  }

  const counts = buildCounts(rows);
  const financialSummary = buildFinancialSummary(sheet, range.endRow, range.endColumn, rows);
  if (financialSummary.sourceReconciliationDifferenceJpy !== null && Math.abs(financialSummary.sourceReconciliationDifferenceJpy) > 1) {
    workbookWarnings.push(
      `Écart de réconciliation source : services + handling diffèrent du total final Excel de ${Math.round(financialSummary.sourceReconciliationDifferenceJpy).toLocaleString("fr-FR")} JPY.`,
    );
  }
  if (financialSummary.travelOsVarianceJpy !== null && Math.abs(financialSummary.travelOsVarianceJpy) > 1) {
    workbookWarnings.push(
      `Écart de recalcul Travel OS : le total des données sources importables diffère du total final Excel de ${Math.round(financialSummary.travelOsVarianceJpy).toLocaleString("fr-FR")} JPY.`,
    );
  }

  return refreshSupplierQuoteImportHandling({
    handling: { percentage: financialSummary.supplierHandlingPercentage ?? 0, categories: [], detected: rows.some(row => row.kind === "supplier_handling"), scopeOrigin: "confirmation_required", confirmed: false, mismatchAcknowledged: false },
    fileName,
    sheetName,
    ignoredSheetCount: Math.max(0, workbook.SheetNames.length - 1),
    participantCount: detectParticipantCount(sheet, range.endRow, range.endColumn),
    financialSummary,
    rows,
    workbookWarnings: Array.from(new Set(workbookWarnings)),
    counts,
  });
};

export const hasUnresolvedSupplierQuoteImportRows = (preview: SupplierQuoteExcelPreview) =>
  preview.rows.some((row) => row.requiresResolution && !row.resolution);

export const resolveSupplierQuoteImportRow = (
  preview: SupplierQuoteExcelPreview,
  sourceRow: number,
  resolution: SupplierQuoteAmbiguousResolution,
): SupplierQuoteExcelPreview => {
  const target = preview.rows.find((row) => row.sourceRow === sourceRow);
  if (!target?.requiresResolution) throw new Error(`La ligne Excel ${sourceRow} ne nécessite pas de décision.`);
  const rows = preview.rows.map((row) => row.sourceRow === sourceRow ? { ...row, resolution } : row);
  return refreshSupplierQuoteImportHandling({
    ...preview,
    handling:{...preview.handling,mismatchAcknowledged:false},
    rows,
    counts: buildCounts(rows),
    financialSummary: calculateFinancialSummary(
      rows,
      preview.financialSummary.sourceServiceSubtotalJpy,
      preview.financialSummary.sourceFinalSupplierTotalJpy,
    ),
  });
};

export const supplierQuoteImportCategoryTotals = (preview: SupplierQuoteExcelPreview) => Object.fromEntries(HANDLING_CATEGORIES.map(category => [category,preview.rows.filter(row => row.section===category && row.kind!=="supplier_handling").reduce((sum,row)=>sum+supplierQuoteImportRowImpactJpy(row),0)])) as Record<SupplierQuoteImportSection,number>;

export function refreshSupplierQuoteImportHandling(preview: SupplierQuoteExcelPreview): SupplierQuoteExcelPreview {
  const totals=supplierQuoteImportCategoryTotals(preview);
  const sourceAmount=preview.financialSummary.supplierHandlingJpy;
  const handling={...preview.handling};
  const inferred=inferSupplierHandlingScope(totals,preview.financialSummary.supplierHandlingPercentage,sourceAmount);
  handling.suggestedCategories=inferred;
  if (!handling.confirmed) {
    handling.categories=inferred ?? [];
    handling.scopeOrigin=inferred ? "inferred" : "confirmation_required";
  }
  const projection=supplierHandlingErrors(handling).length || (handling.detected && !handling.confirmed && !handling.categories.length) ? null : calculateSupplierHandling(totals,handling);
  const calculatedSupplierTotalJpy=projection?.supplierTotalJpy ?? null;
  return {...preview,handling,financialSummary:{...preview.financialSummary,calculatedSupplierTotalJpy,travelOsVarianceJpy:calculatedSupplierTotalJpy===null || preview.financialSummary.sourceFinalSupplierTotalJpy===null ? null : calculatedSupplierTotalJpy-preview.financialSummary.sourceFinalSupplierTotalJpy}};
}

export function confirmSupplierQuoteImportHandling(preview: SupplierQuoteExcelPreview,terms: SupplierHandlingTerms,mismatchAcknowledged=false): SupplierQuoteExcelPreview {
  return refreshSupplierQuoteImportHandling({...preview,handling:{...preview.handling,...terms,confirmed:true,scopeOrigin:"confirmed",mismatchAcknowledged}});
}

export function supplierQuoteImportHandlingDifference(preview: SupplierQuoteExcelPreview): number | null {
  if (supplierHandlingErrors(preview.handling).length || (preview.handling.percentage>0 && !preview.handling.categories.length) || preview.financialSummary.supplierHandlingJpy===null) return null;
  return calculateSupplierHandling(supplierQuoteImportCategoryTotals(preview),preview.handling).handlingAmountJpy-preview.financialSummary.supplierHandlingJpy;
}

export function supplierQuoteImportHandlingErrors(preview: SupplierQuoteExcelPreview): string[] {
  if (!preview.handling.detected) return [];
  const errors=supplierHandlingErrors(preview.handling);
  if (preview.rows.filter(row=>row.kind==="supplier_handling").length>1) errors.push("Plusieurs lignes de handling détectées : vérifiez le fichier source avant l’import.");
  if (preview.financialSummary.supplierHandlingPercentage===null && !preview.handling.confirmed) errors.push("Pourcentage du handling : confirmation requise.");
  if (!preview.handling.confirmed || (preview.handling.percentage>0 && !preview.handling.categories.length)) errors.push("Handling scope: confirmation required — confirmez les catégories applicables.");
  const difference=supplierQuoteImportHandlingDifference(preview);
  if (difference!==null && Math.abs(difference)>0.01 && !preview.handling.mismatchAcknowledged) errors.push("Le handling recalculé diffère de la source : acceptez explicitement cet écart avant l’import.");
  return errors;
}

export const buildSupplierQuoteImportMetadata = (preview: SupplierQuoteExcelPreview) => {
  const handlingErrors=supplierQuoteImportHandlingErrors(preview);
  if (handlingErrors.length) throw new Error(handlingErrors[0]);
  if (hasUnresolvedSupplierQuoteImportRows(preview)) {
    throw new Error("Chaque ligne sans sous-total Excel doit recevoir une décision explicite avant l’import.");
  }
  return {
    supplier_handling: {
      percentage:preview.handling.percentage,categories:preview.handling.categories,scope_confirmed:preview.handling.confirmed,
      scope_origin:preview.handling.scopeOrigin,suggested_categories:preview.handling.suggestedCategories ?? null,mismatch_acknowledged:preview.handling.mismatchAcknowledged,
      source_percentage:preview.financialSummary.supplierHandlingPercentage,source_amount_jpy:preview.financialSummary.supplierHandlingJpy,
      source_rows:preview.rows.filter(row=>row.kind==="supplier_handling").map(row=>({source_row:row.sourceRow,description:row.description,percentage:row.handlingPercentage,percentage_origin:row.handlingPercentageOrigin,formula:row.handlingFormula,base_jpy:row.handlingBaseJpy,amount_jpy:row.excelSubtotalJpy})),
    },
    ambiguity_resolutions: preview.rows
      .filter((row) => row.requiresResolution)
      .map((row) => ({
        source_row: row.sourceRow,
        section: row.section,
        resolution: row.resolution,
        calculated_subtotal_jpy: row.calculatedSubtotalJpy,
      })),
  };
};

const payloadWithoutCharge = (row: SupplierQuoteImportRow) => {
  const payload = { ...(row.payload ?? {}) };
  if (row.section === "hotels") {
    payload.price_per_person_per_night_jpy = 0;
    payload.price_per_room_per_night_jpy = 0;
    payload.unit_price_jpy = 0;
  } else if (row.section === "guides") {
    payload.daily_price_jpy = 0;
  } else {
    payload.unit_price_jpy = 0;
  }
  payload.comment = joinedComment(
    typeof payload.comment === "string" ? payload.comment : null,
    `Résolution import : prestation conservée non chiffrée (prix source ${Math.round(row.unitPriceJpy ?? 0)} JPY, impact retenu 0 JPY)`,
  );
  return payload;
};

export const buildSupplierQuoteImportPayload = (preview: SupplierQuoteExcelPreview) => {
  const handlingErrors=supplierQuoteImportHandlingErrors(preview);
  if (handlingErrors.length) throw new Error(handlingErrors[0]);
  if (hasUnresolvedSupplierQuoteImportRows(preview)) {
    throw new Error("Import bloqué : une ou plusieurs lignes sans sous-total Excel n’ont pas de décision explicite.");
  }
  const payload: Record<SupplierQuoteImportSection, Record<string, unknown>[]> = {
    hotels: [],
    transport: [],
    activities: [],
    guides: [],
    other: [],
  };
  preview.rows.forEach((row) => {
    if (row.state === "ignored" || row.resolution === "ignore" || !row.payload) return;
    const resolvedPayload = row.resolution === "import_uncharged" ? payloadWithoutCharge(row) : row.payload;
    payload[row.section].push({
      ...resolvedPayload,
      sort_order: payload[row.section].length,
      status: "todo",
      included_in_total: true,
      review_status: "pending",
      source_excel_row: row.sourceRow,
      source_excel_state: row.state,
      source_excel_subtotal_jpy: row.excelSubtotalJpy,
      source_excel_section: row.section,
      source_excel_ambiguous: Boolean(row.requiresResolution),
      source_excel_resolution: row.resolution ?? null,
      source_excel_calculated_subtotal_jpy: row.calculatedSubtotalJpy,
    });
  });
  return payload;
};

const decodeRange = (reference: string) => {
  const end = reference.split(":").pop() ?? "A1";
  const match = end.match(/^([A-Z]+)(\d+)$/i);
  if (!match) return { endRow: 0, endColumn: 0 };
  let endColumn = 0;
  for (const char of match[1].toUpperCase()) endColumn = endColumn * 26 + (char.charCodeAt(0) - 64);
  return { endRow: Math.max(0, Number(match[2]) - 1), endColumn: Math.max(0, endColumn - 1) };
};
