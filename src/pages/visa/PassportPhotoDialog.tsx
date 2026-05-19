import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Upload, Image as ImageIcon, RefreshCw, Check } from "lucide-react";
import { toast } from "sonner";
import { resizePassportPhoto, type PassportPhotoResult } from "@/lib/passport-photo";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConfirm: (file: File) => Promise<void> | void;
};

export function PassportPhotoDialog({ open, onOpenChange, onConfirm }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<PassportPhotoResult | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      if (result) URL.revokeObjectURL(result.previewUrl);
      setResult(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (f.size > 15 * 1024 * 1024) return toast.error("Image trop volumineuse (max 15 Mo).");
    try {
      setBusy(true);
      if (result) URL.revokeObjectURL(result.previewUrl);
      const r = await resizePassportPhoto(f);
      setResult(r);
    } catch (err: any) {
      toast.error(err.message ?? "Échec du traitement");
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!result) return;
    setBusy(true);
    try {
      await onConfirm(result.file);
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Photo d'identité — format visa Japon</DialogTitle>
          <DialogDescription>
            Importez votre photo : nous la recadrons automatiquement au format officiel
            <strong> 35 × 45 mm</strong> sur fond blanc.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <ul className="text-xs text-muted-foreground list-disc pl-5 space-y-1">
            <li>Visage centré, regard face à l'objectif, expression neutre.</li>
            <li>Fond uni clair, lumière homogène, pas de lunettes teintées.</li>
            <li>Photo récente (moins de 6 mois).</li>
          </ul>

          <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={onPick} />

          {!result ? (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
              className="w-full border-2 border-dashed border-border rounded-lg p-8 flex flex-col items-center gap-2 hover:border-accent hover:bg-accent/5 transition-colors disabled:opacity-60"
            >
              <ImageIcon className="w-8 h-8 text-muted-foreground" />
              <p className="text-sm font-medium">{busy ? "Traitement…" : "Choisir une photo"}</p>
              <p className="text-xs text-muted-foreground">JPG ou PNG · max 15 Mo</p>
            </button>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <div
                className="border border-border rounded-md overflow-hidden bg-secondary"
                style={{ width: 165, height: 212 }}
              >
                <img
                  src={result.previewUrl}
                  alt="Aperçu photo passeport"
                  className="w-full h-full object-cover"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {result.widthPx} × {result.heightPx} px · prêt à téléverser
              </p>
              <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={busy}>
                <RefreshCw className="w-4 h-4" /> Changer la photo
              </Button>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Annuler</Button>
          <Button onClick={confirm} disabled={!result || busy}>
            {busy ? <Upload className="w-4 h-4 animate-pulse" /> : <Check className="w-4 h-4" />}
            Téléverser la photo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}