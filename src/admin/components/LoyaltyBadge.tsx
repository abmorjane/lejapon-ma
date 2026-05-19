import { Crown, Sparkles, Star } from "lucide-react";
import { cn } from "@/lib/utils";

type Tier = "none" | "bronze" | "silver" | "gold" | string | null | undefined;

const TIERS: Record<string, { label: string; cls: string; Icon: any }> = {
  bronze: { label: "Bronze", cls: "bg-amber-100 text-amber-900 border-amber-300", Icon: Star },
  silver: { label: "Silver", cls: "bg-slate-100 text-slate-800 border-slate-300", Icon: Sparkles },
  gold:   { label: "Gold",   cls: "bg-yellow-100 text-yellow-900 border-yellow-400", Icon: Crown },
};

export function LoyaltyBadge({ tier, isReturning, trips, className }: { tier?: Tier; isReturning?: boolean; trips?: number; className?: string }) {
  if (!isReturning && (!tier || tier === "none")) return null;
  const cfg = TIERS[tier as string] ?? TIERS.bronze;
  const Icon = cfg.Icon;
  return (
    <span className={cn("inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[11px] font-medium", cfg.cls, className)}>
      <Icon className="w-3 h-3" />
      Voyageur fidèle{trips ? ` · ${trips}` : ""}
    </span>
  );
}

export const tierLabel = (t?: Tier) => TIERS[t as string]?.label ?? "—";