import { useEffect, useMemo, useState } from "react";
import { Archive, Database, Download, FileArchive, HardDrive, Loader2, ShieldCheck, ShieldOff, Users } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/admin/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useAuth } from "@/hooks/useAuth";
import { BACKUP_PLATFORM_LABEL, generatePlatformBackup, type BackupProgress, type BackupResult } from "@/lib/platform-backup";

export default function BackupsAdmin() {
  const { user, isSuperAdmin } = useAuth();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<BackupProgress | null>(null);
  const [result, setResult] = useState<BackupResult | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    };
  }, [downloadUrl]);

  const progressPct = useMemo(() => {
    if (!progress?.total) return 0;
    return Math.min(100, Math.round((progress.done / progress.total) * 100));
  }, [progress]);

  const generate = async () => {
    if (!user || !isSuperAdmin) return;
    setBusy(true);
    setResult(null);
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    setDownloadUrl(null);

    try {
      const backup = await generatePlatformBackup(user, setProgress);
      const url = URL.createObjectURL(backup.blob);
      setResult(backup);
      setDownloadUrl(url);
      toast.success("Backup généré avec succès");
    } catch (error: any) {
      toast.error(error?.message ?? "Impossible de générer le backup");
    } finally {
      setBusy(false);
    }
  };

  if (!isSuperAdmin) {
    return (
      <div className="flex flex-col items-center gap-3 py-20 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-secondary">
          <ShieldOff className="h-6 w-6 text-muted-foreground" />
        </div>
        <h2 className="font-display text-xl">Réservé aux Super Admins</h2>
        <p className="max-w-sm text-sm text-muted-foreground">
          Les backups complets contiennent des données sensibles et ne sont accessibles qu'au Super Admin.
        </p>
      </div>
    );
  }

  const exportedTables = result?.tables.filter((table) => table.status === "exported").length ?? 0;
  const failedTables = result?.tables.filter((table) => table.status === "error").length ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="System · Backups"
        description="Export manuel de reprise après sinistre pour la plateforme LeJapon.ma."
        action={
          <Button onClick={generate} disabled={busy} className="min-h-11">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileArchive className="h-4 w-4" />}
            Generate Backup
          </Button>
        }
      />

      <Alert className="border-amber-300 bg-amber-50 text-amber-950">
        <ShieldCheck className="h-4 w-4 text-amber-700" />
        <AlertTitle>Backup sensible · {BACKUP_PLATFORM_LABEL}</AlertTitle>
        <AlertDescription>
          Le ZIP contient des exports JSON/CSV de la base, une liste Auth via la fonction sécurisée super_admin, et un manifeste Storage. Aucun fichier média n'est téléchargé dans le ZIP, seuls les chemins et métadonnées sont exportés.
        </AlertDescription>
      </Alert>

      <div className="grid gap-4 md:grid-cols-4">
        <Card className="p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Database</p>
              <p className="mt-1 text-2xl font-semibold">{result ? exportedTables : "—"}</p>
            </div>
            <Database className="h-5 w-5 text-accent" />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">tables exportées</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Auth</p>
              <p className="mt-1 text-2xl font-semibold">{result?.authUserCount ?? "—"}</p>
            </div>
            <Users className="h-5 w-5 text-accent" />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">utilisateurs listés</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Storage</p>
              <p className="mt-1 text-2xl font-semibold">{result?.storageFileCount ?? "—"}</p>
            </div>
            <HardDrive className="h-5 w-5 text-accent" />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">fichiers dans le manifeste</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">ZIP</p>
              <p className="mt-1 text-2xl font-semibold">{result ? `${(result.blob.size / 1024 / 1024).toFixed(1)} MB` : "—"}</p>
            </div>
            <Archive className="h-5 w-5 text-accent" />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">taille générée</p>
        </Card>
      </div>

      <Card className="p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="font-display text-lg">Export complet V1.0.1 Stable</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Contenu: tables métier, utilisateurs Auth, manifeste des buckets passports, visa-docs, booking-docs, programme-pdfs, media, article-images et programme-images.
            </p>
          </div>
          {downloadUrl && result && (
            <Button asChild variant="outline" className="min-h-11">
              <a href={downloadUrl} download={result.filename}>
                <Download className="h-4 w-4" /> Télécharger le ZIP
              </a>
            </Button>
          )}
        </div>

        {(busy || progress) && (
          <div className="mt-5 space-y-2">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="font-medium">{progress?.step ?? "Préparation"}</span>
              <span className="text-muted-foreground">{progressPct}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-secondary">
              <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${progressPct}%` }} />
            </div>
            {progress?.detail && <p className="text-xs text-muted-foreground">{progress.detail}</p>}
          </div>
        )}

        {result && (
          <div className="mt-5 rounded-lg border border-border bg-secondary/25 p-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge>Backup prêt</Badge>
              <span className="text-muted-foreground">{result.filename}</span>
            </div>
            <div className="mt-3 grid gap-2 text-xs text-muted-foreground md:grid-cols-3">
              <p>Tables exportées: {exportedTables}</p>
              <p>Tables en erreur: {failedTables}</p>
              <p>Audit: admin_logs</p>
            </div>
          </div>
        )}

        {failedTables > 0 && (
          <Alert className="mt-4 border-amber-300 bg-amber-50 text-amber-950">
            <AlertTitle>Export partiel</AlertTitle>
            <AlertDescription>
              Certaines tables optionnelles ou absentes du schéma ont été inscrites dans <span className="font-mono">database/errors</span> du ZIP.
            </AlertDescription>
          </Alert>
        )}
      </Card>
    </div>
  );
}
