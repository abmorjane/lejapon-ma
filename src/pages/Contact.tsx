import { useState } from "react";
import { Mail, MapPin, Loader2 } from "lucide-react";
import { Seo } from "@/components/Seo";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useSiteContent } from "@/hooks/useSiteContent";
import { useRecaptcha } from "@/hooks/useRecaptcha";

const DEFAULTS = {
  eyebrow: "Contact",
  title_main: "Parlons de votre",
  title_accent: "voyage.",
  intro: "Une question, un projet de voyage de groupe, une demande sur mesure ? Notre équipe vous répond sous 24 heures.",
  email: "info@lejapon.ma",
  agency_name: "Moroccan Express Travel and Events",
  addresses: [
    { city: "Temara", line: "Rue Annour, Hay El Wifaq 3, Temara" },
    { city: "Casablanca", line: "4 Rue de Vimy, Casablanca" },
  ],
  success_title: "Message reçu.",
  success_text: "Nous vous répondrons sous 24 heures à l'adresse indiquée.",
};

const Contact = () => {
  const { toast } = useToast();
  const c = useSiteContent("site:contact", DEFAULTS);
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", phone: "", message: "" });
  const { ready: captchaReady, executeRecaptcha } = useRecaptcha();

  const onChange = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    let recaptchaToken = "";
    try {
      recaptchaToken = await executeRecaptcha("contact");
    } catch {
      setSending(false);
      toast({
        title: "Vérification anti-spam échouée",
        description: "Merci de recharger la page et réessayer.",
        variant: "destructive",
      });
      return;
    }
    const { error } = await supabase.functions.invoke("send-contact-email", {
      body: {
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || null,
        message: form.message.trim(),
        recaptchaToken,
      },
    });
    setSending(false);
    if (error) {
      const msg = (error as any)?.message ?? "";
      if (msg.includes("recaptcha") || msg.includes("captcha")) {
        toast({
          title: "Vérification anti-spam refusée",
          description: "Votre message a été identifié comme suspect. Merci de réessayer.",
          variant: "destructive",
        });
        return;
      }
      toast({
        title: "Échec de l'envoi",
        description: "Merci de réessayer ou de nous écrire directement à info@lejapon.ma.",
        variant: "destructive",
      });
      return;
    }
    setSent(true);
  };

  return (
    <div className="container-app py-16 md:py-28">
      <Seo
        title="Contact — lejapon.ma | Agence voyage Japon Casablanca & Témara"
        description="Contactez lejapon.ma (Moroccan Express Travel and Events) à Casablanca et Témara. Réponse sous 24h par email, téléphone ou formulaire."
        canonical="/contact"
      />
      <div className="grid lg:grid-cols-12 gap-12 lg:gap-16">
        <div className="lg:col-span-5">
          <p className="eyebrow mb-4">{c.eyebrow}</p>
          <h1 className="font-display text-4xl sm:text-5xl md:text-6xl mb-6 md:mb-8">
            {c.title_main} <span className="italic text-accent">{c.title_accent}</span>
          </h1>
          <p className="text-foreground/70 leading-relaxed mb-8 md:mb-10">
            {c.intro}
          </p>

          <div className="space-y-6">
            <div>
              <p className="eyebrow mb-3">Email</p>
              <a
                href={`mailto:${c.email}`}
                className="inline-flex items-center gap-3 text-base hover:text-accent transition-colors"
              >
                <Mail className="w-4 h-4 text-accent shrink-0" />
                {c.email}
              </a>
            </div>

            <div>
              <p className="eyebrow mb-3">Nos agences</p>
              <p className="font-display text-lg mb-4">{c.agency_name}</p>
              <ul className="space-y-4">
                {(c.addresses ?? []).map((a) => (
                  <li key={a.city} className="flex items-start gap-3 text-sm">
                    <MapPin className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                    <span>
                      <span className="block font-medium">{a.city}</span>
                      <span className="block text-foreground/70">{a.line}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        <div className="lg:col-span-7">
          {sent ? (
            <div className="bg-secondary p-8 sm:p-12 text-center">
              <div className="w-14 h-14 mx-auto mb-6 rounded-2xl bg-gradient-vermillion text-accent-foreground flex items-center justify-center font-bold text-xl shadow-cta">✓</div>
              <h2 className="font-display text-3xl mb-3">{c.success_title}</h2>
              <p className="text-foreground/70">{c.success_text}</p>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-5">
              <div className="grid sm:grid-cols-2 gap-4">
                <input
                  required
                  placeholder="Nom"
                  value={form.name}
                  onChange={onChange("name")}
                  maxLength={200}
                  className="bg-background border border-border px-4 py-3 focus:outline-none focus:border-accent"
                />
                <input
                  required
                  type="email"
                  placeholder="E-mail"
                  value={form.email}
                  onChange={onChange("email")}
                  maxLength={200}
                  className="bg-background border border-border px-4 py-3 focus:outline-none focus:border-accent"
                />
              </div>
              <input
                placeholder="Téléphone (optionnel)"
                value={form.phone}
                onChange={onChange("phone")}
                maxLength={50}
                className="w-full bg-background border border-border px-4 py-3 focus:outline-none focus:border-accent"
              />
              <textarea
                required
                placeholder="Votre message"
                rows={6}
                value={form.message}
                onChange={onChange("message")}
                maxLength={5000}
                className="w-full bg-background border border-border px-4 py-3 focus:outline-none focus:border-accent resize-none"
              />
              <button
                type="submit"
                disabled={sending || !captchaReady}
                className="inline-flex items-center gap-2 bg-foreground text-background px-8 py-3 hover:bg-accent transition-all disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {sending && <Loader2 className="w-4 h-4 animate-spin" />}
                {sending ? "Envoi…" : "Envoyer"}
              </button>
              <p className="text-xs text-foreground/50 mt-3">
                Ce site est protégé par reCAPTCHA — la{" "}
                <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" className="underline hover:text-accent">politique de confidentialité</a>
                {" "}et les{" "}
                <a href="https://policies.google.com/terms" target="_blank" rel="noopener noreferrer" className="underline hover:text-accent">conditions d'utilisation</a>
                {" "}de Google s'appliquent.
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
export default Contact;
