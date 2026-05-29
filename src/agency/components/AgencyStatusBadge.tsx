import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function AgencyStatusBadge({ value }: { value: string | null | undefined }) {
  const status = value ?? "unknown";
  return (
    <Badge
      variant="outline"
      className={cn(
        status === "paid" || status === "confirmed"
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : status === "cancelled"
            ? "border-red-200 bg-red-50 text-red-700"
            : status === "completed"
              ? "border-stone-200 bg-stone-50 text-stone-700"
              : "border-amber-200 bg-amber-50 text-amber-800"
      )}
    >
      {status}
    </Badge>
  );
}
