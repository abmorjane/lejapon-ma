import { useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Upload, FileSpreadsheet, CheckCircle2, AlertCircle, X } from "lucide-react";
import { toast } from "sonner";

type ParsedRow = {
  full_name: string;
  email: string | null;
  phone: string | null;
  city: string | null;
  profession: string | null;
  marital_status: string | null;
  address: string | null;
  nationality: string | null;
  sex: string | null;
  birthdate: string | null;
  passport_number: string | null;
  passport_issue_date: string | null;
  passport_expiry: string | null;
  passport_expiring_soon: boolean | null;
  passport_renewal_needed: boolean | null;
  passport_file_path: string | null;
  last_trip_label: string | null;
  last_trip_departure_date: string | null;
  client_status: string | null;
  trips_completed: number | null;
  amount_paid: number | null;
  balance_due: number | null;
  notes: string | null;
  registered_at: string | null;
  _invalidDateFields: string[];
  _valid: boolean;
  _error?: string;
};

const NAME_KEYS = ["name", "full_name", "fullname", "nom", "nom complet", "client", "prénom et nom"];
const EMAIL_KEYS = ["email", "e-mail", "mail", "courriel"];
const PHONE_KEYS = ["phone", "phone_number", "tel", "tél", "téléphone", "telephone", "mobile", "gsm"];
const CITY_KEYS = ["ville", "city"];
const PROFESSION_KEYS = ["profession", "metier", "métier", "emploi", "occupation"];
const MARITAL_KEYS = ["etat civil", "état civil", "marital status", "situation familiale"];
const ADDRESS_KEYS = ["address", "adresse", "adresse complète", "residential address"];
const NATIONALITY_KEYS = ["nationalité", "nationalite", "nationality"];
const SEX_KEYS = ["sexe", "sex", "gender", "genre"];
const BIRTHDATE_KEYS = ["birthdate", "birth date", "date naissance", "date de naissance", "naissance"];
const PASSPORT_NUMBER_KEYS = ["numéro de passeport", "numero de passeport", "n passeport", "n° passeport", "passport number", "passport_number", "passport no", "passport_no"];
const PASSPORT_EXPIRY_KEYS = ["passport_expiry", "passport expiry", "expiration passeport", "date expiration passeport", "date d'expiration du passeport", "expiration", "validité passeport"];
const PASSPORT_ISSUE_KEYS = ["passport_issue_date", "passport issue date", "emission passeport", "émission passeport", "date emission passeport", "date d'émission du passeport", "delivrance passeport", "délivrance passeport"];
const PASSPORT_EXPIRING_SOON_KEYS = ["passeport expirant bientôt", "passeport expirant bientot", "passport expiring soon", "passport_expiring_soon"];
const PASSPORT_RENEWAL_KEYS = ["passeport à renouveler", "passeport a renouveler", "passport renewal needed", "passport_renewal_needed"];
const PASSPORT_FILE_KEYS = ["fichier passeport", "passport file", "passport_file_path", "passport url", "url passeport"];
const LAST_TRIP_KEYS = ["voyage inscrit", "last trip", "last_trip_label", "voyage"];
const LAST_TRIP_DEPARTURE_KEYS = ["date de départ", "date de depart", "departure date", "last_trip_departure_date"];
const CLIENT_STATUS_KEYS = ["statut client", "client status", "client_status", "statut"];
const TRIPS_COMPLETED_KEYS = ["nombre de voyages", "trips completed", "trips_completed"];
const AMOUNT_PAID_KEYS = ["montant payé", "montant paye", "amount paid", "amount_paid"];
const BALANCE_DUE_KEYS = ["reste à payer", "reste a payer", "balance due", "balance_due", "solde restant"];
const NOTES_KEYS = ["notes", "note", "commentaires", "commentaire"];
const REGISTERED_AT_KEYS = ["date d'inscription", "date inscription", "registered at", "registered_at", "created at"];

const normalizeMaritalStatus = (value: string) => {
  const v = value.toLowerCase().trim();
  if (!v) return "";
  if (["celibataire", "célibataire", "single"].includes(v)) return "celibataire";
  if (["marie", "marié", "mariée", "marie(e)", "marié(e)", "married"].includes(v)) return "marie";
  if (["divorce", "divorcé", "divorcée", "divorce(e)", "divorcé(e)", "divorced"].includes(v)) return "divorce";
  if (["veuf", "veuve", "widowed"].includes(v)) return "veuf";
  return value;
};

const normalizeHeader = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’]/g, " ")
    .replace(/[_\s-]+/g, " ")
    .replace(/[°]/g, "")
    .trim();

const normalizedKeys = (keys: string[]) => keys.map(normalizeHeader);

const toNullableString = (value: unknown): string | null => {
  if (value == null) return null;
  const v = String(value).trim();
  return v === "" ? null : v;
};

const parseBoolean = (value: unknown): boolean | null => {
  if (value == null || value === "") return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1 ? true : value === 0 ? false : null;
  const v = String(value).trim().toLowerCase();
  if (["true", "vrai", "oui", "yes", "y", "1"].includes(v)) return true;
  if (["false", "faux", "non", "no", "n", "0"].includes(v)) return false;
  return null;
};

const parseAmount = (value: unknown): number | null => {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  let v = String(value).trim();
  if (!v) return null;
  v = v.replace(/\s|\u00a0/g, "").replace(/[^\d,.-]/g, "");
  if (v.includes(",")) v = v.replace(/\./g, "").replace(",", ".");
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const parseInteger = (value: unknown): number | null => {
  const n = parseAmount(value);
  return n == null ? null : Math.trunc(n);
};

export function parseSpreadsheetDate(value: unknown): string | null {
  if (value == null || value === "") return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed || !parsed.y || !parsed.m || !parsed.d) return null;
    return `${String(parsed.y).padStart(4, "0")}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
  }

  const v = String(value).trim();
  if (!v) return null;

  if (/^\d+(\.\d+)?$/.test(v)) {
    const serial = Number(v);
    if (Number.isFinite(serial) && serial > 0) {
      const parsed = XLSX.SSF.parse_date_code(serial);
      if (parsed?.y && parsed?.m && parsed?.d) {
        return `${String(parsed.y).padStart(4, "0")}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
      }
    }
  }

  const iso = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    const [, y, m, d] = iso;
    const candidate = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
    const date = new Date(`${candidate}T00:00:00`);
    return Number.isNaN(date.getTime()) ? null : candidate;
  }

  const dmy = v.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    const candidate = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
    const date = new Date(`${candidate}T00:00:00`);
    return Number.isNaN(date.getTime()) ? null : candidate;
  }

  const date = new Date(v);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function pickRawField(row: Record<string, any>, keys: string[]): unknown {
  const keysNorm = normalizedKeys(keys);
  for (const k of Object.keys(row)) {
    if (keysNorm.includes(normalizeHeader(k))) {
      return row[k];
    }
  }
  return "";
}

function pickField(row: Record<string, any>, keys: string[]): string | null {
  const v = pickRawField(row, keys);
  return toNullableString(v);
}

export function ClientsImportDialog({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onImported: () => void;
}) {
  const [fileName, setFileName] = useState<string>("");
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [importing, setImporting] = useState(false);

  const reset = () => {
    setFileName("");
    setRows([]);
    setImporting(false);
  };

  const handleFile = async (file: File) => {
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: "" });

      const parsed: ParsedRow[] = json.map((r) => {
        const full_name = pickField(r, NAME_KEYS) ?? "";
        const email = pickField(r, EMAIL_KEYS);
        const phone = pickField(r, PHONE_KEYS);
        const city = pickField(r, CITY_KEYS);
        const profession = pickField(r, PROFESSION_KEYS);
        const marital_status = toNullableString(normalizeMaritalStatus(pickField(r, MARITAL_KEYS) ?? ""));
        const address = pickField(r, ADDRESS_KEYS);
        const nationality = pickField(r, NATIONALITY_KEYS);
        const sex = pickField(r, SEX_KEYS);
        const birthdateRaw = pickRawField(r, BIRTHDATE_KEYS);
        const passport_number = pickField(r, PASSPORT_NUMBER_KEYS);
        const passportExpiryRaw = pickRawField(r, PASSPORT_EXPIRY_KEYS);
        const passportIssueRaw = pickRawField(r, PASSPORT_ISSUE_KEYS);
        const lastTripDepartureRaw = pickRawField(r, LAST_TRIP_DEPARTURE_KEYS);
        const registeredAtRaw = pickRawField(r, REGISTERED_AT_KEYS);
        const birthdate = parseSpreadsheetDate(birthdateRaw);
        const passport_expiry = parseSpreadsheetDate(passportExpiryRaw);
        const passport_issue_date = parseSpreadsheetDate(passportIssueRaw);
        const last_trip_departure_date = parseSpreadsheetDate(lastTripDepartureRaw);
        const registered_at = parseSpreadsheetDate(registeredAtRaw);
        const _invalidDateFields = [
          birthdateRaw !== "" && !birthdate ? "date de naissance" : "",
          passportExpiryRaw !== "" && !passport_expiry ? "expiration passeport" : "",
          passportIssueRaw !== "" && !passport_issue_date ? "émission passeport" : "",
          lastTripDepartureRaw !== "" && !last_trip_departure_date ? "date de départ" : "",
          registeredAtRaw !== "" && !registered_at ? "date d'inscription" : "",
        ].filter(Boolean);
        let _valid = true;
        let _error: string | undefined;
        if (!full_name) {
          _valid = false;
          _error = "Nom manquant";
        } else if (email && !/^\S+@\S+\.\S+$/.test(email)) {
          _valid = false;
          _error = "Email invalide";
        }
        return {
          full_name,
          email,
          phone,
          city,
          profession,
          marital_status,
          address,
          nationality,
          sex,
          birthdate,
          passport_number,
          passport_issue_date,
          passport_expiry,
          passport_expiring_soon: parseBoolean(pickRawField(r, PASSPORT_EXPIRING_SOON_KEYS)),
          passport_renewal_needed: parseBoolean(pickRawField(r, PASSPORT_RENEWAL_KEYS)),
          passport_file_path: pickField(r, PASSPORT_FILE_KEYS),
          last_trip_label: pickField(r, LAST_TRIP_KEYS),
          last_trip_departure_date,
          client_status: pickField(r, CLIENT_STATUS_KEYS),
          trips_completed: parseInteger(pickRawField(r, TRIPS_COMPLETED_KEYS)),
          amount_paid: parseAmount(pickRawField(r, AMOUNT_PAID_KEYS)),
          balance_due: parseAmount(pickRawField(r, BALANCE_DUE_KEYS)),
          notes: pickField(r, NOTES_KEYS),
          registered_at,
          _invalidDateFields,
          _valid,
          _error,
        };
      });

      if (parsed.length === 0) {
        toast.error("Le fichier est vide.");
        return;
      }
      setFileName(file.name);
      setRows(parsed);
    } catch (e: any) {
      toast.error("Lecture du fichier impossible : " + e.message);
    }
  };

  const validRows = rows.filter((r) => r._valid);
  const invalidCount = rows.length - validRows.length;
  const invalidDateCount = rows.filter((r) => r._invalidDateFields.length > 0).length;

  const doImport = async () => {
    if (validRows.length === 0) return;
    setImporting(true);
    const payload = validRows.map((r) => ({
      full_name: r.full_name,
      email: r.email,
      phone: r.phone,
      city: r.city,
      profession: r.profession,
      marital_status: r.marital_status,
      address: r.address,
      nationality: r.nationality,
      sex: r.sex,
      birthdate: r.birthdate,
      passport_number: r.passport_number,
      passport_issue_date: r.passport_issue_date,
      passport_expiry: r.passport_expiry,
      passport_expiring_soon: r.passport_expiring_soon,
      passport_renewal_needed: r.passport_renewal_needed,
      passport_file_path: r.passport_file_path,
      last_trip_label: r.last_trip_label,
      last_trip_departure_date: r.last_trip_departure_date,
      client_status: r.client_status,
      trips_completed: r.trips_completed,
      amount_paid: r.amount_paid,
      balance_due: r.balance_due,
      notes: r.notes,
      registered_at: r.registered_at,
      source: "import",
    }));
    console.log("CLIENT INSERT PAYLOAD", { table: "public.clients", payload });
    const { error } = await supabase.from("clients").insert(payload as any);
    setImporting(false);
    if (error) {
      toast.error("Erreur d'import : " + error.message);
      return;
    }
    toast.success(`${validRows.length} client(s) importé(s). ${invalidCount} ignoré(s). ${invalidDateCount} ligne(s) avec date invalide convertie en vide.`);
    reset();
    onOpenChange(false);
    onImported();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) reset();
      }}
    >
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Importer des clients</DialogTitle>
          <DialogDescription>
            Fichier CSV ou Excel (.xlsx). Toutes les colonnes CRM/passeport/export sont mappées vers public.clients.
          </DialogDescription>
        </DialogHeader>

        {rows.length === 0 ? (
          <div className="border-2 border-dashed border-border rounded-2xl p-10 text-center">
            <FileSpreadsheet className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground mb-4">
              Glissez un fichier ou sélectionnez-le ci-dessous.
            </p>
            <Label
              htmlFor="clients-import-file"
              className="inline-flex items-center gap-2 cursor-pointer bg-primary text-primary-foreground rounded-md px-4 h-10 hover:bg-primary/90"
            >
              <Upload className="w-4 h-4" /> Choisir un fichier
            </Label>
            <Input
              id="clients-import-file"
              type="file"
              accept=".csv,.xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
            <p className="text-[11px] text-muted-foreground mt-4">
              En-têtes acceptées : Nom complet, Email, Téléphone, Ville, Profession, Passeport, Voyage, Paiements, Notes.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2 text-sm">
              <div className="flex items-center gap-2 min-w-0">
                <FileSpreadsheet className="w-4 h-4 shrink-0 text-muted-foreground" />
                <span className="truncate font-medium">{fileName}</span>
              </div>
              <div className="flex items-center gap-3 text-xs shrink-0">
                <span className="inline-flex items-center gap-1 text-emerald-600">
                  <CheckCircle2 className="w-3.5 h-3.5" /> {validRows.length} valides
                </span>
                {invalidDateCount > 0 && (
                  <span className="inline-flex items-center gap-1 text-amber-600">
                    <AlertCircle className="w-3.5 h-3.5" /> {invalidDateCount} dates invalides
                  </span>
                )}
                {invalidCount > 0 && (
                  <span className="inline-flex items-center gap-1 text-destructive">
                    <AlertCircle className="w-3.5 h-3.5" /> {invalidCount} ignorées
                  </span>
                )}
                <Button size="sm" variant="ghost" onClick={reset} className="h-7">
                  <X className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>

            <div className="bg-background rounded-xl border border-border overflow-hidden max-h-[50vh] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-secondary/50 text-left sticky top-0">
                  <tr>
                    <th className="p-3 w-8"></th>
                    <th className="p-3">Nom</th>
                    <th className="p-3">Email</th>
                    <th className="p-3">Téléphone</th>
                    <th className="p-3">Ville</th>
                    <th className="p-3">Profession</th>
                    <th className="p-3">État civil</th>
                    <th className="p-3">Naissance</th>
                    <th className="p-3">Passeport exp.</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((r, i) => (
                    <tr key={i} className={!r._valid ? "bg-destructive/5" : ""}>
                      <td className="p-3">
                        {r._valid ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                        ) : (
                          <span title={r._error}>
                            <AlertCircle className="w-4 h-4 text-destructive" />
                          </span>
                        )}
                      </td>
                      <td className="p-3 font-medium">{r.full_name || "—"}</td>
                      <td className="p-3 text-muted-foreground">{r.email || "—"}</td>
                      <td className="p-3 text-muted-foreground">{r.phone || "—"}</td>
                      <td className="p-3 text-muted-foreground">{r.city || "—"}</td>
                      <td className="p-3 text-muted-foreground">{r.profession || "—"}</td>
                      <td className="p-3 text-muted-foreground">{r.marital_status || "—"}</td>
                      <td className="p-3 text-muted-foreground">
                        {r.birthdate || "—"}
                        {r._invalidDateFields.length > 0 && (
                          <span className="ml-2 text-[10px] text-amber-600" title={`Dates invalides : ${r._invalidDateFields.join(", ")}`}>
                            dates ignorées
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-muted-foreground">{r.passport_expiry || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={importing}>
            Annuler
          </Button>
          <Button onClick={doImport} disabled={validRows.length === 0 || importing}>
            {importing ? "Import…" : `Importer ${validRows.length} client(s)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
