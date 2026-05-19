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
  email: string;
  phone: string;
  _valid: boolean;
  _error?: string;
};

const NAME_KEYS = ["name", "full_name", "fullname", "nom", "nom complet", "client", "prénom et nom"];
const EMAIL_KEYS = ["email", "e-mail", "mail", "courriel"];
const PHONE_KEYS = ["phone", "phone_number", "tel", "tél", "téléphone", "telephone", "mobile", "gsm"];

function pickField(row: Record<string, any>, keys: string[]): string {
  const norm = (s: string) => s.toLowerCase().trim().replace(/[_\s-]+/g, " ");
  for (const k of Object.keys(row)) {
    if (keys.includes(norm(k))) {
      const v = row[k];
      return v == null ? "" : String(v).trim();
    }
  }
  return "";
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
        const full_name = pickField(r, NAME_KEYS);
        const email = pickField(r, EMAIL_KEYS);
        const phone = pickField(r, PHONE_KEYS);
        let _valid = true;
        let _error: string | undefined;
        if (!full_name) {
          _valid = false;
          _error = "Nom manquant";
        } else if (email && !/^\S+@\S+\.\S+$/.test(email)) {
          _valid = false;
          _error = "Email invalide";
        }
        return { full_name, email, phone, _valid, _error };
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

  const doImport = async () => {
    if (validRows.length === 0) return;
    setImporting(true);
    const payload = validRows.map((r) => ({
      full_name: r.full_name,
      email: r.email || null,
      phone: r.phone || null,
      source: "import",
    }));
    const { error } = await supabase.from("clients").insert(payload);
    setImporting(false);
    if (error) {
      toast.error("Erreur d'import : " + error.message);
      return;
    }
    toast.success(`${validRows.length} client(s) importé(s).`);
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
            Fichier CSV ou Excel (.xlsx). Colonnes reconnues automatiquement : Nom, Email, Téléphone.
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
              En-têtes acceptées : <code>name / nom</code>, <code>email</code>,{" "}
              <code>phone / tel / téléphone</code>
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