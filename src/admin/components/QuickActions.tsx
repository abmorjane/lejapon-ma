import { Copy, Mail, MessageCircle, Phone, FileText } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const cleanPhone = (phone?: string | null) => (phone ?? "").replace(/[^\d+]/g, "");
const whatsappPhone = (phone?: string | null) => cleanPhone(phone).replace(/^\+/, "");

type QuickActionsProps = {
  phone?: string | null;
  email?: string | null;
  passport?: string | null;
  onPdf?: () => void;
  compact?: boolean;
  className?: string;
};

export function QuickActions({ phone, email, passport, onPdf, compact, className }: QuickActionsProps) {
  const copyPassport = async () => {
    if (!passport) return;
    await navigator.clipboard.writeText(passport);
    toast.success("N° passeport copié");
  };

  const btnClass = cn(
    "h-11 min-w-11 rounded-xl",
    compact ? "px-3 text-xs" : "flex-1 px-3 text-xs sm:text-sm"
  );

  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {phone && (
        <Button asChild variant="outline" size="sm" className={btnClass}>
          <a href={`tel:${cleanPhone(phone)}`} onClick={(e) => e.stopPropagation()} aria-label="Appeler le client">
            <Phone className="w-4 h-4" />
            {!compact && <span>Appeler</span>}
          </a>
        </Button>
      )}
      {phone && (
        <Button asChild variant="outline" size="sm" className={btnClass}>
          <a href={`https://wa.me/${whatsappPhone(phone)}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} aria-label="WhatsApp client">
            <MessageCircle className="w-4 h-4" />
            {!compact && <span>WhatsApp</span>}
          </a>
        </Button>
      )}
      {email && (
        <Button asChild variant="outline" size="sm" className={btnClass}>
          <a href={`mailto:${email}`} onClick={(e) => e.stopPropagation()} aria-label="Envoyer un email">
            <Mail className="w-4 h-4" />
            {!compact && <span>Email</span>}
          </a>
        </Button>
      )}
      {passport && (
        <Button variant="outline" size="sm" className={btnClass} onClick={(e) => { e.stopPropagation(); copyPassport(); }}>
          <Copy className="w-4 h-4" />
          {!compact && <span>Passeport</span>}
        </Button>
      )}
      {onPdf && (
        <Button variant="outline" size="sm" className={btnClass} onClick={(e) => { e.stopPropagation(); onPdf(); }}>
          <FileText className="w-4 h-4" />
          {!compact && <span>PDF</span>}
        </Button>
      )}
    </div>
  );
}
