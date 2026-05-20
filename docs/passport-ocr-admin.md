# OCR passeport admin

Cette fonctionnalité aide l'équipe à saisir les informations passeport. Elle ne valide jamais automatiquement un profil : l'admin doit vérifier puis enregistrer.

## Emplacements

- Admin > Clients > Nouveau client
- Admin > Clients > Modifier client
- Admin > Réservations > Ajouter voyageur

## Sécurité

- Les fichiers sont uploadés dans le bucket privé `passports`.
- L'accès au bucket est limité aux rôles `admin` et `super_admin`.
- La lecture OCR passe par la Edge Function `passport-ocr`.
- Le frontend ne reçoit jamais de secret OCR.
- L'image peut être supprimée depuis le dialogue de scan.

## Variables Edge Function OCR

La fonction sait parser une MRZ si le moteur OCR renvoie du texte contenant les lignes MRZ. Aujourd'hui l'OCR est exécuté côté Supabase Edge Function. `tesseract.js` n'est pas utilisé dans le frontend afin de ne pas alourdir le bundle admin.

Contrat frontend actuel :

```ts
supabase.functions.invoke("passport-ocr", {
  body: {
    path,
    bucket: "passports",
  },
});
```

Le backend renvoie soit `ok: true` avec les champs détectés, soit `ok: false` avec un code d'erreur (`not_staff`, `unsupported_file_type`, `ai_rate_limited`, etc.).

Les PDF peuvent être uploadés et conservés, mais la lecture automatique est ignorée côté frontend car l'OCR vision attend une image JPG ou PNG.

Si le fournisseur OCR n'est pas configuré ou échoue, l'interface affiche :

```text
Passeport uploadé avec succès, mais lecture automatique impossible. Merci de saisir les données manuellement.
```

La création client ou voyageur reste possible.

## Debug OCR

La fonction `passport-ocr` journalise :

- chemin du fichier uploadé et variante MRZ
- génération d'URL signée réussie ou échouée
- téléchargement Storage réussi ou échoué
- appel du moteur OCR ou raison de non-appel
- longueur du texte OCR brut et aperçu
- lignes MRZ détectées ou absence de MRZ
- champs finaux extraits

Par défaut, les logs n'affichent qu'un aperçu du texte OCR pour limiter l'exposition de données passeport. Pour journaliser le texte OCR complet temporairement en environnement de debug :

```text
OCR_DEBUG_RAW_TEXT=true
```
