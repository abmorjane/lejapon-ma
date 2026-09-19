import { useParams } from "react-router-dom";
import SupplierTripCosts from "./supplier/SupplierTripCosts";

export default function AdminSupplierQuote() {
  const { tripId, quoteId } = useParams();
  // Reset local edits/operational state when opening another existing version.
  return <SupplierTripCosts key={`${tripId}:${quoteId ?? "current"}`} context="admin" />;
}
