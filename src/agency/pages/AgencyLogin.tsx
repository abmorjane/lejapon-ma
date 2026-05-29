import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import logo from "@/assets/logo-lejapon.png";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export default function AgencyLogin() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && user) navigate("/agency", { replace: true });
  }, [loading, navigate, user]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) {
      toast.error(error.message ?? "Connexion impossible.");
      return;
    }
    toast.success("Connecté à l'espace partenaire.");
    navigate("/agency", { replace: true });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-secondary/40 p-6">
      <div className="w-full max-w-md rounded-3xl border border-border bg-background p-8 shadow-card">
        <Link to="/" className="mb-8 flex justify-center">
          <img src={logo} alt="LeJapon.ma" className="h-10 w-auto" />
        </Link>
        <h1 className="text-center font-display text-2xl">Espace partenaire</h1>
        <p className="mb-8 mt-2 text-center text-sm text-muted-foreground">
          Connectez-vous avec le compte fourni par LeJapon.ma.
        </p>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="agency_email">Email</Label>
            <Input id="agency_email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="agency_password">Mot de passe</Label>
            <Input id="agency_password" type="password" required value={password} onChange={(event) => setPassword(event.target.value)} />
          </div>
          <Button type="submit" className="min-h-11 w-full" disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Se connecter
          </Button>
        </form>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          Pas encore partenaire ? <Link to="/devenir-partenaire" className="font-medium text-accent">Faire une demande</Link>
        </p>
      </div>
    </div>
  );
}
