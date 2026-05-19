import { cn } from "@/lib/utils";
const map: Record<string, string> = {
  lead: "bg-indigo/15 text-indigo",
  confirmed: "bg-gold/20 text-foreground",
  paid: "bg-success/15 text-success",
  cancelled: "bg-destructive/15 text-destructive",
  completed: "bg-secondary text-foreground/70",
  draft: "bg-secondary text-foreground/60",
  open: "bg-success/15 text-success",
  closed: "bg-secondary text-foreground/60",
  published: "bg-success/15 text-success",
  pending: "bg-gold/20 text-foreground",
  received: "bg-success/15 text-success",
  refunded: "bg-destructive/15 text-destructive",
};
export const StatusBadge = ({ value }: { value: string }) => (
  <span className={cn("badge-pill capitalize", map[value] ?? "bg-secondary text-foreground/70")}>{value}</span>
);
