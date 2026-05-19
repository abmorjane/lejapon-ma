# OCR passeport admin

Cette fonctionnalité aide l'équipe à saisir les informations passeport. Elle ne valide jamais automatiquement un profil : l'admin doit vérifier puis enregistrer.

## Emplacements

- Admin > Clients > Nouveau client
- Admin > Clients > Modifier client
- Admin > Réservations > Ajouter voyageur

## Sécurité

- Les fichiers sont uploadés dans le bucket privé `passport-scans`.
- L'accès au bucket est limité aux rôles `admin` et `super_admin`.
- La lecture OCR passe par la Edge Function `passport-ocr`.
- Le frontend ne reçoit jamais de secret OCR.
- L'image peut être supprimée depuis le dialogue de scan.

## Variables Edge Function OCR

La fonction sait parser une MRZ si le moteur OCR renvoie du texte contenant les lignes MRZ. Configurer un fournisseur OCR côté Supabase :

```text
OCR_API_URL=
OCR_API_KEY=
```

Le fournisseur doit accepter un `multipart/form-data` avec le champ `file` et renvoyer soit :

- du texte brut contenant la MRZ, ou
- du JSON contenant `text`, `ocr_text`, `mrz`, ou directement des champs comme `first_name`, `last_name`, `passport_no`, `passport_expiry`.

Si le fournisseur OCR n'est pas configuré ou échoue, l'interface affiche :

```text
Lecture automatique impossible. Merci de renseigner les informations manuellement.
```

La création client ou voyageur reste possible.
