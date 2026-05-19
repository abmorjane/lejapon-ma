import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { ArrowLeft, Download, Eye, FileText, Mail, Save } from "lucide-react";
import { toast } from "sonner";
import { generateVisaPdf, downloadBlob } from "@/lib/visa-pdf";
import { generateInvitationLetter, generateGuaranteeLetter } from "@/lib/visa-letters";
import { PdfPreviewDialog } from "@/admin/components/PdfPreviewDialog";
import { useCallback } from "react";
import { Input } from "@/components/ui/input";
import { MailQuestion, Package } from "lucide-react";
import JSZip from "jszip";
import { QuickActions } from "@/admin/components/QuickActions";

const STATUS_LABEL: Record<string, string> = {
  draft: "Brouillon",
  submitted: "Soumise",
  awaiting_documents: "En attente des documents",
  documents_received: "Documents reçus",
  in_review: "En traitement",
  submitted_to_embassy: "Soumise à l'ambassade",
  approved: "Approuvée",
  rejected: "Rejetée",
  completed: "Terminée",
};

export default function VisaApplicationDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [app, setApp] = useState<any | null>(null);
  const [docs, setDocs] = useState<any[]>([]);
  const [settings, setSettings] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<null | "visa" | "invitation" | "guarantee">(null);

  useEffect(() => {
    Promise.all([
      supabase.from("visa_applications").select("*").eq("id", id!).maybeSingle(),
      supabase.from("visa_documents").select("*").eq("application_id", id!).order("created_at"),
      supabase.from("visa_settings").select("*").limit(1).maybeSingle(),
    ]).then(([a, d, s]) => {
      if (!a.data) { toast.error("Demande introuvable"); nav("/admin/visa"); return; }
      setApp(a.data); setDocs(d.data ?? []); setSettings(s.data);
    });
  }, [id, nav]);

  const updateStatus = async (status: string) => {
    setBusy(true);
    const patch: any = { status, reviewed_at: new Date().toISOString() };
    const { error } = await supabase.from("visa_applications").update(patch).eq("id", app.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    setApp({ ...app, ...patch });
    toast.success("Statut mis à jour");
    // Fire-and-forget email notification to the client
    supabase.functions.invoke("send-visa-email", {
      body: { application_id: app.id, status, extra: app.requested_documents ?? null },
    }).then(({ error: e }) => {
      if (e) console.warn("notification email failed", e);
    });
  };

  const saveNotes = async () => {
    const { error } = await supabase.from("visa_applications").update({ admin_notes: app.admin_notes ?? "" }).eq("id", app.id);
    if (error) return toast.error(error.message);
    toast.success("Notes enregistrées");
  };

  const requestDocs = async () => {
    const text = (app.requested_documents ?? "").trim();
    if (!text) return toast.error("Indiquez les documents demandés.");
    setBusy(true);
    const patch = { requested_documents: text, documents_requested_at: new Date().toISOString() };
    const { error } = await supabase.from("visa_applications").update(patch).eq("id", app.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    setApp({ ...app, ...patch });
    toast.success("Demande envoyée au client.");
  };

  const sendFormReceived = async () => {
    if (!app) return;
    if (!confirm("Envoyer l'email de confirmation de réception du formulaire au client ?")) return;
    setBusy(true);
    const { error } = await supabase.functions.invoke("send-visa-email", {
      body: { application_id: app.id, status: "form_received" },
    });
    setBusy(false);
    if (error) return toast.error(error.message ?? "Échec de l'envoi");
    toast.success("Email envoyé au client");
  };

  const clearRequest = async () => {
    setBusy(true);
    const patch = { requested_documents: null, documents_requested_at: null };
    const { error } = await supabase.from("visa_applications").update(patch).eq("id", app.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    setApp({ ...app, ...patch });
  };

  const downloadDoc = async (d: any) => {
    const { data, error } = await supabase.storage.from("visa-docs").createSignedUrl(d.storage_path, 60);
    if (error || !data) return toast.error("Lien indisponible");
    window.open(data.signedUrl, "_blank");
  };

  const downloadAll = async () => {
    if (!app || !settings) return;
    setBusy(true);
    try {
      const zip = new JSZip();
      // Generated PDFs
      const [visaBytes, invBytes, garBytes] = await Promise.all([
        generateVisaPdf(app, settings),
        generateInvitationLetter(app, settings),
        generateGuaranteeLetter(app, settings),
      ]);
      zip.file(`${app.reference}-visa-japon.pdf`, visaBytes);
      zip.file(`${app.reference}-invitation.pdf`, invBytes);
      zip.file(`${app.reference}-guarantee.pdf`, garBytes);
      // Client uploaded documents
      if (docs.length) {
        const folder = zip.folder("documents-client");
        await Promise.all(docs.map(async (d) => {
          const { data } = await supabase.storage.from("visa-docs").download(d.storage_path);
          if (data) folder!.file(d.file_name, await data.arrayBuffer());
        }));
      }
      const blob = await zip.generateAsync({ type: "uint8array" });
      downloadBlob(blob, `${app.reference}-dossier-complet.zip`);
      toast.success("Archive téléchargée");
    } catch (e: any) { toast.error(e.message ?? "Erreur archive"); }
    finally { setBusy(false); }
  };

  const generators = {
    visa: useCallback(() => generateVisaPdf(app ?? {}, settings ?? {}), [app, settings]),
    invitation: useCallback(() => generateInvitationLetter(app ?? {}, settings ?? {}), [app, settings]),
    guarantee: useCallback(() => generateGuaranteeLetter(app ?? {}, settings ?? {}), [app, settings]),
  };

  const downloadDirect = async (kind: "visa" | "invitation" | "guarantee") => {
    if (!app || !settings) return;
    setBusy(true);
    try {
      const fn = kind === "visa" ? generateVisaPdf : kind === "invitation" ? generateInvitationLetter : generateGuaranteeLetter;
      const bytes = await fn(app, settings);
      const suffix = kind === "visa" ? "visa-japon" : kind === "invitation" ? "invitation" : "guarantee";
      downloadBlob(bytes, `${app.reference}-${suffix}.pdf`);
    } catch (e: any) { toast.error(e.message ?? "Erreur PDF"); }
    finally { setBusy(false); }
  };

  if (!app) return <p className="text-muted-foreground">Chargement…</p>;

  const Row = ({ label, value }: any) => (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-1 sm:gap-2 py-2 text-sm border-b border-border/40 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="sm:col-span-2 font-medium break-words">{value || "—"}</span>
    </div>
  );

  return (
    <div>
      <button onClick={() => nav("/admin/visa")} className="text-sm text-muted-foreground hover:text-foreground mb-4 inline-flex items-center gap-1">
        <ArrowLeft className="w-4 h-4" /> Toutes les demandes
      </button>

      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="font-display text-3xl mb-1">{app.reference}</h1>
          <p className="text-sm text-muted-foreground">{[app.surname, app.given_names].filter(Boolean).join(" ") || "Sans nom"}</p>
          <QuickActions
            phone={app.residential_mobile || app.residential_tel}
            email={app.residential_email}
            passport={app.passport_no}
            onPdf={() => setPreview("visa")}
            className="mt-4 sm:hidden"
          />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center sm:gap-3">
          <Badge>{STATUS_LABEL[app.status]}</Badge>
          <Select value={app.status} onValueChange={updateStatus} disabled={busy}>
            <SelectTrigger className="w-full sm:w-44 min-h-11"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(STATUS_LABEL).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <Card className="p-4 sm:p-5">
            <h2 className="font-display text-lg mb-3">Identité</h2>
            <Row label="Nom / Prénom" value={`${app.surname ?? ""} ${app.given_names ?? ""}`.trim()} />
            <Row label="Autres noms" value={app.other_names} />
            <Row label="Date de naissance" value={app.date_of_birth} />
            <Row label="Lieu de naissance" value={[app.place_of_birth_city, app.place_of_birth_state, app.place_of_birth_country].filter(Boolean).join(", ")} />
            <Row label="Sexe / État civil" value={[app.sex, app.marital_status].filter(Boolean).join(" / ")} />
            <Row label="Nationalité" value={app.nationality} />
            <Row label="N° pièce d'identité" value={app.national_id_no} />
          </Card>

          <Card className="p-4 sm:p-5">
            <h2 className="font-display text-lg mb-3">Passeport</h2>
            <QuickActions passport={app.passport_no} compact className="mb-3" />
            <Row label="Type / N°" value={`${app.passport_type ?? ""} · ${app.passport_no ?? ""}`} />
            <Row label="Lieu de délivrance" value={app.passport_place_of_issue} />
            <Row label="Date de délivrance" value={app.passport_date_of_issue} />
            <Row label="Autorité" value={app.passport_issuing_authority} />
            <Row label="Date d'expiration" value={app.passport_date_of_expiry} />
          </Card>

          <Card className="p-4 sm:p-5">
            <h2 className="font-display text-lg mb-3">Voyage & hébergement</h2>
            <Row label="Motif" value={app.purpose_of_visit} />
            <Row label="Durée" value={app.intended_length_of_stay} />
            <Row label="Arrivée" value={app.date_of_arrival} />
            <Row label="Port d'entrée" value={app.port_of_entry} />
            <Row label="Compagnie / vol" value={app.airline_or_ship} />
            <Separator className="my-2" />
            <Row label="Hôtel" value={app.hotel_name} />
            <Row label="Tel" value={app.hotel_tel} />
            <Row label="Adresse" value={app.hotel_address} />
          </Card>

          <Card className="p-4 sm:p-5">
            <h2 className="font-display text-lg mb-3">Résidence & profession</h2>
            <QuickActions phone={app.residential_mobile || app.residential_tel} email={app.residential_email} compact className="mb-3" />
            <Row label="Adresse" value={app.residential_address} />
            <Row label="Tel / Mobile" value={[app.residential_tel, app.residential_mobile].filter(Boolean).join(" · ")} />
            <Row label="Email" value={app.residential_email} />
            <Row label="Profession" value={app.profession} />
            <Row label="Employeur" value={app.employer_name} />
            <Row label="Tel employeur" value={app.employer_tel} />
            <Row label="Adresse employeur" value={app.employer_address} />
          </Card>

          <Card className="p-4 sm:p-5">
            <h2 className="font-display text-lg mb-3">Déclarations</h2>
            <Row label="Crime / délit" value={app.q_convicted_crime ? "Oui" : "Non"} />
            <Row label="Emprisonnement 1 an+" value={app.q_imprisoned_1y ? "Oui" : "Non"} />
            <Row label="Déportation" value={app.q_deported ? "Oui" : "Non"} />
            <Row label="Drogue" value={app.q_drug_offence ? "Oui" : "Non"} />
            <Row label="Prostitution" value={app.q_prostitution ? "Oui" : "Non"} />
            <Row label="Traite" value={app.q_trafficking ? "Oui" : "Non"} />
            <Row label="Précisions" value={app.declarations_details} />
            <Row label="Remarques" value={app.remarks} />
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="p-4 sm:p-5">
            <h2 className="font-display text-lg mb-3">Actions</h2>
            <p className="text-xs text-muted-foreground mb-3">Documents officiels pré-remplis avec les informations garant par défaut.</p>
            <Button
              size="sm"
              className="w-full min-h-11 mb-3"
              onClick={sendFormReceived}
              disabled={busy || !app.residential_email}
              title={!app.residential_email ? "Aucun email client" : undefined}
            >
              <Mail className="w-4 h-4" /> Formulaire de visa reçu
            </Button>
            {([
              { k: "visa", label: "Formulaire visa officiel" },
              { k: "invitation", label: "Lettre d'invitation" },
              { k: "guarantee", label: "Lettre de garantie" },
            ] as const).map(({ k, label }) => (
              <div key={k} className="flex items-center gap-2 mb-2">
                <Button variant="outline" size="sm" className="flex-1 min-h-11 justify-start" onClick={() => setPreview(k)} disabled={busy}>
                  <Eye className="w-4 h-4" /> {label}
                </Button>
                <Button variant="ghost" size="icon" className="h-11 w-11" onClick={() => downloadDirect(k)} disabled={busy} title="Télécharger">
                  <Download className="w-4 h-4" />
                </Button>
              </div>
            ))}
            <Separator className="my-3" />
            <Button size="sm" className="w-full min-h-11" onClick={downloadAll} disabled={busy}>
              <Package className="w-4 h-4" /> Tout télécharger (ZIP)
            </Button>
          </Card>

          <Card className="p-4 sm:p-5">
            <h2 className="font-display text-lg mb-3">Documents ({docs.length})</h2>
            {docs.length === 0 && <p className="text-sm text-muted-foreground">Aucun document.</p>}
            <div className="space-y-2">
              {docs.map((d) => (
                <button key={d.id} onClick={() => downloadDoc(d)} className="w-full flex items-center gap-2 p-2 border border-border rounded hover:bg-secondary text-left">
                  <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm truncate">{d.file_name}</p>
                    <p className="text-xs text-muted-foreground capitalize">{d.doc_type}</p>
                  </div>
                  <Download className="w-4 h-4 text-muted-foreground" />
                </button>
              ))}
            </div>
          </Card>

          <Card className="p-4 sm:p-5">
            <h2 className="font-display text-lg mb-3 flex items-center gap-2"><MailQuestion className="w-4 h-4" /> Demande de documents</h2>
            <p className="text-xs text-muted-foreground mb-2">
              Précisez ce que le client doit téléverser. Le message sera affiché en haut de son formulaire.
            </p>
            <Textarea
              rows={3}
              placeholder="Ex. Photo d'identité 45×35mm, justificatif d'emploi, réservation d'hôtel…"
              value={app.requested_documents ?? ""}
              onChange={(e) => setApp({ ...app, requested_documents: e.target.value })}
            />
            {app.documents_requested_at && (
              <p className="text-xs text-muted-foreground mt-2">
                Demandé le {new Date(app.documents_requested_at).toLocaleDateString("fr-FR")}
              </p>
            )}
            <div className="flex gap-2 mt-2">
              <Button size="sm" className="flex-1" onClick={requestDocs} disabled={busy}>Envoyer la demande</Button>
              {app.requested_documents && (
                <Button size="sm" variant="ghost" onClick={clearRequest} disabled={busy}>Effacer</Button>
              )}
            </div>
          </Card>

          <Card className="p-4 sm:p-5">
            <h2 className="font-display text-lg mb-3">Notes internes</h2>
            <Textarea rows={6} value={app.admin_notes ?? ""} onChange={(e) => setApp({ ...app, admin_notes: e.target.value })} />
            <Button size="sm" onClick={saveNotes} className="mt-2 w-full"><Save className="w-4 h-4" /> Enregistrer</Button>
          </Card>
        </div>
      </div>

      <PdfPreviewDialog
        open={preview === "visa"}
        onOpenChange={(v) => !v && setPreview(null)}
        title="Formulaire visa officiel"
        filename={`${app.reference}-visa-japon.pdf`}
        generate={generators.visa}
      />
      <PdfPreviewDialog
        open={preview === "invitation"}
        onOpenChange={(v) => !v && setPreview(null)}
        title="Lettre d'invitation"
        filename={`${app.reference}-invitation.pdf`}
        generate={generators.invitation}
      />
      <PdfPreviewDialog
        open={preview === "guarantee"}
        onOpenChange={(v) => !v && setPreview(null)}
        title="Lettre de garantie"
        filename={`${app.reference}-guarantee.pdf`}
        generate={generators.guarantee}
      />
    </div>
  );
}
