# Notifications email internes

Les alertes internes sont envoyées à l'équipe, sans remplacer les emails automatiques destinés aux clients.

## Destinataire

Par défaut :

```text
ADMIN_NOTIFICATION_EMAIL=info@lejapon.ma
```

## Variables Supabase Edge Functions

La fonction `send-admin-notification` lit d'abord la configuration active dans `public.email_settings` (Admin > Paramètres email). Les secrets Edge Function restent un fallback seulement si aucun réglage actif n'existe.

Champs utilisés depuis `email_settings` :

```text
smtp_host
smtp_port
smtp_secure
smtp_username
smtp_password
from_email
from_name
reply_to
is_active
```

Fallback secrets côté Supabase :

```text
SMTP_HOST=
SMTP_PORT=465
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
ADMIN_NOTIFICATION_EMAIL=info@lejapon.ma
```

Optionnel pour générer les liens directs vers l'admin :

```text
ADMIN_BASE_URL=https://lejapon.ma
```

## Événements couverts

- `booking_created` : nouvelle inscription voyage depuis le formulaire public.
- `payment_recorded` : paiement ajouté ou validé depuis l'admin.
- `contact_message` : nouveau message depuis le formulaire de contact.

Le formulaire public `/contact` appelle désormais `send-admin-notification` avec le contrat Lovable/Supabase :

```ts
supabase.functions.invoke("send-admin-notification", {
  body: {
    type: "contact",
    payload: {
      name,
      email,
      phone,
      message,
      created_at,
    },
  },
});
```

## Logs

Chaque tentative est enregistrée dans `public.email_logs` :

- type d'événement
- destinataire
- sujet
- statut `pending`, `sent` ou `failed`
- message d'erreur si échec
- date de création
- date d'envoi si succès
- liens techniques vers réservation, paiement ou message contact

L'ancien historique `public.admin_email_logs` est migré vers `public.email_logs`.

## Debug admin

L'écran `Admin > Email Logs` affiche les dernières tentatives, les erreurs SMTP, un bouton `Resend` et un bouton `Send test email`.

Les erreurs d'alerte interne ne bloquent jamais la réservation, l'enregistrement du paiement ou la soumission du formulaire contact.

## Déploiement

Vérifier en production :

- réglage actif dans `public.email_settings`
- `smtp_host` non vide, sans `https://` ni chemin
- `smtp_username` en minuscule
- `from_email=info@lejapon.ma`
- secrets Supabase Edge Functions configurés uniquement si aucun réglage admin actif n'existe
- fonction `send-admin-notification` déployée
- expéditeur `SMTP_FROM` autorisé par le serveur SMTP
- SPF/DKIM recommandés pour améliorer la délivrabilité
