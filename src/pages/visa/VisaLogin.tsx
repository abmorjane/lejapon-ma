import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Seo } from "@/components/Seo";
import { useRouteSlugs, pathFor } from "@/hooks/useRouteSlugs";

export default function VisaLogin() {
  const { user, signIn, signUp, loading } = useAuth();
  const nav = useNavigate();
  const slugs = useRouteSlugs();
  const visaBase = pathFor(slugs, "visa");
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [passportNo, setPassportNo] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (!loading && user) nav(visaBase, { replace: true }); }, [user, loading, nav, visaBase]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "login") {
        const { error } = await signIn(email, password);
        if (error) throw error;
        toast.success("Connecté");
        nav(visaBase, { replace: true });
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
        if (password.length < 6) {
          throw new Error("Le mot de passe doit contenir au moins 6 caractères.");
        }

        const { error } = await signUp(cleanEmail, password, `${cleanFirstName} ${cleanLastName}`, {
          first_name: cleanFirstName,
          last_name: cleanLastName,
          passport_no: cleanPassportNo || null,
          visa_prefill_requested: Boolean(cleanPassportNo),
        });
        if (error) throw error;
        toast.success(cleanPassportNo
          ? "Compte créé. Si une fiche passeport sûre est trouvée, le formulaire sera prérempli."
          : "Compte créé. Vérifiez votre email."
        );
      }
    } catch (e: any) { toast.error(e.message ?? "Erreur"); } finally { setBusy(false); }
  };

  return (
    <div className="container-app py-16 max-w-md">
      <Seo title="Connexion espace visa — lejapon.ma" description="Connectez-vous pour préparer votre demande de visa Japon en ligne." canonical={`${visaBase}/login`} />
      <Card className="p-8">
        <h1 className="font-display text-2xl text-center mb-2">Espace visa Japon</h1>
        <p className="text-sm text-muted-foreground text-center mb-6">
          {mode === "login" ? "Connectez-vous pour accéder à vos demandes." : "Créez votre compte pour commencer."}
        </p>
        <form onSubmit={submit} className="space-y-4">
          {mode === "signup" && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
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
            <Input id="password" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "…" : mode === "login" ? "Se connecter" : "Créer le compte"}
          </Button>
        </form>
        <p className="text-center text-sm mt-6">
          {mode === "login" ? (
            <>Pas encore de compte ? <button onClick={() => setMode("signup")} className="text-accent font-medium">Créer</button></>
          ) : (
            <>Déjà inscrit ? <button onClick={() => setMode("login")} className="text-accent font-medium">Se connecter</button></>
          )}
        </p>
        <p className="text-center text-xs text-muted-foreground mt-6">
          <Link to="/" className="hover:text-accent">← Retour à l'accueil</Link>
        </p>
      </Card>
    </div>
  );
}
