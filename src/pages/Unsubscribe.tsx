import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";

export default function Unsubscribe() {
  const { token } = useParams();
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    (async () => {
      if (!token) { setState("error"); setMessage("Lien invalide"); return; }
      const { data, error } = await supabase.rpc("unsubscribe_marketing_by_token", { _token: token });
      if (error || !data) { setState("error"); setMessage(error?.message ?? "Lien expiré ou invalide"); }
      else { setState("ok"); setMessage("Vous avez été désinscrit de notre liste de diffusion."); }
    })();
  }, [token]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <Card className="max-w-md w-full p-8 text-center space-y-4">
        {state === "loading" && <Loader2 className="w-10 h-10 mx-auto animate-spin text-muted-foreground" />}
        {state === "ok" && <CheckCircle2 className="w-10 h-10 mx-auto text-green-600" />}
        {state === "error" && <XCircle className="w-10 h-10 mx-auto text-destructive" />}
        <h1 className="text-xl font-semibold">
          {state === "loading" ? "Traitement…" : state === "ok" ? "Désinscription confirmée" : "Erreur"}
        </h1>
        <p className="text-muted-foreground">{message}</p>
      </Card>
    </div>
  );
}