import { describe, expect, it } from "vitest";
import { calculateSupplierHandling, HANDLING_CATEGORIES, inferSupplierHandlingScope, quoteCommercialActionAllowed, quotationFinancialErrors, supplierHandlingErrors } from "./supplier-quote-business-model";

const totals={hotels:1_000_000,transport:2_000_000,activities:3_000_000,guides:4_000_000,other:5_000_000};
describe("supplier handling and commercial phases",()=>{
  it("calculates the business example independently from internal commission",()=>{
    expect(calculateSupplierHandling({...totals,hotels:9_827_000,transport:0,activities:0,guides:0,other:0},{percentage:10,categories:HANDLING_CATEGORIES})).toEqual({servicesSubtotalJpy:9_827_000,handlingBaseJpy:9_827_000,handlingAmountJpy:982_700,supplierTotalJpy:10_809_700});
  });
  it.each([8,10,12])("calculates %s percent on selected included category subtotals",percentage=>{
    const result=calculateSupplierHandling(totals,{percentage,categories:["hotels","transport"]});
    expect(result.handlingBaseJpy).toBe(3_000_000);
    expect(result.handlingAmountJpy).toBe(3_000_000*percentage/100);
    expect(result.supplierTotalJpy).toBe(15_000_000+result.handlingAmountJpy);
  });
  it("recalculates after a selected category loses an included service",()=>{
    expect(calculateSupplierHandling({...totals,hotels:0},{percentage:10,categories:["hotels","transport"]}).handlingAmountJpy).toBe(200_000);
  });
  it("requires a category for a positive rate, accepts zero, and rejects invalid scopes",()=>{
    expect(supplierHandlingErrors({percentage:10,categories:[]})).not.toHaveLength(0);
    expect(supplierHandlingErrors({percentage:0,categories:[]})).toEqual([]);
    expect(supplierHandlingErrors({percentage:10,categories:["hotels","hotels"]})).not.toHaveLength(0);
    expect(supplierHandlingErrors({percentage:NaN,categories:["hotels"]})).not.toHaveLength(0);
  });
  it("does not invent a scope when zero categories make the source ambiguous",()=>{
    expect(inferSupplierHandlingScope({...totals,guides:0},10,300_000)).toBeNull();
    expect(inferSupplierHandlingScope({hotels:100,transport:1000,activities:10000,guides:100000,other:1000000},10,110_000)).toEqual(["guides","other"]);
  });
  it("requires financial terms only and permits approval exclusively by staff",()=>{
    expect(quotationFinancialErrors(totals,{percentage:10,categories:["hotels"]})).toEqual([]);
    expect(quoteCommercialActionAllowed("supplier","submitted")).toBe(true);
    expect(quoteCommercialActionAllowed("supplier","approved")).toBe(false);
    expect(quoteCommercialActionAllowed("staff","approved")).toBe(true);
  });
});
