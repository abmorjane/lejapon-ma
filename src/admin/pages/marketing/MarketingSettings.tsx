import { Card } from "@/components/ui/card";

export default function MarketingSettings() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Paramètres emailing</h1>
        <p className="text-sm text-muted-foreground">Configuration SMTP et coordonnées de l'expéditeur</p>
      </div>
      <Card className="p-6">
        <p className="text-sm text-muted-foreground">
          La configuration SMTP (host, port, identifiants, expéditeur, adresse société)
          sera gérée ici. Connectez votre fournisseur d'envoi (SMTP custom, Brevo, Resend ou Mailgun)
          dans une prochaine étape.
        </p>
      </Card>
    </div>
  );
}