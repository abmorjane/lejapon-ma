import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SupplierHandlingFields } from "./SupplierHandlingFields";
import { SupplierQuoteVersionHistory } from "./SupplierQuoteVersionHistory";
import { HANDLING_CATEGORIES } from "@/admin/lib/supplier-quote-business-model";
afterEach(cleanup);
it("requires explicit categories and lets Entire quote select all five",()=>{
 const onChange=vi.fn();
 render(<SupplierHandlingFields value={{percentage:10,categories:[]}} onChange={onChange}/>);
 expect(screen.getByRole("alert")).toHaveTextContent("catégorie");
 fireEvent.click(screen.getByLabelText("Devis entier"));
 expect(onChange).toHaveBeenLastCalledWith({percentage:10,categories:HANDLING_CATEGORIES});
 fireEvent.click(screen.getByLabelText("Hôtels"));
 expect(onChange).toHaveBeenLastCalledWith({percentage:10,categories:["hotels"]});
});
it("keeps supplier financial terms read-only in admin review",()=>{
 const onChange=vi.fn();
 render(<SupplierHandlingFields value={{percentage:10,categories:["hotels"]}} onChange={onChange} disabled/>);
 expect(screen.getByLabelText("Pourcentage handling fournisseur")).toBeDisabled();
 expect(screen.getByLabelText("Hôtels")).toBeDisabled();
});
it("collapses full grouped version history by default without truncating changes",()=>{
 const changes=Array.from({length:71},(_,index)=>({section:"hotels" as const,kind:"changed" as const,detail:`Change ${index}`}));
 const {container}=render(<SupplierQuoteVersionHistory previousVersion={3} changes={changes}/>);
 const allDetails=container.querySelectorAll("details");
 expect(allDetails).toHaveLength(2);
 expect(allDetails[0]).not.toHaveAttribute("open");
 expect(allDetails[1]).not.toHaveAttribute("open");
 expect(screen.getByText(/71 modification/)).toBeInTheDocument();
 expect(container.querySelectorAll("li")).toHaveLength(71);
 expect(screen.getByText("Change 70")).toBeInTheDocument();
});
