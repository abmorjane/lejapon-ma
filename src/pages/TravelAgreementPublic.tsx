import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { toast } from "sonner";
import { CheckCircle2, Download, FileSignature, Loader2, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Seo } from "@/components/Seo";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { fmtDateTime } from "@/lib/format";
import { trackEvent } from "@/lib/analytics";
import {
  ACCEPTANCE_STATEMENT,
  downloadTravelAgreementPdf,
  generateTravelAgreementPdf,
  type TravelAgreement,
  type TravelAgreementAcceptance,
} from "@/lib/travel-agreements";

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
};

export default function TravelAgreementPublic() {
  const { token } = useParams();
  const [agreement, setAgreement] = useState<TravelAgreement | null>(null);
  const [acceptance, setAcceptance] = useState<TravelAgreementAcceptance | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [passportNumber, setPassportNumber] = useState("");
  const [reviewMessage, setReviewMessage] = useState("");
  const [acceptanceStarted, setAcceptanceStarted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase.functions.invoke("travel-agreement", {
          body: { action: "get", token },
        });
        if (error || data?.ok === false) throw new Error(data?.error || error?.message || "Accord introuvable");
        if (!cancelled) {
          setAgreement(data.agreement);
          setAcceptance(data.acceptance ?? null);
          const evidence = data.agreement?.content?.acceptance_evidence;
          if (evidence?.accepted_first_name) setFirstName(evidence.accepted_first_name);
          if (evidence?.accepted_last_name) setLastName(evidence.accepted_last_name);
          if (evidence?.accepted_passport_number) setPassportNumber(evidence.accepted_passport_number);
          if (!evidence?.accepted_passport_number && data.agreement?.content?.summary?.passport_number) {
            setPassportNumber(data.agreement.content.summary.passport_number);
          }
          trackEvent("travel_agreement_public_opened", { status: data.agreement?.status || "unknown" });
        }
      } catch (error: any) {
        toast.error(error?.message ?? "Accord introuvable.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const accepted = agreement?.status === "accepted" || Boolean(acceptance);
  const canAccept = checked && firstName.trim().length >= 2 && lastName.trim().length >= 2 && passportNumber.trim().length >= 5 && !accepted;

  const filename = useMemo(() => {
    if (!agreement) return "accord-voyage.pdf";
    return `accord-voyage-${agreement.booking_reference || agreement.id.slice(0, 8)}.pdf`;
  }, [agreement]);

  const markAcceptanceStarted = () => {
    if (acceptanceStarted) return;
    setAcceptanceStarted(true);
    trackEvent("travel_agreement_acceptance_started", { status: agreement?.status || "unknown" });
  };

  const acceptAgreement = async () => {
    if (!token || !agreement) return;
    if (!canAccept) return toast.error("Merci de compléter prénom, nom, passeport et acceptation.");
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("travel-agreement", {
        body: {
          action: "accept",
          token,
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          passport_number: passportNumber.trim(),
          email: agreement.client_email,
        },
      });
      if (error || data?.ok === false) throw new Error(data?.error || error?.message || "Acceptation impossible");
      const acceptedAgreement = data.agreement as TravelAgreement;
      const acceptedAcceptance = data.acceptance as TravelAgreementAcceptance;
      setAgreement(acceptedAgreement);
      setAcceptance(acceptedAcceptance);
      trackEvent("travel_agreement_accepted", { status: "accepted" });

      try {
        const bytes = await generateTravelAgreementPdf({ agreement: acceptedAgreement, acceptance: acceptedAcceptance });
        const { data: stored, error: storeError } = await supabase.functions.invoke("travel-agreement", {
          body: {
            action: "store_final_pdf",
            token,
            filename,
            pdf_base64: bytesToBase64(bytes),
          },
        });
        if (storeError || stored?.ok === false) throw new Error(stored?.error || storeError?.message || "PDF final non envoyé");
        trackEvent("travel_agreement_pdf_generated", { status: "accepted" });
      } catch (pdfError: any) {
        toast.warning(pdfError?.message ?? "Accord accepté, mais l’envoi du PDF final doit être relancé.");
      }

      toast.success("Accord de voyage accepté.");
    } catch (error: any) {
      toast.error(error?.message ?? "Acceptation impossible.");
    } finally {
      setBusy(false);
    }
  };

  const requestReview = async () => {
    if (!token) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("travel-agreement", {
        body: { action: "needs_review", token, message: reviewMessage.trim() },
      });
      if (error || data?.ok === false) throw new Error(data?.error || error?.message || "Demande impossible");
      setAgreement(data.agreement);
      toast.success("Votre demande de révision a été envoyée.");
    } catch (error: any) {
      toast.error(error?.message ?? "Demande impossible.");
    } finally {
      setBusy(false);
    }
  };

  const downloadPdf = async () => {
    if (!agreement) return;
    const bytes = await generateTravelAgreementPdf({ agreement, acceptance });
    downloadTravelAgreementPdf(bytes, filename);
  };

  if (loading) {
    return (
      <main className="min-h-[70vh] bg-secondary/20 px-4 py-16">
        <div className="mx-auto flex max-w-3xl items-center justify-center rounded-lg border bg-background p-10 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Chargement de l’accord…
        </div>
      </main>
    );
  }

  if (!agreement) {
    return (
      <main className="min-h-[70vh] bg-secondary/20 px-4 py-16">
        <Card className="mx-auto max-w-2xl">
          <CardContent className="p-8 text-center">
            <FileSignature className="mx-auto mb-4 h-10 w-10 text-muted-foreground" />
            <h1 className="font-display text-2xl">Accord introuvable</h1>
            <p className="mt-2 text-muted-foreground">Le lien est invalide ou l’accord n’est plus disponible.</p>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="bg-[#faf7f2]">
      <Seo
        title="Accord de voyage — LeJapon.ma"
        description="Lecture et acceptation sécurisée de votre accord de voyage LeJapon.ma."
        noindex
      />
      <section className="border-b bg-background">
        <div className="mx-auto max-w-5xl px-4 py-8">
          <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="mb-2 inline-flex items-center gap-2 rounded-full bg-red-50 px-3 py-1 text-xs font-semibold text-red-700">
                <ShieldCheck className="h-3.5 w-3.5" /> Lien sécurisé
              </p>
              <h1 className="font-display text-3xl md:text-4xl">Accord de voyage</h1>
              <p className="mt-2 text-muted-foreground">{agreement.trip_title} · {agreement.content?.summary?.trip_dates}</p>
            </div>
            <Button variant="outline" onClick={downloadPdf}>
              <Download className="h-4 w-4" /> Télécharger le PDF
            </Button>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-5xl gap-6 px-4 py-8 lg:grid-cols-[1fr_320px]">
        <article className="space-y-4">
          <Card>
            <CardContent className="grid gap-3 p-5 sm:grid-cols-2">
              <Info label="Client" value={agreement.client_name} />
              <Info label="Référence" value={agreement.booking_reference} />
              <Info label="Voyage" value={agreement.trip_title} />
              <Info label="Paiement" value={agreement.content?.summary?.payment_status} />
            </CardContent>
          </Card>

          {agreement.content.sections.map((section) => (
            <Card key={section.key}>
              <CardContent className="p-5">
                <h2 className="font-display text-xl">{section.title}</h2>
                {section.body && <p className="mt-3 whitespace-pre-line leading-7 text-foreground/80">{section.body}</p>}
                {section.items && section.items.length > 0 && (
                  <ul className="mt-4 space-y-2">
                    {section.items.map((item, index) => (
                      <li key={`${section.key}-${index}`} className="flex gap-2 text-sm leading-6">
                        <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-red-600" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          ))}
        </article>

        <aside className="lg:sticky lg:top-6 lg:self-start">
          <Card>
            <CardContent className="space-y-4 p-5">
              {accepted ? (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-emerald-800">
                  <CheckCircle2 className="mb-2 h-6 w-6" />
                  <p className="font-semibold">Accord accepté</p>
                  <p className="mt-1 text-sm">
                    {(agreement.content.acceptance_evidence?.accepted_full_name || acceptance?.typed_name) && (
                      <>Par {agreement.content.acceptance_evidence?.accepted_full_name || acceptance?.typed_name}<br /></>
                    )}
                    {agreement.content.acceptance_evidence?.accepted_passport_number && (
                      <>Passeport : {agreement.content.acceptance_evidence.accepted_passport_number}<br /></>
                    )}
                    {acceptance?.accepted_at && <>Le {fmtDateTime(acceptance.accepted_at)}</>}
                  </p>
                </div>
              ) : (
                <>
                  <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
                    <div className="flex items-start gap-3">
                      <Checkbox
                        id="accept-agreement"
                        checked={checked}
                        onCheckedChange={(value) => {
                          markAcceptanceStarted();
                          setChecked(Boolean(value));
                        }}
                      />
                      <Label htmlFor="accept-agreement" className="text-sm leading-5">
                        {ACCEPTANCE_STATEMENT}
                      </Label>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Prénom</Label>
                        <Input value={firstName} onFocus={markAcceptanceStarted} onChange={(event) => setFirstName(event.target.value)} placeholder="Votre prénom" />
                      </div>
                      <div className="space-y-2">
                        <Label>Nom</Label>
                        <Input value={lastName} onFocus={markAcceptanceStarted} onChange={(event) => setLastName(event.target.value)} placeholder="Votre nom" />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Numéro de passeport</Label>
                      <Input value={passportNumber} onFocus={markAcceptanceStarted} onChange={(event) => setPassportNumber(event.target.value)} placeholder="Ex. AB1234567" />
                    </div>
                    <Button className="w-full" onClick={acceptAgreement} disabled={!canAccept || busy}>
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                      ACCEPTER ET SIGNER L'ACCORD
                    </Button>
                  </div>

                  <div className="space-y-2">
                    <Label>Besoin d’une correction ?</Label>
                    <Textarea rows={4} value={reviewMessage} onChange={(event) => setReviewMessage(event.target.value)} placeholder="Indiquez ce qui doit être revu." />
                    <Button variant="outline" className="w-full" onClick={requestReview} disabled={busy}>
                      Demander une révision
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </aside>
      </section>
    </main>
  );
}

function Info({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 font-medium">{value || "—"}</p>
    </div>
  );
}
