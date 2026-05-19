# Notifications email internes

Les alertes internes sont envoyées à l'équipe, sans remplacer les emails automatiques destinés aux clients.

## Destinataire

Par défaut :

```text
ADMIN_NOTIFICATION_EMAIL=info@lejapon.ma
```

## Variables Supabase Edge Functions

Configurer les secrets côté Supabase, jamais côté frontend :

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

## Logs

Chaque tentative est enregistrée dans `public.admin_email_logs` :

- type d'événement
- destinataire
- statut `sent` ou `failed`
- message d'erreur si échec
- métadonnées utiles
- date de création

Les erreurs d'alerte interne ne bloquent pas la réservation ou l'enregistrement du paiement.
