import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, FileScan, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { checkPassportExpiry } from "@/lib/passport-mrz";

export type PassportOcrFields = {
  first_name?: string;
  last_name?: string;
  full_name?: string;
  nationality?: string;
  sex?: string;
  date_of_birth?: string;
  passport_no?: string;
  national_id_number?: string;
  place_of_birth?: string;
  passport_issue_date?: string;
  passport_expiry?: string;
  passport_authority?: string;
  profession?: string;
  address?: string;
  city?: string;
  residence_address?: string;
  residence_city?: string;
  residence_country?: string;
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
  bucket?: "passports" | "visa-docs";
  onStoredPathChange?: (path: string | null) => void;
  onApply: (fields: PassportOcrFields) => void;
};

const ACCEPTED_TYPES = ["image/jpeg", "image/jpg", "image/png", "application/pdf"];
const MISSING_BUCKET_ERROR = "Bucket passports missing";
const MISSING_STORAGE_POLICY_ERROR = "Storage policy missing";
const OCR_FAILED_ERROR = "Passeport uploadé avec succès, mais lecture automatique impossible. Merci de saisir les données manuellement.";

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

function passportOcrErrorMessage(code?: string, contextLabel = "admin") {
  switch (code) {
    case "not_staff":
    case "forbidden_path":
    case "forbidden_bucket":
      return contextLabel === "visa"
        ? "Votre session ne permet pas de lire ce fichier passeport. Merci de vous reconnecter."
        : "Votre compte n’a pas les droits nécessaires pour utiliser la lecture automatique.";
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
      return contextLabel === "visa"
        ? "Votre session a expiré. Merci de vous reconnecter avant de relancer la lecture automatique."
        : "Votre session admin a expiré. Merci de vous reconnecter avant de relancer la lecture automatique.";
    default:
      return OCR_FAILED_ERROR;
  }
}

function pickDetectedFields(fields: any): PassportOcrFields {
  return {
    first_name: fields?.first_name,
    last_name: fields?.last_name,
    full_name: fields?.full_name,
    sex: fields?.sex,
    date_of_birth: fields?.date_of_birth,
    nationality: fields?.nationality,
    passport_no: fields?.passport_no,
    national_id_number: fields?.national_id_number,
    place_of_birth: fields?.place_of_birth,
    passport_issue_date: fields?.passport_issue_date,
    passport_expiry: fields?.passport_expiry,
    passport_authority: fields?.passport_authority,
    profession: fields?.profession,
    address: fields?.address ?? fields?.residence_address,
    city: fields?.city ?? fields?.residence_city,
    residence_address: fields?.residence_address ?? fields?.address,
    residence_city: fields?.residence_city ?? fields?.city,
    residence_country: fields?.residence_country,
    mrz_detected: fields?.mrz_detected,
    mrz_raw: fields?.mrz_raw ?? fields?.mrz,
    raw_text: fields?.raw_text,
    confidence: fields?.confidence,
  };
}

async function directStorageUpload(file: File, ext: string, contentType: string, bucket: "passports" | "visa-docs") {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (!userId) throw new Error("missing_auth");
  const id = crypto.randomUUID();
  const path = bucket === "visa-docs" ? `${userId}/passport-scans/${id}.${ext}` : `original/${id}.${ext}`;
  console.info("[passport-ocr] direct storage upload started", { bucket, path, type: contentType, size: file.size });
  const { error: uploadError } = await supabase.storage.from(bucket).upload(path, file, {
    contentType,
    upsert: false,
  });
  if (uploadError) throw new Error(storageErrorMessage(uploadError));

  console.info("[passport-ocr] direct storage upload succeeded", { bucket, path });
  return { path };
}

export function PassportScannerDialog({ open, onOpenChange, currentPath, bucket = "passports", onStoredPathChange, onApply }: Props) {
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
      const { path } = await directStorageUpload(file, ext, contentType, bucket);
      setStoredPath(path);
      onStoredPathChange?.(path);

      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) {
        const message = passportOcrErrorMessage("missing_auth", bucket === "visa-docs" ? "visa" : "admin");
        setError(message);
        toast.error(message);
        return;
      }

      const { data, error: invokeError } = await supabase.functions.invoke("passport-ocr", {
        body: { storage_path: path, path, bucket },
      });
      if (invokeError) {
        console.error("[passport-ocr] OCR function failed", {
          status: (invokeError as any)?.status,
          name: invokeError.name,
          message: invokeError.message,
          contextBucket: bucket,
          path,
        });
        const message = passportOcrErrorMessage((invokeError as any)?.context?.error || (invokeError as any)?.message, bucket === "visa-docs" ? "visa" : "admin");
        setError(message);
        toast.error(message);
        return;
      }
      if (!data?.ok) {
        const fallbackFields = pickDetectedFields(data?.debug?.parsed_fields ?? {});
        const hasFallbackFields = Boolean(fallbackFields.passport_no && (fallbackFields.last_name || fallbackFields.full_name));
        if (hasFallbackFields) {
          console.warn("[passport-ocr] OCR returned fallback but parsed usable fields", {
            error: data?.error,
            fields: fallbackFields,
            debug: data?.debug,
          });
          setFields(fallbackFields);
          setError("Lecture partielle: vérifiez les champs détectés avant de les appliquer.");
          toast.warning("Lecture partielle. Vérifiez les champs détectés avant validation.");
          return;
        }
        const message = passportOcrErrorMessage(data?.error, bucket === "visa-docs" ? "visa" : "admin");
        console.warn("[passport-ocr] OCR returned an error", {
          error: data?.error,
          detail: data?.detail,
          status: data?.status,
          debug: data?.debug,
          receivedKeys: data?.debug_echo?.received_keys,
          bucket,
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
      const message = e?.message === "missing_auth"
        ? passportOcrErrorMessage("missing_auth", bucket === "visa-docs" ? "visa" : "admin")
        : storageErrorMessage(e);
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  const deleteScan = async () => {
    if (!storedPath) return;
    setBusy(true);
    const { error: removeError } = await supabase.storage.from(bucket).remove([storedPath]);
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

  const setField = (key: keyof PassportOcrFields, value: string) => {
    setFields((current) => ({ ...(current ?? {}), [key]: value }));
  };

  const editableInput = (key: keyof PassportOcrFields, label: string, type = "text") => (
    <div>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input
        type={type}
        value={String(fields?.[key] ?? "")}
        onChange={(event) => setField(key, event.target.value)}
        className="mt-1"
      />
    </div>
  );
  const canApplyDetectedFields = Boolean(fields?.passport_no && (fields.last_name || fields.full_name));

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

              <div className="grid gap-3 text-sm sm:grid-cols-2">
                {editableInput("first_name", "Prénom")}
                {editableInput("last_name", "Nom")}
                {editableInput("nationality", "Nationalité")}
                {editableInput("sex", "Sexe")}
                {editableInput("date_of_birth", "Date de naissance", "date")}
                {editableInput("passport_no", "N° passeport")}
                {editableInput("national_id_number", "CIN")}
                {editableInput("place_of_birth", "Lieu de naissance")}
                {editableInput("passport_issue_date", "Date d'émission", "date")}
                {editableInput("passport_expiry", "Date d'expiration", "date")}
                {editableInput("passport_authority", "Autorité")}
                {editableInput("residence_country", "Pays résidence")}
                {editableInput("residence_city", "Ville résidence")}
                {editableInput("city", "Ville profil")}
                <div className="sm:col-span-2">
                  <Label className="text-xs text-muted-foreground">Adresse / domicile</Label>
                  <Textarea
                    value={fields.address ?? fields.residence_address ?? ""}
                    onChange={(event) => {
                      setField("address", event.target.value);
                      setField("residence_address", event.target.value);
                    }}
                    className="mt-1"
                    rows={3}
                  />
                </div>
              </div>

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
          <Button type="button" onClick={apply} disabled={!canApplyDetectedFields || busy}>
            Appliquer ces informations au profil
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
