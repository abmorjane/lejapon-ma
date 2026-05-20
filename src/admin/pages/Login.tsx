import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useRecaptcha } from "@/hooks/useRecaptcha";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import logo from "@/assets/logo-lejapon.png";

export default function AdminLogin() {
  const { user, signIn, signUp, loading } = useAuth();
  const nav = useNavigate();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const { executeRecaptcha, verify: verifyRecaptcha, enabled: recaptchaEnabled } = useRecaptcha();

  useEffect(() => { if (!loading && user) nav("/admin", { replace: true }); }, [user, loading, nav]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const action = mode === "login" ? "login" : "signup";
      let token = "";
      try { token = await executeRecaptcha(action); }
      catch { throw new Error("Vérification anti-spam indisponible. Rechargez la page."); }
      const check = await verifyRecaptcha(token, action);
      if (!check.ok) throw new Error("Vérification anti-spam refusée. Merci de réessayer.");

      if (mode === "login") {
        const { error } = await signIn(email, password);
        if (error) throw error;
        toast.success("Connecté");
        nav("/admin", { replace: true });
      } else {
        const { error } = await signUp(email, password, fullName);
        if (error) throw error;
        toast.success("Compte créé. Un admin doit vous attribuer un rôle.");
      }
    } catch (e: any) {
      toast.error(e.message ?? "Erreur");
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-secondary/40 p-6">
      <div className="w-full max-w-md bg-background rounded-3xl shadow-card border border-border p-8">
        <Link to="/" className="flex items-center justify-center mb-8">
          <img src={logo} alt="lejapon.ma" className="h-10 w-auto" />
        </Link>
        <h1 className="font-display text-2xl text-center mb-2">Espace administration</h1>
        <p className="text-sm text-muted-foreground text-center mb-8">
          {mode === "login" ? "Connectez-vous pour accéder au back-office" : "Créez un compte (un admin validera l'accès)"}
        </p>
        <form onSubmit={submit} className="space-y-4">
          {mode === "signup" && (
            <div>
              <Label htmlFor="name">Nom complet</Label>
              <Input id="name" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </div>
          )}
          <div>
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="password">Mot de passe</Label>
            <Input id="password" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "…" : mode === "login" ? "Se connecter" : "Créer le compte"}
          </Button>
        </form>
        {recaptchaEnabled && (
          <p className="text-[11px] text-muted-foreground text-center mt-4 leading-relaxed">
            Protégé par reCAPTCHA — la{" "}
            <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" className="underline">politique</a>
            {" "}et les{" "}
            <a href="https://policies.google.com/terms" target="_blank" rel="noopener noreferrer" className="underline">conditions</a>
            {" "}de Google s'appliquent.
          </p>
        )}
        <p className="text-center text-sm mt-6">
          {mode === "login" ? (
            <>Pas encore de compte ? <button onClick={() => setMode("signup")} className="text-accent font-medium">Créer</button></>
          ) : (
            <>Déjà inscrit ? <button onClick={() => setMode("login")} className="text-accent font-medium">Se connecter</button></>
          )}
        </p>
      </div>
    </div>
  );
}
