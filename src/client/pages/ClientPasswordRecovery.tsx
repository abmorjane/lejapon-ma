import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
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
import { CLIENT_LOGIN_CANONICAL_PATH, CLIENT_PORTAL_CANONICAL_PATH } from "../lib/auth-urls";

type RecoveryState = "checking" | "ready" | "invalid" | "success";

const recoveryUrlParams = () => {
  if (typeof window === "undefined") return false;
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const search = new URLSearchParams(window.location.search);
  const tokenHash = search.get("token_hash") || hash.get("token_hash");
  const type = search.get("type") || hash.get("type");
  return {
    tokenHash,
    type,
    hasLegacySessionHint: type === "recovery" || Boolean(hash.get("access_token") || search.get("code")),
  };
};

export default function ClientPasswordRecovery() {
  const navigate = useNavigate();
  const [initialRecoveryParams] = useState(() => recoveryUrlParams());
  const [state, setState] = useState<RecoveryState>("checking");
  const [email, setEmail] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);

  const passwordLongEnough = password.length >= 8;
  const passwordsMatch = password.length > 0 && password === confirmation;
  const canSubmit = useMemo(() => passwordLongEnough && passwordsMatch, [passwordLongEnough, passwordsMatch]);

  useEffect(() => {
    let settled = false;

    const verifyTokenHash = async () => {
      if (!initialRecoveryParams || !initialRecoveryParams.tokenHash || initialRecoveryParams.type !== "recovery") {
        return false;
      }

      const { data, error } = await supabase.auth.verifyOtp({
        token_hash: initialRecoveryParams.tokenHash,
        type: "recovery",
      });
      settled = true;
      if (error) {
        setState("invalid");
        return true;
      }
      setEmail(data.session?.user?.email ?? data.user?.email ?? null);
      setState("ready");
      if (typeof window !== "undefined") {
        window.history.replaceState({}, document.title, "/espace-voyage/nouveau-mot-de-passe");
      }
      return true;
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        settled = true;
        setEmail(session?.user?.email ?? null);
        setState("ready");
      }
    });

    void verifyTokenHash();

    const timer = window.setTimeout(async () => {
      if (settled) return;
      const { data } = await supabase.auth.getSession();
      if (data.session && initialRecoveryParams && initialRecoveryParams.hasLegacySessionHint) {
        setEmail(data.session.user.email ?? null);
        setState("ready");
        return;
      }
      setState("invalid");
    }, 700);

    return () => {
      window.clearTimeout(timer);
      subscription.unsubscribe();
    };
  }, [initialRecoveryParams]);

  const submit = async (event: FormEvent) => {
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
      toast.success("Votre mot de passe a bien été créé.");
      window.setTimeout(() => navigate(CLIENT_PORTAL_CANONICAL_PATH, { replace: true }), 1200);
    } catch (error: any) {
      toast.error(error?.message ?? "Impossible d'enregistrer le nouveau mot de passe.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#f8fafc] px-4 py-8">
      <Seo
        title="Créer mon mot de passe — Espace voyage LeJapon.ma"
        description="Créez ou réinitialisez le mot de passe de votre espace voyage LeJapon.ma."
        canonical="/espace-voyage/nouveau-mot-de-passe"
        noindex
      />
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-lg items-center">
        <Card className="w-full rounded-2xl shadow-sm">
          <CardContent className="p-6 sm:p-8">
            <Link to="/" className="mb-8 flex items-center justify-center gap-3">
              <img src={logo} alt="LeJapon.ma" className="h-10 w-auto" />
            </Link>

            <div className="mb-6 text-center">
              <p className="mx-auto mb-3 inline-flex rounded-full bg-red-50 px-3 py-1 text-sm font-medium text-red-700">
                Espace sécurisé voyageurs
              </p>
              <h1 className="font-display text-3xl leading-tight">Créer mon mot de passe</h1>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                Utilisez cette page uniquement depuis le lien reçu par email. Vous resterez dans l'environnement LeJapon.ma.
              </p>
            </div>

            {state === "checking" && (
              <div className="flex min-h-40 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin text-red-600" />
                Vérification du lien sécurisé…
              </div>
            )}

            {state === "invalid" && (
              <div className="space-y-4">
                <Alert variant="destructive">
                  <ShieldAlert className="h-4 w-4" />
                  <AlertTitle>Lien invalide ou expiré</AlertTitle>
                  <AlertDescription>
                    Le lien de création de mot de passe n'est plus valide. Demandez un nouveau lien depuis la page de connexion.
                  </AlertDescription>
                </Alert>
                <Button asChild className="min-h-11 w-full">
                  <Link to={CLIENT_LOGIN_CANONICAL_PATH}>Recevoir un nouveau lien</Link>
                </Button>
              </div>
            )}

            {state === "ready" && (
              <form className="space-y-4" onSubmit={submit}>
                {email && (
                  <Alert>
                    <KeyRound className="h-4 w-4" />
                    <AlertTitle>Email vérifié</AlertTitle>
                    <AlertDescription>{email}</AlertDescription>
                  </Alert>
                )}
                <div className="space-y-2">
                  <Label htmlFor="client_new_password">Nouveau mot de passe</Label>
                  <div className="relative">
                    <Input
                      id="client_new_password"
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
                  <p className={passwordLongEnough ? "text-xs text-green-700" : "text-xs text-muted-foreground"}>
                    Minimum 8 caractères.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="client_new_password_confirm">Confirmer le mot de passe</Label>
                  <div className="relative">
                    <Input
                      id="client_new_password_confirm"
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      minLength={8}
                      value={confirmation}
                      onChange={(event) => setConfirmation(event.target.value)}
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
                  {confirmation && (
                    <p className={passwordsMatch ? "text-xs text-green-700" : "text-xs text-red-700"}>
                      {passwordsMatch ? "Les mots de passe correspondent." : "Les mots de passe ne correspondent pas."}
                    </p>
                  )}
                </div>
                <Button className="min-h-11 w-full" disabled={busy || !canSubmit}>
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                  Enregistrer mon mot de passe
                </Button>
                <p className="text-center text-xs text-muted-foreground">
                  Après validation, vous serez redirigé vers votre espace voyage.
                </p>
              </form>
            )}

            {state === "success" && (
              <div className="space-y-4 text-center">
                <CheckCircle2 className="mx-auto h-10 w-10 text-green-600" />
                <div>
                  <h2 className="font-display text-2xl">Votre mot de passe a bien été créé.</h2>
                  <p className="mt-2 text-sm text-muted-foreground">Redirection vers votre espace voyage…</p>
                </div>
                <Button asChild variant="outline" className="min-h-11 w-full">
                  <Link to={CLIENT_PORTAL_CANONICAL_PATH}>Accéder à mon espace voyage</Link>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
