import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, FileScan, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { checkPassportExpiry } from "@/lib/passport-mrz";

export type PassportOcrFields = {
  first_name?: string;
  last_name?: string;
  full_name?: string;
  nationality?: string;
  sex?: string;
  date_of_birth?: string;
  passport_no?: string;
  passport_issue_date?: string;
  passport_expiry?: string;
  mrz?: string;
  confidence?: number;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentPath?: string | null;
  onStoredPathChange?: (path: string | null) => void;
  onApply: (fields: PassportOcrFields) => void;
};

const BUCKET = "passport-scans";

const display = (value?: string | number) => value || "—";

export function PassportScannerDialog({ open, onOpenChange, currentPath, onStoredPathChange, onApply }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewKind, setPreviewKind] = useState<"image" | "pdf" | null>(null);
  const [storedPath, setStoredPath] = useState<string | null>(currentPath ?? null);
  const [fields, setFields] = useState<PassportOcrFields | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setStoredPath(currentPath ?? null), [currentPath]);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const expiryCheck = useMemo(() => checkPassportExpiry(fields?.passport_expiry), [fields?.passport_expiry]);

  const uploadAndScan = async (file: File) => {
    setBusy(true);
    setError(null);
    setFields(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(file));
    setPreviewKind(file.type === "application/pdf" ? "pdf" : "image");

    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `${crypto.randomUUID()}.${ext}`;
      const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, {
        contentType: file.type || undefined,
        upsert: false,
      });
      if (uploadError) throw uploadError;
      setStoredPath(path);
      onStoredPathChange?.(path);

      const { data, error: invokeError } = await supabase.functions.invoke("passport-ocr", {
        body: { storage_path: path },
      });
      if (invokeError) throw invokeError;
      if (!data?.ok) {
        setError(data?.error || "Lecture automatique impossible. Merci de renseigner les informations manuellement.");
        return;
      }
      setFields(data.fields ?? {});
      toast.success("Informations détectées. Veuillez vérifier avant validation.");
    } catch (e: any) {
      setError("Lecture automatique impossible. Merci de renseigner les informations manuellement.");
      toast.error(e.message ?? "Lecture automatique impossible");
    } finally {
      setBusy(false);
    }
  };

  const deleteScan = async () => {
    if (!storedPath) return;
    setBusy(true);
    const { error: removeError } = await supabase.storage.from(BUCKET).remove([storedPath]);
    setBusy(false);
    if (removeError) return toast.error(removeError.message);
    setStoredPath(null);
    setFields(null);
    setError(null);
    onStoredPathChange?.(null);
    toast.success("Image passeport supprimée");
  };

  const apply = () => {
    if (!fields) return;
    onApply(fields);
    toast.info("Veuillez vérifier les informations avant validation.");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileScan className="h-5 w-5 text-accent" /> Scanner passeport
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-secondary/40 p-4">
            <p className="text-sm font-medium">Aide à la saisie uniquement</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Les informations détectées ne sont jamais sauvegardées automatiquement. Veuillez vérifier les informations avant validation.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-3">
              <Label>Photo, scan ou PDF du passeport</Label>
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,application/pdf"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) uploadAndScan(file);
                  event.currentTarget.value = "";
                }}
              />
              <Button type="button" variant="outline" className="h-11 w-full justify-center" onClick={() => fileRef.current?.click()} disabled={busy}>
                <Upload className="h-4 w-4" /> {busy ? "Lecture en cours…" : "Uploader un passeport"}
              </Button>
              {storedPath && (
                <Button type="button" variant="ghost" className="h-11 w-full justify-center text-destructive hover:text-destructive" onClick={deleteScan} disabled={busy}>
                  <Trash2 className="h-4 w-4" /> Supprimer l'image du passeport
                </Button>
              )}
              {error && (
                <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                  {error}
                </div>
              )}
            </div>

            <div className="min-h-48 overflow-hidden rounded-xl border border-border bg-background">
              {!previewUrl ? (
                <div className="flex h-48 items-center justify-center p-6 text-center text-sm text-muted-foreground">
                  L'aperçu du passeport s'affichera ici.
                </div>
              ) : previewKind === "pdf" ? (
                <iframe src={previewUrl} title="Aperçu passeport" className="h-64 w-full" />
              ) : (
                <img src={previewUrl} alt="Aperçu passeport" className="h-64 w-full object-contain" />
              )}
            </div>
          </div>

          {fields && (
            <section className="rounded-2xl border border-border bg-background p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h3 className="font-display text-lg">Informations détectées</h3>
                  <p className="text-xs text-muted-foreground">Contrôlez chaque champ avant de l'appliquer au profil.</p>
                </div>
                {fields.confidence && <span className="badge-pill bg-secondary text-foreground">Confiance {Math.round(fields.confidence * 100)}%</span>}
              </div>

              {expiryCheck.warning && (
                <div className="mb-3 flex items-start gap-2 rounded-xl border border-orange-300 bg-orange-50 p-3 text-sm text-orange-900">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <p>
                    {expiryCheck.warning}
                    <br />
                    Date d'expiration détectée : {fields.passport_expiry}
                  </p>
                </div>
              )}

              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div><dt className="text-xs text-muted-foreground">Prénom</dt><dd className="font-medium">{display(fields.first_name)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Nom</dt><dd className="font-medium">{display(fields.last_name)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Nationalité</dt><dd className="font-medium">{display(fields.nationality)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Sexe</dt><dd className="font-medium">{display(fields.sex)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Date de naissance</dt><dd className="font-medium">{display(fields.date_of_birth)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">N° passeport</dt><dd className="font-medium">{display(fields.passport_no)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Date d'émission</dt><dd className="font-medium">{display(fields.passport_issue_date)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Date d'expiration</dt><dd className="font-medium">{display(fields.passport_expiry)}</dd></div>
              </dl>
            </section>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            <X className="h-4 w-4" /> Annuler
          </Button>
          <Button type="button" onClick={apply} disabled={!fields || busy}>
            Appliquer ces informations au profil
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
