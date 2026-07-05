import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Seo } from "@/components/Seo";
import { useRouteSlugs, pathFor } from "@/hooks/useRouteSlugs";
import { supabase } from "@/integrations/supabase/client";
import { trackEvent } from "@/lib/analytics";
import { normalizeVisaChecklistConfig, type VisaChecklistConfig } from "@/lib/visa-document-checklists";
import { AlertTriangle, CheckCircle2, ClipboardCheck, FileCheck2, FileText, LogIn, ShieldCheck, UserPlus } from "lucide-react";

const PROCESS_STEPS = [
  {
    title: "Créez votre espace visa",
    text: "Vous créez votre compte avec votre email et votre numéro de passeport.",
  },
  {
    title: "Remplissez le formulaire",
    text: "Vous complétez les informations nécessaires pour préparer votre demande.",
  },
  {
    title: "Préparez vos documents",
    text: "La liste des documents s’adapte à votre situation professionnelle.",
  },
  {
    title: "Vérification par notre équipe",
    text: "Notre équipe vérifie la cohérence du dossier avant dépôt.",
  },
  {
    title: "Dépôt et suivi",
    text: "Nous vous informons de l’avancement et des prochaines étapes.",
  },
];

const REASSURANCE_POINTS = [
  "Nous ne décidons pas de l’acceptation du visa. La décision finale appartient à l’ambassade du Japon.",
  "Notre rôle est de vous aider à préparer un dossier clair, complet et cohérent.",
  "Les informations doivent correspondre exactement à votre passeport.",
];

const VISA_CANONICAL_PATH = "/visa-japon-maroc";
const VISA_SEO_TITLE = "Visa Japon Maroc | Documents, formulaire et accompagnement - LeJapon.ma";
const VISA_SEO_DESCRIPTION = "Besoin d'un visa pour le Japon depuis le Maroc ? Découvrez les documents nécessaires selon votre profil et bénéficiez d'un accompagnement personnalisé pour préparer votre dossier.";

const VISA_FAQ = [
  {
    question: "Comment obtenir un visa Japon au Maroc ?",
    answer: "Vous devez préparer le formulaire, les justificatifs demandés selon votre profil, puis déposer un dossier complet auprès de l’ambassade du Japon. LeJapon.ma accompagne les participants de ses voyages dans la préparation et la vérification du dossier.",
  },
  {
    question: "Quels documents sont nécessaires pour un visa Japon ?",
    answer: "La liste dépend de votre situation professionnelle : salarié, fonctionnaire, étudiant, retraité, entrepreneur ou autre profil. La page affiche les documents configurés dans notre backoffice, et la liste exacte peut être ajustée selon votre dossier.",
  },
  {
    question: "Combien coûte le visa Japon ?",
    answer: "L’accompagnement LeJapon.ma est inclus pour les participants de nos voyages. Les frais officiels de l’ambassade sont réglés directement à l’ambassade du Japon uniquement en cas de réponse favorable.",
  },
  {
    question: "Combien de temps prend la réponse ?",
    answer: "Le délai dépend de l’ambassade du Japon et de la période de dépôt. Notre équipe vous informe des étapes et du suivi dès que votre dossier avance.",
  },
  {
    question: "Est-ce que LeJapon.ma garantit l’obtention du visa ?",
    answer: "Non. LeJapon.ma aide à préparer un dossier clair et complet, mais la décision finale appartient toujours à l’ambassade du Japon.",
  },
];

export default function VisaLogin() {
  const { user, signIn, loading } = useAuth();
  const nav = useNavigate();
  const slugs = useRouteSlugs();
  const visaBase = pathFor(slugs, "visa");
  const visaApplicationsPath = `${visaBase}/applications`;
  const authRef = useRef<HTMLDivElement | null>(null);
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [passportNo, setPassportNo] = useState("");
  const [busy, setBusy] = useState(false);
  const [accountMessage, setAccountMessage] = useState<string | null>(null);
  const [checklists, setChecklists] = useState<VisaChecklistConfig[]>([]);
  const [activeChecklist, setActiveChecklist] = useState("");
  const [checklistsLoading, setChecklistsLoading] = useState(true);
  const [checklistsError, setChecklistsError] = useState<string | null>(null);

  useEffect(() => { if (!loading && user) nav(visaApplicationsPath, { replace: true }); }, [user, loading, nav, visaApplicationsPath]);
  useEffect(() => {
    trackEvent("visa_landing_viewed", { page: "visa_login" });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadChecklists = async () => {
      setChecklistsLoading(true);
      setChecklistsError(null);
      const { data, error } = await supabase
        .from("visa_document_checklists")
        .select("id,category,label,description,items,is_active,sort_order")
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .order("label", { ascending: true });
      if (cancelled) return;
      if (error) {
        setChecklists([]);
        setChecklistsError("Les listes de documents sont momentanément indisponibles.");
      } else {
        const rows = (data ?? []).map(normalizeVisaChecklistConfig).filter((row) => row.items.length > 0);
        setChecklists(rows);
        setActiveChecklist((current) => current || "");
      }
      setChecklistsLoading(false);
    };
    loadChecklists();
    return () => { cancelled = true; };
  }, []);

  const selectedChecklist = useMemo(
    () => checklists.find((row) => row.category === activeChecklist) ?? checklists[0] ?? null,
    [activeChecklist, checklists],
  );
  const faqJsonLd = useMemo(() => ({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: VISA_FAQ.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer,
      },
    })),
  }), []);

  const scrollToAuth = (nextMode: "login" | "signup", source: string) => {
    setMode(nextMode);
    trackEvent(nextMode === "signup" ? "visa_create_account_cta_clicked" : "visa_login_cta_clicked", { source });
    requestAnimationFrame(() => authRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const onChecklistCategoryChange = (category: string) => {
    setActiveChecklist(category);
    trackEvent("visa_documents_category_selected", { category });
  };

  const accessVisaSpace = (source: string) => {
    trackEvent("visa_login_cta_clicked", { source, action: "access_visa_space" });
    nav(visaApplicationsPath);
  };

  const requirementTags = (item: VisaChecklistConfig["items"][number]) => {
    if (!item.required) return ["Optionnel"];
    const tags = [
      item.original_required ? "Original requis" : null,
      item.copy_upload_required ? "Copie / scan demandé" : null,
    ].filter(Boolean) as string[];
    return tags.length ? tags : ["Copie / scan demandé"];
  };

  const friendlyAuthError = (message?: string) => {
    if (/email not confirmed/i.test(message ?? "")) {
      return "Votre compte n'est pas encore activé. Merci de contacter notre équipe si le problème persiste.";
    }
    return message ?? "Erreur";
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      setAccountMessage(null);
      if (mode === "login") {
        const cleanEmail = email.trim().toLowerCase();
        const { error } = await signIn(cleanEmail, password);
        if (error) throw error;
        toast.success("Connecté");
        const shouldCreateVisa = localStorage.getItem("visa:createAfterConfirmedLogin") === cleanEmail;
        if (shouldCreateVisa) localStorage.removeItem("visa:createAfterConfirmedLogin");
        nav(shouldCreateVisa ? `${visaApplicationsPath}?create=1` : visaApplicationsPath, { replace: true });
      } else {
        const cleanEmail = email.trim().toLowerCase();
        const cleanFirstName = firstName.trim();
        const cleanLastName = lastName.trim();
        const cleanPassportNo = passportNo.trim().toUpperCase().replace(/\s+/g, "");

        if (!cleanFirstName || !cleanLastName) {
          throw new Error("Prénom et nom sont obligatoires.");
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
          throw new Error("Adresse email invalide.");
        }
        if (password.length < 8) {
          throw new Error("Le mot de passe doit contenir au moins 8 caractères.");
        }

        trackEvent("visa_form_started", { source: "visa_login" });
        const { data, error } = await supabase.functions.invoke("visa-client-signup", {
          body: {
            first_name: cleanFirstName,
            last_name: cleanLastName,
            email: cleanEmail,
            password,
            passport_no: cleanPassportNo || undefined,
          },
        });
        const payload = data as any;
        if (error || !payload?.success) {
          throw new Error(payload?.message || payload?.error || error?.message || "Création du compte impossible.");
        }
        if (payload.prefill_status === "found") {
          localStorage.setItem("visa:createAfterConfirmedLogin", cleanEmail);
          toast.success("Compte créé. Passeport reconnu: votre demande pourra être préremplie après connexion.");
        } else {
          localStorage.removeItem("visa:createAfterConfirmedLogin");
        }
        const message = payload.email_sent === false
          ? "Compte créé, mais l’email de confirmation n’a pas pu être envoyé. Vous pouvez quand même vous connecter."
          : "Compte créé. Vous pouvez maintenant vous connecter.";
        setAccountMessage(message);
        toast.success(message);
        setEmail(cleanEmail);
        setPassword("");
        setMode("login");
      }
    } catch (e: any) { toast.error(friendlyAuthError(e.message)); } finally { setBusy(false); }
  };

  return (
    <div className="bg-[#F7FAFC] pb-28 sm:pb-16">
      <Seo
        title={VISA_SEO_TITLE}
        description={VISA_SEO_DESCRIPTION}
        canonical={VISA_CANONICAL_PATH}
        jsonLd={faqJsonLd}
      />

      <section className="container-app grid gap-10 py-10 lg:grid-cols-[minmax(0,1fr)_430px] lg:py-16 xl:gap-14">
        <div className="min-w-0 space-y-8">
          <div className="max-w-3xl">
            <Badge className="mb-5 bg-sky-100 text-sky-950 hover:bg-sky-100">Espace visa LeJapon.ma</Badge>
            <h1 className="font-display text-4xl leading-tight text-foreground sm:text-5xl lg:text-6xl">
              Votre demande de visa Japon, accompagnée de A à Z
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-8 text-muted-foreground sm:text-lg">
              Ce service est inclus gratuitement pour les participants de nos voyages LeJapon.ma. Vous préparez vos documents, nous vérifions votre dossier et nous vous accompagnons jusqu’au dépôt.
            </p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <Button size="lg" className="min-h-12 cursor-pointer gap-2" onClick={() => scrollToAuth("signup", "hero")}>
                <UserPlus className="h-4 w-4" />
                Créer mon espace visa
              </Button>
              <Button size="lg" variant="outline" className="min-h-12 cursor-pointer gap-2 bg-white" onClick={() => scrollToAuth("login", "hero")}>
                <LogIn className="h-4 w-4" />
                Se connecter
              </Button>
            </div>
          </div>

          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-5 text-emerald-950 shadow-sm">
            <div className="flex gap-3">
              <ShieldCheck className="mt-1 h-5 w-5 shrink-0" />
              <div>
                <h2 className="font-display text-xl">Service gratuit pour les participants du voyage</h2>
                <p className="mt-2 text-sm leading-7">
                  L’accompagnement visa LeJapon.ma est offert aux voyageurs inscrits à nos circuits. Vous ne payez pas de frais de service supplémentaires. Seuls les frais officiels de l’ambassade du Japon sont à régler directement à l’ambassade uniquement en cas de réponse favorable.
                </p>
                <p className="mt-2 text-xs leading-6 text-emerald-900/80">
                  Un accompagnement indépendant peut être étudié selon les disponibilités de l’équipe, sans engagement automatique.
                </p>
              </div>
            </div>
          </div>

          <section aria-labelledby="visa-process-title" className="rounded-lg border border-border bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2">
              <ClipboardCheck className="h-5 w-5 text-accent" />
              <h2 id="visa-process-title" className="font-display text-2xl">Comment se déroule la procédure</h2>
            </div>
            <div className="mt-6 grid gap-5 lg:grid-cols-2">
              {PROCESS_STEPS.map((step, index) => (
                <article key={step.title} className="relative flex gap-4 rounded-lg border border-border bg-[#FCFAF8] p-4">
                  {index < PROCESS_STEPS.length - 1 && (
                    <span className="absolute left-[31px] top-14 h-[calc(100%-1.75rem)] w-px bg-accent/25 lg:hidden" aria-hidden="true" />
                  )}
                  <div className="relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-semibold text-white shadow-sm">
                    {index + 1}
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-semibold leading-snug">{step.title}</h3>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">{step.text}</p>
                  </div>
                </article>
              ))}
            </div>
            <p className="mt-5 rounded-lg border border-sky-200 bg-sky-50 p-4 text-sm leading-7 text-sky-950">
              Notre rôle est de vous aider à préparer un dossier clair et complet. La décision finale appartient toujours à l’ambassade du Japon.
            </p>
          </section>

          <section aria-labelledby="visa-documents-title" className="rounded-lg border border-border bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <FileText className="h-5 w-5 text-accent" />
                  <h2 id="visa-documents-title" className="font-display text-2xl">Documents à préparer selon votre situation</h2>
                </div>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                  Ces listes viennent de la configuration documents visa du backoffice. La liste exacte peut être ajustée selon votre profil et votre dossier.
                </p>
              </div>
              {checklists.length > 0 && (
                <Badge variant="outline" className="w-fit whitespace-nowrap">
                  {checklists.length} catégorie{checklists.length > 1 ? "s" : ""}
                </Badge>
              )}
            </div>

            {checklistsLoading ? (
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {[0, 1, 2, 3].map((item) => (
                  <div key={item} className="h-20 animate-pulse rounded-lg bg-muted" />
                ))}
              </div>
            ) : checklistsError ? (
              <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
                {checklistsError}
              </div>
            ) : checklists.length === 0 ? (
              <div className="mt-5 rounded-lg border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
                Aucune liste active n’est configurée pour le moment.
              </div>
            ) : (
              <div className="mt-5 space-y-5">
                <div className="max-w-xl">
                  <Label htmlFor="visaSituation">Votre situation</Label>
                  <Select value={activeChecklist} onValueChange={onChecklistCategoryChange}>
                    <SelectTrigger id="visaSituation" className="mt-2 min-h-11 w-full bg-white">
                      <SelectValue placeholder="Sélectionnez votre situation" />
                    </SelectTrigger>
                    <SelectContent>
                      {checklists.map((checklist) => (
                        <SelectItem key={checklist.category} value={checklist.category}>
                          {checklist.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {activeChecklist && selectedChecklist ? (
                  <div className="rounded-lg border border-border bg-[#FCFAF8] p-4">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <h3 className="font-display text-xl">{selectedChecklist.label}</h3>
                        {selectedChecklist.description && <p className="mt-1 text-sm text-muted-foreground">{selectedChecklist.description}</p>}
                      </div>
                      <Badge variant="secondary" className="w-fit">
                        {selectedChecklist.items.length} document{selectedChecklist.items.length > 1 ? "s" : ""}
                      </Badge>
                    </div>
                    <ul className="mt-4 grid gap-2">
                      {selectedChecklist.items.map((item) => (
                        <li key={item.id || item.title_fr} className="flex gap-3 rounded-md bg-white p-3 text-sm shadow-sm">
                          <FileCheck2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                              <p className="font-medium leading-6">{item.title_fr}</p>
                              <div className="flex flex-wrap gap-1 sm:justify-end">
                                {requirementTags(item).map((tag) => (
                                  <Badge key={tag} variant={tag === "Optionnel" ? "outline" : "secondary"} className="whitespace-nowrap text-[11px]">
                                    {tag}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                            {item.notes && <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.notes}</p>}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-border bg-muted/30 p-4 text-sm leading-6 text-muted-foreground">
                    Choisissez votre situation pour afficher les documents à préparer.
                  </div>
                )}

                <div className="flex flex-col gap-3 border-t border-border pt-5 sm:flex-row">
                  {user ? (
                    <Button className="min-h-11 gap-2" onClick={() => accessVisaSpace("documents")}>
                      <FileText className="h-4 w-4" />
                      Accéder à ma demande visa
                    </Button>
                  ) : (
                    <>
                      <Button className="min-h-11 gap-2" onClick={() => scrollToAuth("signup", "documents")}>
                        <UserPlus className="h-4 w-4" />
                        Créer mon espace visa
                      </Button>
                      <Button variant="outline" className="min-h-11 gap-2 bg-white" onClick={() => scrollToAuth("login", "documents")}>
                        <LogIn className="h-4 w-4" />
                        Se connecter
                      </Button>
                    </>
                  )}
                </div>
              </div>
            )}
          </section>

          <section aria-labelledby="visa-reassurance-title" className="rounded-lg border border-sky-200 bg-sky-50 p-5 text-sky-950">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              <h2 id="visa-reassurance-title" className="font-display text-2xl">À retenir avant de commencer</h2>
            </div>
            <div className="mt-4 grid gap-3">
              {REASSURANCE_POINTS.map((point) => (
                <div key={point} className="flex gap-3 rounded-md bg-white/70 p-3 text-sm leading-6">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                  <p>{point}</p>
                </div>
              ))}
            </div>
          </section>

          <section aria-labelledby="visa-faq-title" className="rounded-lg border border-border bg-white p-5 shadow-sm">
            <h2 id="visa-faq-title" className="font-display text-2xl">Questions fréquentes sur le visa Japon</h2>
            <div className="mt-4 divide-y divide-border">
              {VISA_FAQ.map((item) => (
                <article key={item.question} className="py-4 first:pt-0 last:pb-0">
                  <h3 className="font-semibold leading-6">{item.question}</h3>
                  <p className="mt-2 text-sm leading-7 text-muted-foreground">{item.answer}</p>
                </article>
              ))}
            </div>
          </section>
        </div>

        <aside ref={authRef} className="min-w-0 scroll-mt-24 lg:sticky lg:top-6 lg:self-start">
          <Card className="rounded-lg p-6 shadow-lg sm:p-8">
            <h2 className="font-display text-2xl text-center mb-2">Espace visa Japon</h2>
            <p className="text-sm text-muted-foreground text-center mb-6">
              {mode === "login" ? "Connectez-vous pour accéder à vos demandes." : "Créez votre compte pour commencer."}
            </p>
            <div className="mb-5 grid grid-cols-2 rounded-md bg-muted p-1 text-sm">
              <button
                type="button"
                onClick={() => {
                  setMode("signup");
                  trackEvent("visa_create_account_cta_clicked", { source: "auth_toggle" });
                }}
                className={`min-h-10 cursor-pointer rounded-sm font-medium transition-colors ${mode === "signup" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              >
                Créer
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode("login");
                  trackEvent("visa_login_cta_clicked", { source: "auth_toggle" });
                }}
                className={`min-h-10 cursor-pointer rounded-sm font-medium transition-colors ${mode === "login" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              >
                Se connecter
              </button>
            </div>
            {accountMessage && (
              <div className="mb-5 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950">
                <p>{accountMessage}</p>
              </div>
            )}
            <form onSubmit={submit} className="space-y-4">
              {mode === "signup" && (
                <>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                    <div>
                      <Label htmlFor="firstName">Prénom</Label>
                      <Input id="firstName" required value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                    </div>
                    <div>
                      <Label htmlFor="lastName">Nom</Label>
                      <Input id="lastName" required value={lastName} onChange={(e) => setLastName(e.target.value)} />
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="passportNo">Numéro de passeport <span className="text-muted-foreground">(optionnel)</span></Label>
                    <Input
                      id="passportNo"
                      autoCapitalize="characters"
                      value={passportNo}
                      onChange={(e) => setPassportNo(e.target.value.toUpperCase())}
                      placeholder="Ex. AB123456"
                    />
                  </div>
                </>
              )}
              <div>
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="password">Mot de passe</Label>
                <Input id="password" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              <Button type="submit" className="w-full min-h-11" disabled={busy}>
                {busy ? "…" : mode === "login" ? "Se connecter" : "Créer le compte"}
              </Button>
            </form>
            <p className="text-center text-sm mt-6">
              {mode === "login" ? (
                <>Pas encore de compte ? <button onClick={() => scrollToAuth("signup", "auth_text_link")} className="cursor-pointer text-accent font-medium">Créer</button></>
              ) : (
                <>Déjà inscrit ? <button onClick={() => scrollToAuth("login", "auth_text_link")} className="cursor-pointer text-accent font-medium">Se connecter</button></>
              )}
            </p>
            <p className="text-center text-xs text-muted-foreground mt-6">
              <Link to="/" className="hover:text-accent">← Retour à l'accueil</Link>
            </p>
          </Card>
        </aside>
      </section>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 p-3 shadow-[0_-8px_24px_rgba(0,0,0,0.08)] backdrop-blur sm:hidden">
        <div className="grid grid-cols-2 gap-2">
          <Button className="min-h-11 gap-2" onClick={() => scrollToAuth("signup", "mobile_sticky")}>
            <UserPlus className="h-4 w-4" />
            Créer
          </Button>
          <Button variant="outline" className="min-h-11 gap-2 bg-white" onClick={() => scrollToAuth("login", "mobile_sticky")}>
            <LogIn className="h-4 w-4" />
            Connexion
          </Button>
        </div>
      </div>
    </div>
  );
}
