import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = {
  onClick: () => void;
  className?: string;
};

export function AdminOverlayCloseButton({ onClick, className }: Props) {
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={onClick}
      className={cn("min-h-11 shrink-0 gap-1.5 rounded-full px-3", className)}
      aria-label="Fermer"
    >
      <X className="h-4 w-4" />
      <span>Fermer</span>
    </Button>
  );
}

