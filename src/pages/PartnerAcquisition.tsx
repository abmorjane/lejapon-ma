import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  Globe2,
  Handshake,
  Loader2,
  Mail,
  MapPin,
  MessageSquare,
  Phone,
  Send,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { Seo } from "@/components/Seo";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import heroFuji from "@/assets/hero-fuji.jpg";
import kyotoAlley from "@/assets/kyoto-alley.jpg";

type PartnerRequestForm = {
  agency_name: string;
  manager_name: string;
  email: string;
  phone: string;
  city_country: string;
  website_social: string;
  partnership_type: string;
  message: string;
};

const defaultForm: PartnerRequestForm = {
  agency_name: "",
  manager_name: "",
  email: "",
  phone: "",
  city_country: "",
  website_social: "",
  partnership_type: "Agence revendeuse",
  message: "",
};

const strengths = [
  "Spécialisation Japon",
  "Accompagnement francophone et japonophone",
  "Programmes testés sur le terrain",
  "Gestion complète du voyage",
  "Documents et suivi administratif",
  "Expérience avec groupes marocains",
  "Haut niveau de satisfaction client",
];

const steps = [
  "Vous demandez un compte partenaire.",
  "Nous validons votre agence.",
  "Vous inscrivez vos clients ou nous vous accompagnons.",
  "Vous suivez vos réservations dans votre espace partenaire.",
  "Vos commissions sont calculées selon les règles définies.",
];

export default function PartnerAcquisition() {
  const [form, setForm] = useState<PartnerRequestForm>(defaultForm);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  const update = (key: keyof PartnerRequestForm) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setForm((current) => ({ ...current, [key]: event.target.value }));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();

    if (!form.agency_name.trim() || !form.manager_name.trim() || !form.email.trim() || !form.phone.trim()) {
      toast.error("Merci de renseigner au minimum l'agence, le responsable, l'email et le téléphone.");
      return;
    }

    setSubmitting(true);
    const { error } = await (supabase as any).rpc("submit_partner_request", {
      p_agency_name: form.agency_name.trim(),
      p_manager_name: form.manager_name.trim(),
      p_email: form.email.trim(),
      p_phone: form.phone.trim(),
      p_city_country: form.city_country.trim() || null,
      p_website_social: form.website_social.trim() || null,
      p_partnership_type: form.partnership_type.trim() || null,
      p_message: form.message.trim() || null,
    });

    setSubmitting(false);

    if (error) {
      toast.error(error.message ?? "Impossible d'envoyer votre demande pour le moment.");
      return;
    }

    setSuccess(true);
    setForm(defaultForm);
    toast.success("Votre demande partenaire a bien été reçue.");
  };

  return (
    <>
      <Seo
        title="Devenir partenaire agence de voyage Japon | LeJapon.ma"
        description="Rejoignez le réseau de partenaires LeJapon.ma et proposez des voyages organisés au Japon à vos clients avec un spécialiste du terrain."
        canonical="/devenir-partenaire"
      />

      <section className="relative min-h-[78vh] overflow-hidden">
        <img src={heroFuji} alt="" className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/45 to-black/20" />
        <div className="container-app relative z-10 flex min-h-[78vh] items-center py-20 text-white">
          <div className="max-w-3xl">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-4 py-2 text-sm backdrop-blur">
              <Sparkles className="h-4 w-4 text-accent" />
              Réseau partenaires LeJapon.ma
            </div>
            <h1 className="font-display text-4xl leading-tight md:text-6xl">
              Devenez partenaire LeJapon.ma
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-white/82 md:text-xl">
              Proposez le Japon à vos clients avec une équipe spécialiste du terrain, une organisation fiable et un accompagnement complet.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a href="#demande-partenaire" className="btn-primary inline-flex min-h-12 items-center justify-center gap-2">
                Demander un compte partenaire
                <ArrowRight className="h-4 w-4" />
              </a>
              <Link to="/agency/login" className="inline-flex min-h-12 items-center justify-center rounded-full border border-white/30 bg-white/10 px-6 font-semibold text-white backdrop-blur transition hover:bg-white/20">
                Connexion espace partenaire
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="container-app -mt-16 relative z-20">
        <div className="grid gap-4 md:grid-cols-2">
          <Card className="p-6 shadow-soft">
            <div className="flex items-start gap-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-secondary">
                <ShieldCheck className="h-5 w-5 text-accent" />
              </div>
              <div>
                <h2 className="font-display text-xl">Déjà partenaire ?</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  Connectez-vous pour accéder à votre espace partenaire.
                </p>
                <Button asChild variant="outline" className="mt-4">
                  <Link to="/agency/login">Se connecter</Link>
                </Button>
              </div>
            </div>
          </Card>
          <Card className="p-6 shadow-soft">
            <div className="flex items-start gap-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-accent/10">
                <Handshake className="h-5 w-5 text-accent" />
              </div>
              <div>
                <h2 className="font-display text-xl">Nouvelle agence ?</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  Demandez la création d'un compte partenaire LeJapon.ma.
                </p>
                <Button asChild className="mt-4">
                  <a href="#demande-partenaire">Demander un compte</a>
                </Button>
              </div>
            </div>
          </Card>
        </div>
      </section>

      <section className="container-app py-20">
        <div className="grid gap-12 lg:grid-cols-[1fr_0.85fr] lg:items-center">
          <div>
            <p className="eyebrow mb-4">Pourquoi devenir partenaire ?</p>
            <h2 className="font-display text-3xl md:text-4xl">Vendre le Japon avec un spécialiste terrain.</h2>
            <div className="mt-8 grid gap-4">
              {[
                "Vous proposez le Japon sans devoir tout organiser vous-même.",
                "Nous maîtrisons le terrain, les étapes, les hôtels, les visites et les réalités du voyage au Japon.",
                "Vous gardez la relation commerciale avec votre client.",
                "Nous vous apportons l'expertise opérationnelle.",
              ].map((item) => (
                <div key={item} className="flex gap-3 rounded-lg border border-border bg-background p-4">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
                  <p className="text-sm leading-relaxed text-foreground/80">{item}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="overflow-hidden rounded-2xl">
            <img src={kyotoAlley} alt="Voyage au Japon avec LeJapon.ma" className="aspect-[4/5] w-full object-cover" />
          </div>
        </div>
      </section>

      <section className="bg-secondary/45 py-20">
        <div className="container-app">
          <div className="mb-10 max-w-2xl">
            <p className="eyebrow mb-4">Nos forces</p>
            <h2 className="font-display text-3xl md:text-4xl">Une organisation fiable, lisible, pensée pour les agences.</h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {strengths.map((strength) => (
              <Card key={strength} className="p-5">
                <Globe2 className="mb-4 h-5 w-5 text-accent" />
                <p className="font-medium">{strength}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section className="container-app py-20">
        <div className="grid gap-12 lg:grid-cols-[0.8fr_1fr]">
          <div>
            <p className="eyebrow mb-4">Comment ça marche ?</p>
            <h2 className="font-display text-3xl md:text-4xl">Un parcours simple, validé manuellement.</h2>
          </div>
          <div className="space-y-3">
            {steps.map((step, index) => (
              <div key={step} className="flex gap-4 rounded-lg border border-border p-4">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-foreground text-sm font-semibold text-background">
                  {index + 1}
                </div>
                <p className="pt-1 text-sm leading-relaxed text-foreground/80">{step}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="demande-partenaire" className="bg-foreground py-20 text-background">
        <div className="container-app grid gap-10 lg:grid-cols-[0.8fr_1fr]">
          <div>
            <p className="eyebrow !text-background/55 mb-4">Formulaire</p>
            <h2 className="font-display text-3xl md:text-4xl">Demande partenaire</h2>
            <p className="mt-4 leading-relaxed text-background/72">
              Chaque demande est relue manuellement. Aucun accès partenaire n'est créé automatiquement.
            </p>
            <div className="mt-8 space-y-4 text-sm text-background/75">
              <p className="flex items-center gap-3"><Mail className="h-4 w-4 text-accent" /> info@lejapon.ma</p>
              <p className="flex items-center gap-3"><Phone className="h-4 w-4 text-accent" /> +212 711 449 838</p>
              <p className="flex items-center gap-3"><MapPin className="h-4 w-4 text-accent" /> Temara, Morocco</p>
            </div>
          </div>

          <Card className="bg-background p-5 text-foreground md:p-7">
            {success ? (
              <div className="py-10 text-center">
                <CheckCircle2 className="mx-auto h-12 w-12 text-accent" />
                <h3 className="mt-4 font-display text-2xl">Demande reçue.</h3>
                <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
                  Notre équipe va étudier votre demande et vous recontacter. Aucun accès n'est créé automatiquement.
                </p>
                <Button className="mt-6" onClick={() => setSuccess(false)}>Envoyer une autre demande</Button>
              </div>
            ) : (
              <form onSubmit={submit} className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="agency_name">Nom de l'agence *</Label>
                  <Input id="agency_name" value={form.agency_name} onChange={update("agency_name")} className="min-h-11" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="manager_name">Nom du responsable *</Label>
                  <Input id="manager_name" value={form.manager_name} onChange={update("manager_name")} className="min-h-11" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email *</Label>
                  <Input id="email" type="email" value={form.email} onChange={update("email")} className="min-h-11" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone">Téléphone *</Label>
                  <Input id="phone" value={form.phone} onChange={update("phone")} className="min-h-11" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="city_country">Ville / pays</Label>
                  <Input id="city_country" value={form.city_country} onChange={update("city_country")} className="min-h-11" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="website_social">Site web / réseaux sociaux</Label>
                  <Input id="website_social" value={form.website_social} onChange={update("website_social")} className="min-h-11" />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="partnership_type">Type de partenariat souhaité</Label>
                  <select
                    id="partnership_type"
                    value={form.partnership_type}
                    onChange={update("partnership_type")}
                    className="flex min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    <option>Agence revendeuse</option>
                    <option>Groupes accompagnés</option>
                    <option>Voyages sur mesure</option>
                    <option>Partenariat B2B régulier</option>
                  </select>
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="message">Message</Label>
                  <Textarea id="message" value={form.message} onChange={update("message")} rows={5} />
                </div>
                <div className="md:col-span-2">
                  <Button type="submit" disabled={submitting} className="min-h-12 w-full">
                    {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    Envoyer la demande
                  </Button>
                </div>
              </form>
            )}
          </Card>
        </div>
      </section>
    </>
  );
}
