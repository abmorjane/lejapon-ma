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
  mrz_detected?: boolean;
  mrz_raw?: string;
  raw_text?: string;
  confidence?: number;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentPath?: string | null;
  onStoredPathChange?: (path: string | null) => void;
  onApply: (fields: PassportOcrFields) => void;
};

const ACCEPTED_TYPES = ["image/jpeg", "image/jpg", "image/png", "application/pdf"];
const MISSING_BUCKET_ERROR = "Bucket passports missing";
const MISSING_STORAGE_POLICY_ERROR = "Storage policy missing";
const OCR_FAILED_ERROR = "Passeport uploadé avec succès, mais lecture automatique impossible. Merci de saisir les données manuellement.";
const PDF_OCR_UNSUPPORTED_ERROR = "PDF uploadé, mais la lecture automatique nécessite une image JPG ou PNG.";

const display = (value?: string | number) => value || "—";

function getUploadContentType(file: File, ext: string) {
  if (file.type === "image/jpg") return "image/jpeg";
  if (file.type) return file.type;
  if (ext === "pdf") return "application/pdf";
  if (ext === "png") return "image/png";
  return "image/jpeg";
}

function storageErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String((error as any)?.message ?? error ?? "");
  if (/row-level security|violates row-level security|not authorized|unauthorized|permission/i.test(message)) {
    return MISSING_STORAGE_POLICY_ERROR;
  }
  if (/bucket not found|not found/i.test(message) && /bucket|storage/i.test(message)) {
    return MISSING_BUCKET_ERROR;
  }
  return message || "Lecture automatique impossible";
}

function passportOcrErrorMessage(code?: string) {
  switch (code) {
    case "not_staff":
      return "Votre compte n’a pas les droits nécessaires pour utiliser la lecture automatique.";
    case "unsupported_file_type":
      return "Le format PDF n’est pas encore supporté. Merci d’utiliser une image JPG ou PNG.";
    case "ai_rate_limited":
      return "Le service OCR est temporairement limité. Réessayez dans quelques minutes.";
    case "ai_credits_exhausted":
      return "Le crédit OCR est épuisé. Merci de vérifier la configuration Lovable AI.";
    case "signed_url_failed":
    case "download_failed":
      return "Le fichier a été uploadé mais n’a pas pu être lu depuis le stockage.";
    case "ai_invalid_json":
    case "ai_request_failed":
      return "La lecture automatique a échoué. Merci de saisir les données manuellement.";
    case "missing_path":
      return "La lecture automatique n’a pas reçu le chemin du fichier uploadé.";
    case "missing_auth":
    case "invalid_token":
      return "Votre session admin a expiré. Merci de vous reconnecter avant de relancer la lecture automatique.";
    default:
      return OCR_FAILED_ERROR;
  }
}

function pickDetectedFields(fields: any): PassportOcrFields {
  return {
    first_name: fields?.first_name,
    last_name: fields?.last_name,
    sex: fields?.sex,
    date_of_birth: fields?.date_of_birth,
    nationality: fields?.nationality,
    passport_no: fields?.passport_no,
    passport_issue_date: fields?.passport_issue_date,
    passport_expiry: fields?.passport_expiry,
    mrz_detected: fields?.mrz_detected,
    mrz_raw: fields?.mrz_raw,
    raw_text: fields?.raw_text,
  };
}

async function directStorageUpload(file: File, ext: string, contentType: string) {
  const id = crypto.randomUUID();
  const path = `original/${id}.${ext}`;
  console.info("[passport-ocr] direct storage upload started", { bucket: "passports", path, type: contentType, size: file.size });
  const { error: uploadError } = await supabase.storage.from("passports").upload(path, file, {
    contentType,
    upsert: false,
  });
  if (uploadError) throw new Error(storageErrorMessage(uploadError));

  console.info("[passport-ocr] direct storage upload succeeded", { bucket: "passports", path });
  return { path };
}

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
      const contentType = getUploadContentType(file, ext);
      if (!ACCEPTED_TYPES.includes(contentType)) {
        throw new Error("Format non supporté. Utilisez JPG, PNG ou PDF.");
      }
      const { path } = await directStorageUpload(file, ext, contentType);
      setStoredPath(path);
      onStoredPathChange?.(path);

      if (contentType === "application/pdf") {
        console.info("[passport-ocr] PDF uploaded; OCR skipped because image input is required", { bucket: "passports", path });
        setError(PDF_OCR_UNSUPPORTED_ERROR);
        toast.info(PDF_OCR_UNSUPPORTED_ERROR);
        return;
      }

      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) {
        const message = passportOcrErrorMessage("missing_auth");
        setError(message);
        toast.error(message);
        return;
      }

      const { data, error: invokeError } = await supabase.functions.invoke("passport-ocr", {
        body: { path, bucket: "passports" },
      });
      if (invokeError) {
        console.error("[passport-ocr] OCR function failed", invokeError);
        const message = passportOcrErrorMessage("ai_request_failed");
        setError(message);
        toast.error(message);
        return;
      }
      if (!data?.ok) {
        const message = passportOcrErrorMessage(data?.error);
        console.warn("[passport-ocr] OCR returned an error", {
          error: data?.error,
          detail: data?.detail,
          bucket: "passports",
          storagePath: path,
        });
        setError(message);
        toast.error(message);
        return;
      }
      const detectedFields = pickDetectedFields(data.fields ?? {});
      console.info("[passport-ocr] OCR parsed fields", {
        fields: detectedFields,
        bucket: data.bucket,
        path: data.path,
      });
      setFields(detectedFields);
      toast.success("Informations détectées. Veuillez vérifier avant validation.");
    } catch (e: any) {
      console.error("[passport-ocr] pipeline failed", e);
      const message = storageErrorMessage(e);
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  const deleteScan = async () => {
    if (!storedPath) return;
    setBusy(true);
    const { error: removeError } = await supabase.storage.from("passports").remove([storedPath]);
    setBusy(false);
    if (removeError) return toast.error(storageErrorMessage(removeError));
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

              {(fields.mrz_raw || fields.raw_text) && (
                <details className="mt-4 rounded-xl border border-border bg-secondary/30 p-3 text-xs">
                  <summary className="cursor-pointer font-medium">Détails OCR admin</summary>
                  <div className="mt-3 space-y-3">
                    {fields.mrz_raw && (
                      <div>
                        <p className="mb-1 font-medium text-muted-foreground">MRZ brute</p>
                        <pre className="max-h-36 overflow-auto whitespace-pre-wrap rounded-lg bg-background p-2 font-mono">{fields.mrz_raw}</pre>
                      </div>
                    )}
                    {fields.raw_text && (
                      <div>
                        <p className="mb-1 font-medium text-muted-foreground">Texte OCR brut</p>
                        <pre className="max-h-36 overflow-auto whitespace-pre-wrap rounded-lg bg-background p-2 font-mono">{fields.raw_text}</pre>
                      </div>
                    )}
                  </div>
                </details>
              )}
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
