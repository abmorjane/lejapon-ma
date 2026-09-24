import { supplierErrorMessage, SupplierLanguageSelector, useSupplierTranslation } from "@/i18n/supplier/SupplierLanguageProvider";
import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { portalHomeForRoles } from "@/admin/lib/portal-access";
import { useRecaptcha } from "@/hooks/useRecaptcha";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import logo from "@/assets/logo-lejapon.png";
import { evaluateAdminRecaptcha } from "@/admin/lib/admin-login-recaptcha";
import { isStandalonePwa } from "@/lib/pwa-display-mode";

export default function AdminLogin() {
  const { t, language } = useSupplierTranslation();
  const { user, roles, signIn, signUp, loading } = useAuth();
  const nav = useNavigate();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const {
    executeRecaptcha,
    verify: verifyRecaptcha,
    enabled: recaptchaEnabled,
    error: recaptchaError,
  } = useRecaptcha();

  useEffect(() => {
    if (!loading && user) nav(portalHomeForRoles(roles), { replace: true });
  }, [user, roles, loading, nav]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const captchaGate = await evaluateAdminRecaptcha({
        mode,
        enabled: recaptchaEnabled,
        initializationError: recaptchaError,
        execute: executeRecaptcha,
        verify: verifyRecaptcha,
      });
      if (!captchaGate.allowed) {
        throw new Error(captchaGate.technicalUnavailable
          ? t("Configuration reCAPTCHA indisponible. Réessayez dans quelques instants.")
          : t("Vérification anti-spam refusée. Veuillez réessayer."));
      }
      if (mode === "login" && captchaGate.technicalUnavailable) {
        console.warn("[admin-login] recaptcha unavailable, continuing password login", {
          reason: captchaGate.reason,
          standalone: isStandalonePwa(),
        });
      }

      if (mode === "login") {
        const { error } = await signIn(email, password);
        if (error) throw error;
        toast.success(t("Connecté"));
      } else {
        const { error } = await signUp(email, password, fullName, language === "fr" ? {} : { supplier_language: language });
        if (error) throw error;
        toast.success(t("Compte créé. Un admin doit vous attribuer un rôle."));
      }
    } catch (e: any) {
      toast.error(supplierErrorMessage(t, e.message ?? t("Erreur")));
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-secondary/40 p-6">
      <div className="w-full max-w-md bg-background rounded-3xl shadow-card border border-border p-8">
        <Link to="/" className="flex items-center justify-center mb-8">
          <img src={logo} alt="lejapon.ma" className="h-10 w-auto" />
        </Link>
        {language !== "fr" && <div className="mb-4 flex justify-end"><SupplierLanguageSelector /></div>}
        <h1 className="font-display text-2xl text-center mb-2">{language === "fr" ? t("Espace administration") : t("Japan Office sign-in")}</h1>
        <p className="text-sm text-muted-foreground text-center mb-8">
          {mode === "login" ? t("Connectez-vous pour accéder au back-office") : t("Créez un compte (un admin validera l'accès)")}
        </p>
        <form onSubmit={submit} className="space-y-4">
          {mode === "signup" && (
            <div>
              <Label htmlFor="name">{t("Nom complet")}</Label>
              <Input id="name" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </div>
          )}
          <div>
            <Label htmlFor="email">{t("Email")}</Label>
            <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="password">{t("Mot de passe")}</Label>
            <Input id="password" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "…" : mode === "login" ? t("Se connecter") : t("Créer le compte")}
          </Button>
        </form>
        {mode === "login" && (
          <p className="mt-3 text-center text-sm">
            <Link to="/admin/mot-de-passe-oublie" className="font-medium text-accent underline underline-offset-4"> {t("Mot de passe oublié ?")} </Link>
          </p>
        )}
        {recaptchaEnabled && (
          <p className="text-[11px] text-muted-foreground text-center mt-4 leading-relaxed"> {t("Protégé par reCAPTCHA — la")}{" "}
            <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" className="underline">{t("politique")}</a>
            {" "}{t("et les")}{" "}
            <a href="https://policies.google.com/terms" target="_blank" rel="noopener noreferrer" className="underline">{t("conditions")}</a>
            {" "}{t("de Google s'appliquent.")} </p>
        )}
        <p className="text-center text-sm mt-6">
          {mode === "login" ? (
            <>{t("Pas encore de compte ?")} <button onClick={() => setMode("signup")} className="text-accent font-medium">{t("Créer")}</button></>
          ) : (
            <>{t("Déjà inscrit ?")} <button onClick={() => setMode("login")} className="text-accent font-medium">{t("Se connecter")}</button></>
          )}
        </p>
      </div>
    </div>
  );
}
