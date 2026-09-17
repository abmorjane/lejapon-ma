import { HANDLING_CATEGORIES } from "./supplier-quote-business-model";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import {
  buildSupplierQuoteImportMetadata,
  confirmSupplierQuoteImportHandling, supplierQuoteImportHandlingErrors, supplierQuoteImportHandlingDifference,
  buildSupplierQuoteImportPayload,
  hasUnresolvedSupplierQuoteImportRows,
  parseSupplierQuoteWorkBook,
  parseSupplierQuoteWorkbook,
  resolveSupplierQuoteImportRow,
} from "./supplier-quote-excel-import";

const parseWorkbook = (workbook: XLSX.WorkBook) =>
  parseSupplierQuoteWorkBook(workbook, "historique.xlsx", XLSX.SSF.parse_date_code);

const makeHistoricalWorkbook = () => {
  const firstSheet = XLSX.utils.aoa_to_sheet([
    [null, null, null, null, "Nbr de pax", 20],
    [null, "1. ACCOMMODATION"],
    [null, "Check-in date", "Check-out date", "Hotel Name:", "Rate", "Pax", "Nts.", null, "Subtotal", "Notes"],
    [null, 46340, 46343, "Hotel A DELUX TWIN", 31_000, 20, 3, null, 1_860_000, "Note hôtel"],
    [null, 46340, 46343, "Hotel A SINGLE", 51_000, 4, 1, null, 204_000],
    [null, 46340, 46343, "Hotel A TRIPLE", "-", 0, 0, null, 0],
    [null, 46340, 46343, "Hotel A Guide SGL", 21_000, 1, 3, null, 63_000],
    [null, null, null, null, "Total", null, null, null, 2_127_000],
    [],
    [null, null, null, "Contents", "Price", "No", "Times", null, "Subtotal", "Notes"],
    [null, 46345, null, "French speaking guide (Kyoto)", 65_000, 1, 1, null, 65_000],
    [null, null, null, null, "Total", null, null, null, 65_000],
    [],
    [null, null, null, "Contents", "Price", "No", "Times", null, "Subtotal"],
    [null, null, null, "Narita Airport to Tokyo", 148_000, 21, 1, null, 148_000],
    [null, null, null, null, "Total", null, null, null, 148_000],
    [null, "4 Entrance fee and others"],
    [null, "Date", null, "Contents", "Price", "No", "Times", null, "Subtotal", "Notes"],
    [null, 46342, null, "Tokyo Tower", 1_500, 20, 1, null, 30_000],
    [null, "TBD", null, "Optional activity", 1_000, 20, 0, null, 0],
    [null, null, null, null, "Total", null, null, null, 30_000],
    [null, "5. Meal"],
    [null, "Date", null, "Contents", "Price", "No", "Times", null, "Subtotal", "Notes"],
    [null, null, null, "Restaurant", 9_000, 2, 1, null, 18_000, "Menu"],
    [null, null, null, null, "Total", null, null, null, 18_000],
    [null, "6. Other"],
    [null, "Date", null, "Contents", "Price", "No", "Times", null, "Subtotal", "Notes"],
    [null, null, null, "Tapis volant Handling", 2_388_000, 1, 1, null, 238_800],
    [],
    [null, "TOTAL", null, null, null, null, null, null, 2_626_800],
  ]);
  firstSheet.J4 = { t: "e", v: 0x17, w: "#REF!" };
  const secondSheet = XLSX.utils.aoa_to_sheet([
    ["Activities"],
    [null, "Date", null, "Contents", "Price", "No", "Times", null, "Subtotal"],
    [null, 46342, null, "NE DOIT PAS ÊTRE IMPORTÉ", 99_999, 99, 99, null, 999_999],
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, firstSheet, "13-28 Novembre 2026");
  XLSX.utils.book_append_sheet(workbook, secondSheet, "Activities");
  return workbook;
};

const makeAmbiguousWorkbook = () => {
  const sheet = XLSX.utils.aoa_to_sheet([
    [null, "4 Entrance fee and others"],
    [null, "Date", null, "Contents", "Price", "No", "Times", null, "Subtotal", "Notes"],
    [null, 46342, null, "Ambiguous activity", 100, 2, 3, null, null, "Keep source detail"],
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Quote");
  return workbook;
};

describe("supplier quote historical Excel parser", () => {
  it("dereferences the first sheet only", () => {
    const workbook = makeHistoricalWorkbook();
    const first = workbook.Sheets[workbook.SheetNames[0]];
    const guarded = {
      SheetNames: ["13-28 Novembre 2026", "Paiement"],
      Sheets: new Proxy({ "13-28 Novembre 2026": first }, {
        get(target, property: string) {
          if (property === "Paiement") throw new Error("Second sheet was read");
          return (target as Record<string, XLSX.WorkSheet>)[property];
        },
      }),
    } as XLSX.WorkBook;

    const preview = parseWorkbook(guarded);

    expect(preview.sheetName).toBe("13-28 Novembre 2026");
    expect(preview.ignoredSheetCount).toBe(1);
    expect(preview.rows.some((row) => row.description.includes("NE DOIT PAS"))).toBe(false);
  });

  it("maps historical sections, Excel dates and room types without trusting subtotals", () => {
    const preview = parseWorkbook(makeHistoricalWorkbook());
    const payload = buildSupplierQuoteImportPayload(preview.handling.detected ? confirmSupplierQuoteImportHandling(preview,{percentage:preview.handling.percentage,categories:HANDLING_CATEGORIES},true) : preview);

    expect(preview.participantCount).toBe(20);
    expect(preview.counts.bySection).toMatchObject({ hotels: 4, guides: 1, transport: 1, activities: 2, other: 1 });
    expect(payload.hotels.map((row) => row.room_type)).toEqual(["double/twin", "single", "triple", "TL"]);
    expect(payload.hotels[0]).toMatchObject({ check_in: "2026-11-14", check_out: "2026-11-17", person_count: 20, nights: 3 });
    expect(payload.hotels[0].comment).toContain("Hotel A DELUX TWIN");
    expect(preview.rows.find((row) => row.description === "Hotel A DELUX TWIN")?.calculatedSubtotalJpy).toBe(1_860_000);
    expect(preview.rows.find((row) => row.description === "Tapis volant Handling")).toMatchObject({
      state: "recognized",
      section: "other",
      kind: "supplier_handling",
      handlingBaseJpy: 2_388_000,
      handlingPercentage: 10,
      calculatedSubtotalJpy: 238_800,
    });
  });

  it("keeps 10% Excel handling at quote level once when the quote office commission is also 10%", () => {
    const quoteCommissionPercentage = 10;
    const preview = parseWorkbook(makeHistoricalWorkbook());
    const payload = buildSupplierQuoteImportPayload(preview.handling.detected ? confirmSupplierQuoteImportHandling(preview,{percentage:preview.handling.percentage,categories:HANDLING_CATEGORIES},true) : preview);
    const handlingLines = payload.other.filter((row) => row.source_excel_kind === "supplier_handling");

    expect(quoteCommissionPercentage).toBe(10);
    expect(handlingLines).toHaveLength(0);
    expect(buildSupplierQuoteImportMetadata(confirmSupplierQuoteImportHandling(preview,{percentage:10,categories:HANDLING_CATEGORIES})).supplier_handling).toMatchObject({percentage:10,categories:HANDLING_CATEGORIES,source_amount_jpy:238_800});
    expect(preview.financialSummary).toMatchObject({
      sourceServiceSubtotalJpy: 2_388_000,
      supplierHandlingJpy: 238_800,
      supplierHandlingPercentage: 10,
      sourceFinalSupplierTotalJpy: 2_626_800,
      calculatedSupplierTotalJpy: 2_626_800,
      sourceReconciliationDifferenceJpy: 0,
      travelOsVarianceJpy: 0,
    });
  });

  it.each([null, 0])("does not lose handling when the quote office commission is %s", (quoteCommissionPercentage) => {
    const preview = parseWorkbook(makeHistoricalWorkbook());
    const payload = buildSupplierQuoteImportPayload(preview.handling.detected ? confirmSupplierQuoteImportHandling(preview,{percentage:preview.handling.percentage,categories:HANDLING_CATEGORIES},true) : preview);

    expect(quoteCommissionPercentage == null || quoteCommissionPercentage === 0).toBe(true);
    expect(payload.other.filter((row) => row.source_excel_kind === "supplier_handling")).toHaveLength(0);
    expect(preview.financialSummary.supplierHandlingJpy).toBe(238_800);
  });

  it("keeps a differing office commission unchanged and exposes the distinct handling concept", () => {
    const quoteCommissionPercentage = 7;
    const preview = parseWorkbook(makeHistoricalWorkbook());
    const handling = preview.rows.find((row) => row.kind === "supplier_handling");

    expect(quoteCommissionPercentage).toBe(7);
    expect(handling?.handlingPercentage).toBe(10);
    expect(handling?.warnings.join(" ")).toContain("Handling fournisseur au niveau du devis");
  });

  it("requires an explicit decision and includes the Travel OS recalculation when selected", () => {
    const unresolved = parseWorkbook(makeAmbiguousWorkbook());
    expect(hasUnresolvedSupplierQuoteImportRows(unresolved)).toBe(true);
    expect(unresolved.counts).toMatchObject({ unresolved: 1, importable: 0 });
    expect(() => buildSupplierQuoteImportPayload(unresolved)).toThrow("Import bloqué");
    expect(() => buildSupplierQuoteImportMetadata(unresolved)).toThrow("décision explicite");

    const resolved = resolveSupplierQuoteImportRow(unresolved, 3, "include_recalculated");
    const payload = buildSupplierQuoteImportPayload(resolved);
    const metadata = buildSupplierQuoteImportMetadata(resolved);

    expect(resolved.counts).toMatchObject({ unresolved: 0, importable: 1 });
    expect(resolved.financialSummary.calculatedSupplierTotalJpy).toBe(600);
    expect(payload.activities[0]).toMatchObject({
      participant_count: 6,
      unit_price_jpy: 100,
      source_excel_resolution: "include_recalculated",
      source_excel_calculated_subtotal_jpy: 600,
    });
    expect(metadata.ambiguity_resolutions).toEqual([{
      source_row: 3,
      section: "activities",
      resolution: "include_recalculated",
      calculated_subtotal_jpy: 600,
    }]);
  });

  it("imports an ambiguous service without financial impact when selected", () => {
    const resolved = resolveSupplierQuoteImportRow(parseWorkbook(makeAmbiguousWorkbook()), 3, "import_uncharged");
    const payload = buildSupplierQuoteImportPayload(resolved);

    expect(resolved.financialSummary.calculatedSupplierTotalJpy).toBe(0);
    expect(payload.activities[0]).toMatchObject({
      activity_name: "Ambiguous activity",
      participant_count: 6,
      unit_price_jpy: 0,
      source_excel_resolution: "import_uncharged",
    });
    expect(payload.activities[0].comment).toContain("prix source 100 JPY");
  });

  it("omits an ambiguous service when ignore is selected", () => {
    const resolved = resolveSupplierQuoteImportRow(parseWorkbook(makeAmbiguousWorkbook()), 3, "ignore");
    const payload = buildSupplierQuoteImportPayload(resolved);
    const metadata = buildSupplierQuoteImportMetadata(resolved);

    expect(resolved.counts).toMatchObject({ unresolved: 0, importable: 0, ignored: 1 });
    expect(payload.activities).toEqual([]);
    expect(metadata.ambiguity_resolutions[0]).toMatchObject({ source_row: 3, resolution: "ignore" });
  });

  it("accepts dashes, blanks, optional zeroes and Excel errors as warnings", () => {
    const preview = parseWorkbook(makeHistoricalWorkbook());
    const triple = preview.rows.find((row) => row.description === "Hotel A TRIPLE");
    const optional = preview.rows.find((row) => row.description === "Optional activity");

    expect(triple).toMatchObject({ state: "review", unitPriceJpy: null, calculatedSubtotalJpy: 0 });
    expect(optional).toMatchObject({ state: "review", calculatedSubtotalJpy: 0 });
    expect(preview.workbookWarnings.some((warning) => warning.includes("#REF!"))).toBe(true);
    expect(preview.rows.filter((row) => row.state === "ignored").every((row) => row.payload === null)).toBe(true);
  });

  it("does not import total rows as quote lines", () => {
    const preview = parseWorkbook(makeHistoricalWorkbook());
    const payload = buildSupplierQuoteImportPayload(preview.handling.detected ? confirmSupplierQuoteImportHandling(preview,{percentage:preview.handling.percentage,categories:HANDLING_CATEGORIES},true) : preview);
    const importedDescriptions = Object.values(payload).flat().map((row) => JSON.stringify(row));

    expect(preview.rows.filter((row) => row.description === "Ligne de total Excel").length).toBeGreaterThan(0);
    expect(importedDescriptions.some((description) => description.includes("Ligne de total"))).toBe(false);
  });
});

const realFixturePath = process.env.SUPPLIER_QUOTE_IMPORT_FIXTURE;
describe.runIf(Boolean(realFixturePath && existsSync(realFixturePath)))("real November 2026 workbook", () => {
  it("parses only its first sheet and reconciles the imported total to the source total", async () => {
    const bytes = readFileSync(realFixturePath!);
    let preview = await parseSupplierQuoteWorkbook(bytes, "LeJapon.ma Novembre 13-28 2026 TapisVolant.xlsx");

    expect(preview.sheetName).toBe("13-28 Novembre 2026");
    expect(preview.ignoredSheetCount).toBe(3);
    expect(preview.counts).toMatchObject({ recognized: 44, review: 28, ignored: 8, importable: 69, unresolved: 2 });
    expect(preview.counts.bySection).toEqual({ hotels: 20, transport: 20, activities: 19, guides: 11, other: 1 });
    expect(preview.financialSummary).toMatchObject({
      sourceServiceSubtotalJpy: 9_827_000,
      supplierHandlingJpy: 982_700,
      supplierHandlingPercentage: 10,
      sourceFinalSupplierTotalJpy: 10_809_700,
      sourceReconciliationDifferenceJpy: 0,
      calculatedServiceSubtotalJpy: 9_827_000,
      calculatedSupplierTotalJpy: 10_809_700,
      travelOsVarianceJpy: 0,
    });
    expect(preview.rows.filter((row) => row.requiresResolution).map((row) => row.sourceRow)).toEqual([26, 79]);
    preview = resolveSupplierQuoteImportRow(preview, 26, "import_uncharged");
    preview = resolveSupplierQuoteImportRow(preview, 79, "import_uncharged");
    expect(preview.counts.unresolved).toBe(0);
    expect(preview.financialSummary.calculatedSupplierTotalJpy).toBe(10_809_700);
    preview=confirmSupplierQuoteImportHandling(preview,{percentage:10,categories:HANDLING_CATEGORIES});
    expect(buildSupplierQuoteImportPayload(preview).other.filter((row) => row.source_excel_kind === "supplier_handling")).toHaveLength(0);
    expect(preview.workbookWarnings.some((warning) => warning.includes("#REF!"))).toBe(true);
    expect(preview.rows.some((row) => /BUS - PROGRAM|Paiement/.test(row.description))).toBe(false);
  });
});

describe("handling import confirmation", () => {
  it("requires explicit scope confirmation even for an inferred scope", () => {
    const preview=parseWorkbook(makeHistoricalWorkbook());
    expect(preview.handling).toMatchObject({percentage:10,scopeOrigin:"inferred",confirmed:false,categories:HANDLING_CATEGORIES});
    expect(()=>buildSupplierQuoteImportMetadata(preview)).toThrow("confirmation required");
    expect(()=>buildSupplierQuoteImportPayload(preview)).toThrow("confirmation required");
  });
  it("suggests a partial scope only when the source amount uniquely matches that category",()=>{
    const workbook=makeHistoricalWorkbook();
    const sheet=workbook.Sheets[workbook.SheetNames[0]];
    const row=Object.entries(sheet).find(([,cell])=>typeof cell==='object' && cell.v==='Tapis volant Handling')![0].match(/\d+/)![0];
    sheet[`E${row}`]={t:"n",v:2_127_000};
    sheet[`I${row}`]={t:"n",v:212_700,f:`E${row}*10%`};
    const preview=parseWorkbook(workbook);
    expect(preview.handling).toMatchObject({percentage:10,categories:["hotels"],suggestedCategories:["hotels"],confirmed:false});
    const confirmed=confirmSupplierQuoteImportHandling(preview,{percentage:10,categories:["hotels"]});
    expect(supplierQuoteImportHandlingErrors(confirmed)).toEqual([]);
    expect(buildSupplierQuoteImportMetadata(confirmed).supplier_handling).toMatchObject({categories:["hotels"],suggested_categories:["hotels"],source_amount_jpy:212_700});
  });
  it("allows an explicitly confirmed zero rate without a category while preserving the source discrepancy",()=>{
    const preview=parseWorkbook(makeHistoricalWorkbook());
    const confirmed=confirmSupplierQuoteImportHandling(preview,{percentage:0,categories:[]},true);
    expect(confirmed.financialSummary.calculatedSupplierTotalJpy).toBe(2_388_000);
    expect(buildSupplierQuoteImportMetadata(confirmed).supplier_handling).toMatchObject({percentage:0,categories:[],source_amount_jpy:238_800,mismatch_acknowledged:true});
  });
  it("retains the explicit formula percentage and source amount when they disagree", () => {
    const workbook=makeHistoricalWorkbook();
    const sheet=workbook.Sheets[workbook.SheetNames[0]];
    const handlingCell=Object.entries(sheet).find(([,cell])=>typeof cell==='object' && cell.v==='Tapis volant Handling')!;
    const row=handlingCell[0].match(/\d+/)![0];
    sheet[`I${row}`]={t:"n",v:200_000,f:`E${row}*10%`};
    const preview=parseWorkbook(workbook);
    expect(preview.financialSummary.supplierHandlingPercentage).toBe(10);
    expect(preview.financialSummary.supplierHandlingJpy).toBe(200_000);
    expect(preview.handling.scopeOrigin).toBe("confirmation_required");
    expect(preview.handling.categories).toEqual([]);
    expect(preview.financialSummary.calculatedSupplierTotalJpy).toBeNull();
    const confirmed=confirmSupplierQuoteImportHandling(preview,{percentage:10,categories:HANDLING_CATEGORIES});
    expect(supplierQuoteImportHandlingDifference(confirmed)).toBe(38_800);
    expect(supplierQuoteImportHandlingErrors(confirmed).join(" ")).toContain("écart");
    const accepted=confirmSupplierQuoteImportHandling(confirmed,confirmed.handling,true);
    expect(buildSupplierQuoteImportMetadata(accepted).supplier_handling.source_amount_jpy).toBe(200_000);
    expect(buildSupplierQuoteImportPayload(accepted).other.every(row=>row.source_excel_kind!=="supplier_handling")).toBe(true);
  });
});

describe("supplier quote Excel import RPC guard", () => {
  it("cross-checks every selected ambiguity resolution against the effective server payload", () => {
    const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260913022132_supplier_quote_excel_import.sql"), "utf8");

    expect(migration).toContain("ambiguous-row payload count does not match selected resolutions");
    expect(migration).toContain("ignored ambiguous row must not be present in import payload");
    expect(migration).toContain("included ambiguous row does not match Travel OS calculation");
    expect(migration).toContain("non-charged ambiguous row must have zero financial impact");
  });
});
