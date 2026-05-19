import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, ExternalLink, Loader2 } from "lucide-react";
import { downloadBlob } from "@/lib/visa-pdf";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  filename: string;
  /** Async generator returning the PDF bytes. Re-invoked each time the dialog opens. */
  generate: () => Promise<Uint8Array>;
};

export function PdfPreviewDialog({ open, onOpenChange, title, filename, generate }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let revoked = false;
    setUrl(null);
    setBytes(null);
    setError(null);
    generate()
      .then((b) => {
        if (revoked) return;
        const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
        const blob = new Blob([ab], { type: "application/pdf" });
        setBytes(b);
        setUrl(URL.createObjectURL(blob));
      })
      .catch((e) => setError(e?.message ?? "Erreur de génération"));
    return () => {
      revoked = true;
      setUrl((u) => {
        if (u) URL.revokeObjectURL(u);
        return null;
      });
    };
  }, [open, generate]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl h-[85vh] flex flex-col p-0 gap-0">
        <DialogHeader className="p-4 border-b flex-row items-center justify-between space-y-0">
          <DialogTitle>{title}</DialogTitle>
          <div className="flex items-center gap-2 mr-8">
            <Button
              size="sm"
              variant="outline"
              disabled={!bytes}
              onClick={() => {
                if (!bytes) return;
                // Force download as fallback for "open in new tab" (popup-blocked in iframes)
                downloadBlob(bytes, filename);
              }}
            >
              <ExternalLink className="w-4 h-4" /> Ouvrir
            </Button>
            <Button
              size="sm"
              disabled={!bytes}
              onClick={() => bytes && downloadBlob(bytes, filename)}
            >
              <Download className="w-4 h-4" /> Télécharger
            </Button>
          </div>
        </DialogHeader>
        <div className="flex-1 bg-secondary/30 overflow-hidden">
          {error ? (
            <div className="h-full flex items-center justify-center text-destructive p-4 text-sm">{error}</div>
          ) : url ? (
            <iframe src={url} title="Aperçu PDF" className="w-full h-full border-0" />
          ) : (
            <div className="h-full flex items-center justify-center text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> Génération du document…
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}