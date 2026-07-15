import { FormEvent, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { LogIn, ShieldCheck, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { Seo } from "@/components/Seo";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { CLIENT_PORTAL_CANONICAL_PATH, clientPortalUrl } from "../lib/auth-urls";
import logo from "@/assets/logo-lejapon.png";

export default function ClientLogin() {
  const { user, loading, signIn, signUp } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const target = (location.state as any)?.from || CLIENT_PORTAL_CANONICAL_PATH;

  useEffect(() => {
    if (!loading && user) navigate(target, { replace: true });
  }, [loading, user, navigate, target]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const cleanEmail = email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) throw new Error("Adresse email invalide.");
      if (password.length < 6) throw new Error("Le mot de passe doit contenir au moins 6 caractères.");

      if (mode === "login") {
        const { error } = await signIn(cleanEmail, password);
        if (error) throw error;
        toast.success("Bienvenue dans votre espace voyage.");
        navigate(target, { replace: true });
      } else {
        if (!fullName.trim()) throw new Error("Nom complet obligatoire.");
        const { error } = await signUp(
          cleanEmail,
          password,
          fullName.trim(),
          { full_name: fullName.trim(), portal: "client" },
          clientPortalUrl(),
        );
        if (error) throw error;
        toast.success("Compte créé. Vérifiez votre email si une confirmation est demandée.");
        setMode("login");
      }
    } catch (error: any) {
      toast.error(error?.message ?? "Connexion impossible.");
    } finally {
      setBusy(false);
    }
  };

  const sendPasswordReset = async () => {
    const cleanEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      toast.error("Indiquez d'abord l'email utilisé lors de votre réservation.");
      return;
    }
    setResetBusy(true);
    try {
      const { error } = await supabase.functions.invoke("client-password-recovery", {
        body: { email: cleanEmail },
      });
      void error;
      toast.success("Si un compte existe avec cette adresse, un email vous sera envoyé.");
    } catch {
      toast.success("Si un compte existe avec cette adresse, un email vous sera envoyé.");
    } finally {
      setResetBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#f8fafc] px-4 py-8">
      <Seo title="Espace client — Mon voyage LeJapon.ma" description="Connectez-vous à votre espace voyage LeJapon.ma pour suivre votre réservation, vos documents et vos prochaines étapes." noindex />
      <div className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-5xl items-center gap-8 lg:grid-cols-[1fr_420px]">
        <section className="max-w-2xl">
          <Link to="/" className="mb-10 inline-flex items-center gap-3">
            <img src={logo} alt="LeJapon.ma" className="h-10 w-auto" />
            <span className="text-sm font-medium text-muted-foreground">/ Mon voyage</span>
          </Link>
          <p className="mb-4 inline-flex rounded-full bg-red-50 px-3 py-1 text-sm font-medium text-red-700">
            Espace sécurisé voyageurs
          </p>
          <h1 className="font-display text-4xl leading-tight sm:text-5xl">Retrouvez votre voyage, vos documents et vos prochaines étapes.</h1>
          <p className="mt-5 max-w-xl text-lg leading-8 text-muted-foreground">
            Connectez-vous avec l’email utilisé lors de votre réservation. Vous verrez uniquement les dossiers liés à votre adresse email.
          </p>
          <div className="mt-8 grid gap-3 text-sm text-muted-foreground sm:grid-cols-3">
            <div className="rounded-xl border bg-white p-4"><ShieldCheck className="mb-2 h-5 w-5 text-red-600" /> Réservations</div>
            <div className="rounded-xl border bg-white p-4"><ShieldCheck className="mb-2 h-5 w-5 text-red-600" /> Documents</div>
            <div className="rounded-xl border bg-white p-4"><ShieldCheck className="mb-2 h-5 w-5 text-red-600" /> Visa & accords</div>
          </div>
        </section>

        <Card className="rounded-2xl shadow-sm">
          <CardContent className="p-6">
            <div className="mb-6 flex rounded-lg bg-muted p-1">
              <button
                type="button"
                onClick={() => setMode("login")}
                className={`min-h-10 flex-1 rounded-md text-sm font-medium ${mode === "login" ? "bg-white shadow-sm" : "text-muted-foreground"}`}
              >
                Se connecter
              </button>
              <button
                type="button"
                onClick={() => setMode("signup")}
                className={`min-h-10 flex-1 rounded-md text-sm font-medium ${mode === "signup" ? "bg-white shadow-sm" : "text-muted-foreground"}`}
              >
                Créer un compte
              </button>
            </div>
            <form className="space-y-4" onSubmit={submit}>
              {mode === "signup" && (
                <div className="space-y-2">
                  <Label>Nom complet</Label>
                  <Input value={fullName} onChange={(event) => setFullName(event.target.value)} autoComplete="name" />
                </div>
              )}
              <div className="space-y-2">
                <Label>Email</Label>
                <Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
              </div>
              <div className="space-y-2">
                <Label>Mot de passe</Label>
                <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} />
              </div>
              <Button className="min-h-11 w-full" disabled={busy}>
                {mode === "login" ? <LogIn className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
                {busy ? "Veuillez patienter…" : mode === "login" ? "Accéder à mon voyage" : "Créer mon espace"}
              </Button>
            </form>
            <div className="mt-4 rounded-lg border border-orange-100 bg-orange-50/70 p-3 text-sm text-orange-900">
              <p className="font-medium">Connectez-vous avec l’email utilisé lors de votre réservation.</p>
              <button
                type="button"
                onClick={sendPasswordReset}
                disabled={resetBusy || busy}
                className="mt-2 font-semibold underline underline-offset-4 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {resetBusy ? "Envoi en cours…" : "Créer mon mot de passe"}
              </button>
              <p className="mt-1 text-xs text-orange-800">
                Nouveau voyageur ? Ce lien vous permet de créer votre mot de passe.
              </p>
              <button
                type="button"
                onClick={sendPasswordReset}
                disabled={resetBusy || busy}
                className="mt-2 text-xs font-medium underline underline-offset-4 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Mot de passe oublié ? Créer ou réinitialiser mon mot de passe
              </button>
            </div>
            <p className="mt-4 text-center text-xs text-muted-foreground">
              Vous avez déjà créé un compte visa ? Utilisez les mêmes identifiants.
            </p>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
