import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { CheckCircle2, Eye, EyeOff, KeyRound, Loader2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Seo } from "@/components/Seo";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import logo from "@/assets/logo-lejapon.png";

type RecoveryState = "checking" | "ready" | "invalid" | "success";

const ADMIN_LOGIN_PATH = "/admin/login";
const ADMIN_RESET_PATH = "/admin/nouveau-mot-de-passe";

function recoveryUrlParams() {
  if (typeof window === "undefined") return { tokenHash: null, type: null };
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const search = new URLSearchParams(window.location.search);
  return {
    tokenHash: search.get("token_hash") || hash.get("token_hash"),
    type: search.get("type") || hash.get("type"),
  };
}

export default function AdminPasswordRecovery() {
  const location = useLocation();
  const navigate = useNavigate();
  const isResetPage = location.pathname.includes("nouveau-mot-de-passe");
  const [email, setEmail] = useState("");
  const [requestBusy, setRequestBusy] = useState(false);
  const [initialRecoveryParams] = useState(() => recoveryUrlParams());
  const [state, setState] = useState<RecoveryState>(isResetPage ? "checking" : "ready");
  const [verifiedEmail, setVerifiedEmail] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);

  const passwordLongEnough = password.length >= 8;
  const passwordsMatch = password.length > 0 && password === confirmation;
  const canSubmit = useMemo(() => passwordLongEnough && passwordsMatch, [passwordLongEnough, passwordsMatch]);

  useEffect(() => {
    if (!isResetPage) return;
    let cancelled = false;

    const verifyToken = async () => {
      if (!initialRecoveryParams.tokenHash || initialRecoveryParams.type !== "recovery") {
        setState("invalid");
        return;
      }

      const { data, error } = await supabase.auth.verifyOtp({
        token_hash: initialRecoveryParams.tokenHash,
        type: "recovery",
      });
      if (cancelled) return;
      if (error) {
        setState("invalid");
        return;
      }
      setVerifiedEmail(data.session?.user?.email ?? data.user?.email ?? null);
      setState("ready");
      window.history.replaceState({}, document.title, ADMIN_RESET_PATH);
    };

    void verifyToken();
    return () => {
      cancelled = true;
    };
  }, [initialRecoveryParams, isResetPage]);

  const requestLink = async (event: FormEvent) => {
    event.preventDefault();
    const cleanEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      toast.error("Adresse email invalide.");
      return;
    }

    setRequestBusy(true);
    try {
      await supabase.functions.invoke("admin-password-recovery", { body: { email: cleanEmail } });
      toast.success("Si un compte admin existe avec cette adresse, un email vous sera envoyé.");
    } catch {
      toast.success("Si un compte admin existe avec cette adresse, un email vous sera envoyé.");
    } finally {
      setRequestBusy(false);
    }
  };

  const submitPassword = async (event: FormEvent) => {
    event.preventDefault();
    if (password.length < 8) {
      toast.error("Le mot de passe doit contenir au moins 8 caractères.");
      return;
    }
    if (password !== confirmation) {
      toast.error("Les deux mots de passe ne correspondent pas.");
      return;
    }

    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setState("success");
      toast.success("Votre mot de passe admin a bien été mis à jour.");
      window.setTimeout(() => navigate(ADMIN_LOGIN_PATH, { replace: true }), 1200);
    } catch (error: any) {
      toast.error(error?.message ?? "Impossible d'enregistrer le nouveau mot de passe.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-secondary/40 px-4 py-8">
      <Seo title="Mot de passe admin — LeJapon.ma" description="Récupération sécurisée du mot de passe administrateur LeJapon.ma." noindex />
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-lg items-center">
        <Card className="w-full rounded-3xl shadow-card">
          <CardContent className="p-6 sm:p-8">
            <Link to="/" className="mb-8 flex items-center justify-center">
              <img src={logo} alt="LeJapon.ma" className="h-10 w-auto" />
            </Link>

            <div className="mb-6 text-center">
              <p className="mx-auto mb-3 inline-flex rounded-full bg-red-50 px-3 py-1 text-sm font-medium text-red-700">
                Administration sécurisée
              </p>
              <h1 className="font-display text-3xl leading-tight">
                {isResetPage ? "Nouveau mot de passe admin" : "Mot de passe oublié"}
              </h1>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                {isResetPage
                  ? "Créez un nouveau mot de passe pour votre compte administrateur."
                  : "Entrez votre email administrateur. Si le compte existe, vous recevrez un lien sécurisé LeJapon.ma."}
              </p>
            </div>

            {!isResetPage && (
              <form className="space-y-4" onSubmit={requestLink}>
                <div className="space-y-2">
                  <Label htmlFor="admin_recovery_email">Email administrateur</Label>
                  <Input id="admin_recovery_email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
                </div>
                <Button className="min-h-11 w-full" disabled={requestBusy}>
                  {requestBusy && <Loader2 className="h-4 w-4 animate-spin" />}
                  Recevoir un lien sécurisé
                </Button>
                <Button asChild variant="outline" className="min-h-11 w-full">
                  <Link to={ADMIN_LOGIN_PATH}>Retour à la connexion</Link>
                </Button>
              </form>
            )}

            {isResetPage && state === "checking" && (
              <div className="flex min-h-40 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin text-red-600" />
                Vérification du lien sécurisé…
              </div>
            )}

            {isResetPage && state === "invalid" && (
              <div className="space-y-4">
                <Alert variant="destructive">
                  <ShieldAlert className="h-4 w-4" />
                  <AlertTitle>Lien invalide ou expiré</AlertTitle>
                  <AlertDescription>Demandez un nouveau lien de récupération admin.</AlertDescription>
                </Alert>
                <Button asChild className="min-h-11 w-full">
                  <Link to="/admin/mot-de-passe-oublie">Recevoir un nouveau lien</Link>
                </Button>
              </div>
            )}

            {isResetPage && state === "ready" && (
              <form className="space-y-4" onSubmit={submitPassword}>
                {verifiedEmail && (
                  <Alert>
                    <KeyRound className="h-4 w-4" />
                    <AlertTitle>Email vérifié</AlertTitle>
                    <AlertDescription>{verifiedEmail}</AlertDescription>
                  </Alert>
                )}
                <div className="space-y-2">
                  <Label htmlFor="admin_new_password">Nouveau mot de passe</Label>
                  <div className="relative">
                    <Input
                      id="admin_new_password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      minLength={8}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      className="pr-11"
                    />
                    <button
                      type="button"
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      onClick={() => setShowPassword((current) => !current)}
                      aria-label={showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <p className={passwordLongEnough ? "text-xs text-green-700" : "text-xs text-muted-foreground"}>Minimum 8 caractères.</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="admin_new_password_confirm">Confirmer le mot de passe</Label>
                  <Input
                    id="admin_new_password_confirm"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    minLength={8}
                    value={confirmation}
                    onChange={(event) => setConfirmation(event.target.value)}
                  />
                  {confirmation && (
                    <p className={passwordsMatch ? "text-xs text-green-700" : "text-xs text-red-700"}>
                      {passwordsMatch ? "Les mots de passe correspondent." : "Les mots de passe ne correspondent pas."}
                    </p>
                  )}
                </div>
                <Button className="min-h-11 w-full" disabled={busy || !canSubmit}>
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                  Enregistrer le mot de passe
                </Button>
              </form>
            )}

            {isResetPage && state === "success" && (
              <div className="space-y-4 text-center">
                <CheckCircle2 className="mx-auto h-10 w-10 text-green-600" />
                <h2 className="font-display text-2xl">Mot de passe mis à jour.</h2>
                <p className="text-sm text-muted-foreground">Redirection vers la connexion admin…</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
