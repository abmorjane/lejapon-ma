import { useState, FormEvent } from "react";
import { motion } from "framer-motion";
import { Mail, Check, Loader2 } from "lucide-react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

const emailSchema = z.string().trim().email("Email invalide").max(255);

export const NewsletterSection = () => {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) {
      toast({ title: "Email invalide", description: parsed.error.issues[0].message, variant: "destructive" });
      return;
    }
    setLoading(true);
    const { error } = await supabase
      .from("newsletter_subscribers")
      .insert({ email: parsed.data, source: "homepage" });
    setLoading(false);

    if (error) {
      if (error.code === "23505") {
        setSuccess(true);
        toast({ title: "Déjà inscrit", description: "Cet email est déjà dans notre liste." });
      } else {
        toast({ title: "Erreur", description: "Impossible de vous inscrire pour le moment.", variant: "destructive" });
      }
      return;
    }
    setSuccess(true);
    setEmail("");
    toast({ title: "Merci !", description: "Vous êtes inscrit à notre newsletter." });
  };

  return (
    <section className="container-app pb-24 md:pb-32">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5 }}
        className="relative overflow-hidden rounded-3xl border border-border bg-card px-6 py-14 md:px-16 md:py-20 text-center"
      >
        <div className="absolute inset-0 bg-gradient-to-br from-accent/5 via-transparent to-primary/5 pointer-events-none" />
        <div className="relative max-w-xl mx-auto">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-accent/10 text-accent mb-5">
            <Mail className="w-5 h-5" />
          </div>
          <h2 className="font-display text-3xl md:text-5xl text-foreground leading-tight">
            Rejoignez notre newsletter
          </h2>
          <p className="mt-4 text-muted-foreground text-base md:text-lg">
            Recevez nos nouveautés et nos meilleures offres en instantané.
          </p>

          <form onSubmit={onSubmit} className="mt-8 flex flex-col sm:flex-row gap-3 max-w-md mx-auto">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="vous@email.com"
              className="flex-1 h-12 px-4 rounded-full border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition"
              disabled={loading || success}
              maxLength={255}
            />
            <button
              type="submit"
              disabled={loading || success}
              className="btn-primary h-12 px-6 justify-center disabled:opacity-70"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : success ? (
                <><Check className="w-4 h-4" /> Inscrit</>
              ) : (
                "S'inscrire"
              )}
            </button>
          </form>

          <p className="mt-4 text-xs text-muted-foreground">
            Pas de spam. Désinscription en 1 clic.
          </p>
        </div>
      </motion.div>
    </section>
  );
};

export default NewsletterSection;