# LeJapon.ma — Automatisation des sauvegardes externes

Ce document décrit l'infrastructure Phase A.2. Elle sauvegarde PostgreSQL/Auth et les objets Supabase Storage dans un stockage S3-compatible externe, avec chiffrement côté client. Elle ne remplace pas le runbook complet de restauration dans `docs/DISASTER-RECOVERY.md`.

## Périmètre et garanties

Le workflow produit un snapshot comprenant :

- les rôles, le schéma, les données PostgreSQL et l'historique `supabase_migrations` ;
- les données Auth présentes dans le dump PostgreSQL ;
- tous les buckets Storage réellement listés par l'endpoint S3 Supabase ;
- les 14 buckets de référence contrôlés explicitement ;
- les manifestes PostgreSQL, Storage et général ;
- les checksums SHA-256 ;
- les logs techniques inclus avant la génération des checksums ;
- un contrôle local, un contrôle rclone après upload et une relecture distante chiffrée.

Le système utilise `rclone copy`, jamais `sync`. Une suppression en production ne supprime donc pas un objet déjà stocké dans un ancien snapshot. Aucun mécanisme de rétention destructive n'est actif en Phase A.2.

## Architecture des scripts

| Fichier | Responsabilité |
| --- | --- |
| `scripts/backup-production-db.sh` | Produit les artefacts PostgreSQL/Auth, leur manifeste et leurs checksums. |
| `scripts/backup-production-storage.sh` | Liste les buckets live, détecte les écarts, copie et vérifie chaque bucket. |
| `scripts/backup-production-all.sh` | Orchestre DB + Storage, crée le manifeste général, chiffre, charge et vérifie. |
| `scripts/verify-production-backup.sh` | Valide un backup local ou relit les artefacts critiques du backup chiffré distant. |
| `scripts/restore-backup-help.sh` | Vérifie l'existence d'un snapshot et affiche le protocole de reprise sans restaurer. |
| `scripts/lib/backup-common.sh` | Centralise projet attendu, baseline des buckets, validations et SHA-256. |
| `scripts/lib/backup-rclone.sh` | Configure les remotes S3 et crypt uniquement par variables d'environnement. |
| `.github/workflows/backup-production.yml` | Déclenchement manuel contrôlé sur runner GitHub éphémère. |

Le layout chiffré visible après décryptage est :

```text
lejapon-prod/
  daily|weekly|monthly/
    lejapon-prod-YYYYMMDDTHHMMSSZ/
      manifest.json
      SHA256SUMS
      database/postgres/...
      storage/storage-manifest.json
      storage/<bucket>/<chemin-original>
      logs/...
```

## Secrets GitHub Actions obligatoires

Configurer dans **GitHub → Settings → Secrets and variables → Actions** :

| Secret | Usage |
| --- | --- |
| `SUPABASE_DB_URL` | Connexion PostgreSQL production destinée au dump. |
| `SUPABASE_BACKUP_S3_ENDPOINT` | Endpoint S3 Supabase Storage du projet source. |
| `SUPABASE_BACKUP_S3_ACCESS_KEY_ID` | Identifiant S3 source en lecture seule. |
| `SUPABASE_BACKUP_S3_SECRET_ACCESS_KEY` | Secret S3 source en lecture seule. |
| `BACKUP_S3_ENDPOINT` | Endpoint du stockage externe S3-compatible. |
| `BACKUP_S3_REGION` | Région attendue par le fournisseur externe. |
| `BACKUP_S3_BUCKET` | Bucket privé de destination. |
| `BACKUP_S3_ACCESS_KEY_ID` | Identifiant d'écriture limité au bucket de backup. |
| `BACKUP_S3_SECRET_ACCESS_KEY` | Secret correspondant. |
| `BACKUP_CRYPT_PASSWORD` | Mot de passe haute entropie de `rclone crypt`. |
| `BACKUP_CRYPT_SALT` | Second secret indépendant utilisé comme `password2`. |

`SUPABASE_BACKUP_S3_REGION` est facultatif et vaut `auto` par défaut. Les providers rclone valent `Other` par défaut et peuvent être adaptés avec `SUPABASE_BACKUP_S3_PROVIDER` et `BACKUP_S3_PROVIDER` dans un environnement administré.

Le fichier `config/backup.env.example` contient uniquement les noms et placeholders. Il ne doit jamais être transformé en fichier réel suivi par Git.

## Configuration du stockage S3-compatible

1. Créer un bucket privé dédié aux backups.
2. Choisir une région autorisée, idéalement en Europe.
3. Activer le versioning et, après validation du cycle de vie, Object Lock si disponible.
4. Créer un identifiant limité à la lecture/écriture/liste de ce seul bucket. La suppression distante n'est pas nécessaire pour la première version.
5. Relever l'endpoint, la région et le nom exact du bucket.
6. Créer séparément des identifiants S3 Supabase limités à la lecture des buckets source.
7. Enregistrer tous les secrets dans GitHub Actions et dans le coffre de reprise approuvé.

Backblaze B2, Scaleway Object Storage, AWS S3 et les implémentations S3 compatibles peuvent être utilisés. Aucun endpoint ou provider commercial n'est codé en dur.

## Chiffrement et récupération de la clé

Le runner crée deux remotes éphémères par variables d'environnement :

- `backup_raw`, qui pointe vers le bucket S3 externe ;
- `backup_crypt`, qui chiffre les contenus, les noms de fichiers et les noms de dossiers avant transfert.

Les valeurs originales de `BACKUP_CRYPT_PASSWORD` et `BACKUP_CRYPT_SALT` sont nécessaires pour toute reprise. Les identifiants S3 seuls ne suffisent pas à lire les fichiers.

Conserver hors Git et hors du fournisseur S3 :

1. le mot de passe crypt original ;
2. le sel crypt original ;
3. la date de création et l'identifiant de version de la paire ;
4. une copie dans le gestionnaire de secrets principal ;
5. une copie de secours hors ligne accessible à au moins deux responsables autorisés.

Ne jamais placer ces valeurs dans un manifeste, une issue, un ticket, une capture ou un log. Tester leur récupération pendant le Disaster Recovery Drill sans afficher les valeurs.

## Lancement manuel du workflow

1. Ouvrir **Actions → Backup production**.
2. Choisir **Run workflow** sur une branche revue contenant le workflow.
3. Sélectionner `daily` pour le premier test. `weekly` et `monthly` créent seulement des namespaces distincts.
4. Contrôler le SHA affiché avant le début du backup.
5. Vérifier que le job termine les étapes de backup et de relecture distante.
6. Relever uniquement le `backup_id`, le chemin logique et l'heure. Ne copier aucun secret dans le rapport.

Le workflow est exclusivement `workflow_dispatch`. Aucun cron GitHub n'est actif.

## Vérification

Le script local contrôle les manifestes, les cinq dumps SQL, les checksums, les 14 buckets de référence, les états par composant et les fichiers critiques non vides :

```bash
./scripts/verify-production-backup.sh --local-dir '<dossier-décrypté>'
```

Le contrôle distant relit le manifeste et les index via le remote crypt, puis confirme les artefacts critiques :

```bash
./scripts/verify-production-backup.sh \
  --remote-path 'lejapon-prod/daily/<backup_id>'
```

L'orchestrateur exécute aussi `rclone check` entre le paquet local et le remote chiffré avant de nettoyer les fichiers temporaires.

## Détection de dérive Storage

Les 14 buckets connus vivent dans une constante documentée dans `scripts/lib/backup-common.sh`. Le script liste aussi les buckets live :

- un bucket live inconnu est signalé, sauvegardé et inscrit dans `new_buckets` ;
- un bucket de référence absent est signalé dans `missing_buckets` et fait échouer le backup ;
- un échec de copie ou de vérification d'un bucket fait échouer l'ensemble ;
- aucun bucket n'est rendu public ou modifié par le script.

## Rétention

Les namespaces sont prêts pour la politique cible :

- 14 snapshots `daily` ;
- 8 snapshots `weekly` ;
- 12 snapshots `monthly`.

Aucune suppression n'est codée ou exécutée. La rotation ne sera activée qu'après :

1. un premier backup production réussi ;
2. une vérification distante réussie ;
3. un restore drill complet ;
4. la validation du versioning et d'Object Lock ;
5. une procédure de prévisualisation des suppressions et une autorisation séparée.

## Rotation des credentials

1. Créer une nouvelle paire côté source ou destination sans désactiver l'ancienne.
2. Mettre à jour les GitHub Secrets et le coffre hors ligne.
3. Exécuter un backup manuel et sa vérification distante.
4. Confirmer l'accès à un ancien snapshot avec les secrets crypt inchangés.
5. Révoquer l'ancien identifiant S3.
6. Documenter la date, le responsable et le backup de validation.

Une rotation S3 ne nécessite pas de changer les secrets crypt. Une rotation crypt crée une nouvelle génération de sauvegardes ; les anciennes clés doivent rester conservées aussi longtemps que les snapshots associés.

## Premier backup réel

Le premier run exige une validation explicite. Avant de le lancer :

1. confirmer le fournisseur, la région, le chiffrement serveur, le versioning et les droits du bucket externe ;
2. créer et tester les identifiants Supabase Storage en lecture seule ;
3. sauvegarder les deux secrets crypt hors Git ;
4. configurer les onze GitHub Secrets obligatoires ;
5. faire relire le diff du workflow et des scripts ;
6. lancer manuellement un backup `daily` ;
7. vérifier l'absence de secret dans les logs ;
8. confirmer le manifeste, les 14 buckets, les comptages et checksums ;
9. conserver le `backup_id` pour le prochain Disaster Recovery Drill ;
10. ne pas activer de cron ni de suppression automatique.
