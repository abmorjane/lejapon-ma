# LeJapon.ma — Sauvegarde et reprise après sinistre

Statut : runbook de Phase A.1, audit et documentation uniquement

Dernière mise à jour : 2026-09-21

Baseline applicative : commit `ef3c76883e79916e1e3c4991fd991fb3c13839a6`, tag `phase-zero-responsive-complete`

Projet Supabase de référence : `nkovgpzspprmmhorwaxl`

Frontend de référence : hébergement statique o2switch

Ce document explique comment constituer des sauvegardes restaurables et comment reconstruire LeJapon.ma après la perte totale du projet Supabase ou de l'hébergement frontend. Il ne contient aucune valeur de secret et ne doit jamais en recevoir.

## 1. Principes et objectifs

Git protège le code et l'historique des migrations. Il ne sauvegarde ni les données PostgreSQL, ni les comptes Auth, ni les fichiers Storage, ni la configuration hébergée, ni les valeurs des secrets.

La stratégie cible suit le principe 3-2-1 : au moins trois copies, sur deux supports ou services distincts, dont une copie hors du fournisseur principal. Les archives contenant des données clients, des passeports, des documents ou des données Auth doivent être chiffrées avant leur transfert, accessibles uniquement aux responsables autorisés et conservées dans une région approuvée.

Objectifs proposés pour une PME :

| Périmètre | RPO cible | RTO cible indicatif |
| --- | ---: | ---: |
| Base PostgreSQL et Auth | 24 h avec sauvegarde quotidienne ; inférieur à 1 h si PITR activé | 4 à 8 h |
| Objets Storage | 24 h | 8 à 12 h |
| Code, fonctions et configuration déclarative | À chaque changement validé | 1 à 2 h |
| Frontend o2switch | À chaque mise en production | 1 à 2 h |

Le RPO est la perte de données maximale tolérée. Le RTO est le délai indicatif avant remise en service. Ces objectifs doivent être validés par la direction et testés lors d'un exercice réel sur un environnement isolé.

## 2. Audit du module Backups existant

### 2.1 Emplacement et contrôle d'accès

- Interface : `src/admin/pages/Backups.tsx`.
- Générateur : `src/lib/platform-backup.ts`.
- Route : `/admin/backups` dans `src/App.tsx`.
- Permission applicative : module `backups` réservé au rôle `super_admin` dans `src/admin/lib/permissions.ts`.
- Edge Function utilisée : `admin-users`, action `list`, avec vérification du super administrateur.
- Journalisation : tentative d'écriture dans `admin_logs` avec l'action `platform_backup_export`.
- Production du fichier : le navigateur construit un ZIP avec JSZip puis le télécharge localement. Aucun service serveur ne le dépose automatiquement dans un coffre externe.

### 2.2 Ce que le ZIP contient réellement

#### Données PostgreSQL métier

Le code demande explicitement 53 tables. Chaque table est lue par PostgREST avec `select("*")`, par pages de 1 000 lignes, puis écrite en JSON et CSV :

`clients`, `client_notes`, `client_rewards`, `bookings`, `booking_participants`, `booking_extras`, `booking_documents`, `booking_audit_log`, `payments`, `visa_applications`, `visa_documents`, `visa_settings`, `visa_document_checklists`, `trips`, `trip_hotels`, `trip_rooms`, `room_assignments`, `booking_participant_activities`, `trip_japan_payments`, `itinerary_days`, `pricing_tiers`, `trip_suppliers`, `suppliers`, `supplier_members`, `supplier_day_costs`, `extras`, `programmes`, `programme_days`, `pages`, `articles`, `article_categories`, `media`, `route_slugs`, `faqs`, `content_translations`, `newsletter_subscribers`, `contact_messages`, `email_templates`, `email_campaigns`, `email_campaign_recipients`, `email_events`, `marketing_segments`, `email_settings`, `email_logs`, `admin_email_logs`, `agency_settings`, `agencies`, `agency_users`, `agency_commissions`, `profiles`, `user_roles`, `crm_export_logs`, `admin_logs`.

Une erreur sur une table ne bloque pas la création du ZIP : le ZIP contient alors un JSON vide, un CSV vide et un fichier d'erreur pour cette table. Un ZIP généré avec succès peut donc être partiel. La lecture passe par les autorisations de l'utilisateur connecté et ne constitue pas un dump PostgreSQL cohérent à un instant transactionnel unique.

#### Répertoire Auth partiel

Le générateur appelle `admin-users` puis conserve seulement : identifiant, email, nom complet, rôles applicatifs et date de création. Le téléphone renvoyé par l'Edge Function n'est pas conservé par `platform-backup.ts`.

Le ZIP ne contient pas les tables du schéma `auth`, les identités, les hash de mot de passe, les confirmations email/téléphone, les métadonnées Auth complètes, les facteurs MFA, les sessions ou les refresh tokens. Ce fichier ne permet donc pas de restaurer les comptes ni leurs mots de passe.

#### Manifeste Storage partiel

Le module parcourt seulement 7 buckets codés en dur :

- `passports`
- `visa-docs`
- `booking-docs`
- `programme-pdfs`
- `media`
- `article-images`
- `programme-images`

Il enregistre les chemins et quelques métadonnées d'objets. Il ne télécharge aucun fichier. Le manifeste ne suffit pas à restaurer un passeport, un document visa, un PDF, une image ou une pièce jointe.

L'inventaire live validé en Phase A.1.2 confirme 14 buckets. Le module en ignore 7 : `agency-fit-requests`, `database_export_19_09_26`, `hotel-images`, `international-payments`, `partner-onboarding`, `trip-documents` et `trip-message-attachments`.

#### Métadonnées du ZIP

`backup-info.json` contient la version de plateforme, la date, l'identifiant de projet, l'origine web, l'utilisateur générateur, le résultat de chaque table, le nombre d'utilisateurs listés et le nombre d'objets listés.

### 2.3 Ce que le ZIP ne contient pas

| Élément | Couverture actuelle |
| --- | --- |
| Schéma SQL, types, contraintes et séquences | Absente |
| Fonctions SQL, triggers et policies RLS | Absente |
| Extensions PostgreSQL | Absente |
| Historique `supabase_migrations` | Absent |
| Dump transactionnel complet | Absent |
| Auth restaurable et hash de mots de passe | Absent |
| Objets Storage réels | Absents ; manifeste partiel uniquement |
| Configuration complète des buckets | Absente |
| Migrations du dépôt | Absentes du ZIP |
| Code et configuration des Edge Functions | Absents du ZIP |
| Valeurs ou inventaire complet des secrets | Absents |
| Configuration Auth, fournisseurs, URLs et SMTP | Absente |
| Jobs `pg_cron`, contenu Vault et configuration Realtime | Absents en tant qu'inventaire live |
| Frontend compilé et configuration o2switch | Absents |
| Chiffrement, signature, checksum et rotation | Absents |
| Planification et copie hors site | Absentes |
| Procédure d'import automatisée | Absente |

### 2.4 Classement

Le système actuel est **A. un backup métier partiel**. Il n'est pas un backup autonome de reprise après sinistre.

Les libellés actuels « backup complet » et « export de reprise après sinistre » surestiment sa portée. Le module reste utile pour consulter ou extraire une sélection de données métier, à condition de vérifier que `tables_with_errors = 0`. Il ne doit jamais être la seule sauvegarde.

### 2.5 Risques actuels

1. Une perte du projet Supabase ferait perdre les objets Storage même si un ZIP administratif récent existe.
2. Les comptes Auth ne peuvent pas être reconstruits à l'identique depuis `auth-users.json`.
3. Les 53 tables codées en dur dérivent dès qu'une nouvelle table est ajoutée.
4. Un export partiel peut être présenté comme réussi malgré une ou plusieurs tables en erreur.
5. Les lectures successives ne forment pas un snapshot transactionnel cohérent.
6. Le ZIP contient des données personnelles en clair et ne possède ni chiffrement ni checksum.
7. Il n'existe pas de rotation, de rétention, de supervision ou de test de restauration intégré.

## 3. Audit Git et artefacts déclaratifs

État constaté le 2026-09-21 :

| Contrôle | Résultat |
| --- | --- |
| Remote | `origin` vers le dépôt GitHub `abmorjane/lejapon-ma` |
| Branche | `checkpoint/fit-partner-reservation-fixes` |
| Commit | `ef3c76883e79916e1e3c4991fd991fb3c13839a6` |
| Tag local | `phase-zero-responsive-complete`, pointant sur ce commit |
| Migrations | 131 fichiers SQL sous `supabase/migrations/` |
| Edge Functions courantes | 20 répertoires avec `index.ts` sous `supabase/functions/` |
| Configuration Supabase | `supabase/config.toml` présent |

Le pack `docs/disaster-recovery-v1` date du 1er juin 2026 et a été produit depuis l'état local du dépôt, sans dump live. Son manifeste recense 13 Edge Functions et 8 buckets, alors que la baseline actuelle annonce 20 fonctions et 14 buckets. Son `schema.sql` contient du DDL et des données de référence issues des anciennes migrations ; ce n'est pas une photographie autoritative de la production actuelle. Il ne doit pas être utilisé seul pour restaurer la production.

### 3.1 Fichiers sensibles et archives

- `.env` est suivi par Git. L'audit n'y a trouvé que des variables `VITE_` destinées au navigateur et des identifiants de mesure publics, sans `service_role`, mot de passe ou clé privée. Il reste préférable de ne pas suivre un fichier d'environnement propre à la production.
- `.migration-backups/.env.backup-before-supabase-migration` est également suivi et contient l'ancienne configuration frontend publiable. Ce n'est pas un secret serveur, mais ce fichier d'environnement historique doit être sorti de Git lors d'une sous-phase dédiée.
- `.env.example` ne contient que des exemples ou valeurs publiques ; `OCR_API_KEY` y est vide.
- `lejapon-production-20260920.zip` est suivi par Git. Il s'agit d'une archive frontend compilée, pas d'un dump de données.
- `lejapon-phase-zero-production.zip` était présent mais non suivi au début de cet audit. Il s'agit également d'une archive frontend compilée.
- Le scan ciblé n'a trouvé aucun matériau de clé privée, clé Supabase secrète, JWT `service_role`, URI PostgreSQL avec mot de passe, secret SMTP, Gemini/IA, reCAPTCHA ou OCR assigné en clair.
- Aucun dump SQL de données clients, export de passeports ou archive de documents personnels n'a été identifié comme suivi par Git. Les scripts SQL de fixtures et diagnostics doivent toutefois rester strictement séparés des dumps de production.

Les archives de release frontend doivent être conservées dans un espace de releases ou de sauvegarde, avec checksum, plutôt que dans Git. Toute suppression de l'historique Git ou rotation de clé fera l'objet d'une opération séparée et validée.

## 4. Inventaire minimal d'une sauvegarde totale

### 4.1 Code source et Git

- `src/`, `public/`, `index.html`.
- `package.json` et `package-lock.json`.
- fichiers TypeScript, Vite, Tailwind et PostCSS.
- `public/.htaccess` pour HTTPS, domaine canonique, redirections et fallback React Router.
- `supabase/migrations/`, `supabase/functions/`, `_shared/` et `supabase/config.toml`.
- documentation d'exploitation et de reprise.
- commit, branche, tag et checksum de l'archive de release.
- copie du dépôt dans un second emplacement indépendant de la machine locale.

### 4.2 PostgreSQL

- rôles déclaratifs nécessaires, sans leurs mots de passe.
- schéma, données et séquences.
- types, contraintes, indexes et vues.
- fonctions, triggers, grants et policies RLS.
- extensions et leur version.
- publications Realtime, webhooks et paramètres non couverts par les migrations.
- historique `supabase_migrations`.
- schémas ou personnalisations `auth` et `storage` nécessaires.
- définitions `pg_cron` et structure Vault ; les valeurs secrètes doivent être recréées depuis le coffre de secrets.

### 4.3 Supabase Auth

- toutes les tables nécessaires du schéma `auth`, notamment utilisateurs, identités et hash de mots de passe, via une méthode officiellement supportée.
- configuration des fournisseurs, URLs autorisées, templates et règles de redirection.
- métadonnées nécessaires et correspondance des UUID avec les tables publiques.
- stratégie JWT : un nouveau projet invalide normalement les sessions existantes ; planifier une reconnexion générale. Toute conservation d'un ancien secret JWT exige une décision de sécurité explicite et une procédure protégée.

Les données Auth et les hash de mots de passe sont hautement sensibles. Ils doivent être chiffrés, avec accès journalisé, et ne doivent jamais entrer dans Git.

### 4.4 Supabase Storage

- inventaire live de tous les buckets.
- mode public/privé, limite de taille, types MIME autorisés et autres options.
- tous les objets réels avec leur chemin exact, taille, type, ETag ou checksum disponible.
- métadonnées PostgreSQL de `storage.buckets` et `storage.objects` selon la méthode de restauration retenue.
- rapport des objets manquants, doublons et erreurs de téléchargement.

Une sauvegarde PostgreSQL ne contient que les métadonnées Storage. Les fichiers doivent être copiés séparément.

### 4.5 Edge Functions

- les 20 sources de fonctions et `_shared/` dans Git.
- mode `verify_jwt` par fonction depuis `config.toml` et l'état live.
- version du runtime et dépendances importées.
- liste des noms de variables nécessaires, sans leurs valeurs.
- manifeste avec checksum SHA-256 par fonction.

L'audit du code courant trouve notamment les noms de configuration suivants : `ADMIN_BASE_URL`, `ADMIN_NOTIFICATION_EMAIL`, `ADMIN_NOTIFICATION_EMAILS`, `ADMIN_RECOVERY_ALLOWED_ORIGINS`, `AI_API_KEY`, `AI_API_URL`, `AI_MODEL`, `CLIENT_RECOVERY_ALLOWED_ORIGINS`, `EMAIL_FROM`, `MARKETING_BATCH_SIZE`, `OCR_API_KEY`, `OCR_API_URL`, `PUBLIC_SITE_URL`, `RECAPTCHA_SECRET_KEY`, `RECAPTCHA_SITE_KEY`, `SITE_URL`, `SMTP_FROM`, `SMTP_HOST`, `SMTP_PASS`, `SMTP_PORT`, `SMTP_USER`, `VAPID_PRIVATE_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT` et `VISA_SIGNUP_ALLOWED_ORIGINS`. Les variables `SUPABASE_*` par défaut sont fournies par la plateforme et ne doivent pas être copiées depuis l'ancien projet.

### 4.6 Configuration et secrets

Conserver dans un gestionnaire de secrets distinct :

- URLs de site, redirections Auth et domaines autorisés.
- configuration des fournisseurs Auth.
- paramètres SMTP et adresses d'envoi.
- reCAPTCHA, IA/Gemini ou fournisseur équivalent, OCR et notifications push.
- accès S3 temporaire utilisé pour la sauvegarde Storage.
- accès o2switch, DNS et registrar.
- clés nécessaires aux services tiers.
- noms et finalité des secrets Vault et Edge Functions.

Le dépôt ne conserve qu'un modèle avec le nom, le propriétaire, la finalité, la date de rotation et la procédure de recréation. Il ne conserve aucune valeur.

### 4.7 Frontend o2switch

- sources et lockfile dans Git.
- variables publiques de build dans un coffre ou dans la configuration CI, séparées du dépôt.
- contenu exact de `public/.htaccess`.
- archive chiffrée ou contrôlée du dernier `dist/` déployé, accompagnée d'un checksum et du commit source.
- procédure d'accès cPanel/SFTP/SSH, chemin de déploiement réel, propriétaire des fichiers et version PHP/Apache utile à `.htaccess`.
- configuration DNS, TLS, sous-domaines et redirections, exportée ou documentée.

## 5. Politique de sauvegarde recommandée

### Niveau 1 — Git

- Après chaque phase, migration, fonction ou changement important : commit signé ou attribuable, tag de release et push vers le remote.
- Chaque jour ouvré où du code change : vérifier que la branche et les tags existent sur le remote.
- Chaque mois : miroir du dépôt vers un second service ou une archive Git chiffrée hors site.
- Interdire les dumps, documents clients et valeurs de secrets dans Git.

### Niveau 2 — Sauvegarde Supabase native

- Vérifier dans le Dashboard le plan réel, la disponibilité des sauvegardes quotidiennes, leur rétention et l'éligibilité au PITR.
- Sur les plans payants, Supabase annonce des sauvegardes quotidiennes avec une rétention dépendant du plan. Si le RPO métier doit être inférieur à 24 heures, évaluer et activer PITR.
- Contrôler chaque semaine que la fenêtre de restauration est disponible.
- Ne pas considérer la sauvegarde native comme une copie hors fournisseur : la suppression du projet supprime aussi ses sauvegardes associées, et les objets Storage ne sont pas inclus.

### Niveau 3 — Backup PostgreSQL portable et indépendant

- Quotidien : export logique chiffré des données, incluant Auth selon la procédure officielle validée.
- Hebdomadaire : ensemble complet `roles`, `schema`, `data` et historique des migrations, avec manifeste et checksums.
- Mensuel : copie immuable ou hors ligne conservée 12 mois.
- Rétention proposée : 14 quotidiennes, 8 hebdomadaires, 12 mensuelles.
- Stocker hors Supabase et hors o2switch, dans un espace chiffré et versionné.
- Tester la restauration sur un projet isolé au moins chaque trimestre.

La procédure officielle Supabase de migration CLI produit séparément `roles.sql`, `schema.sql` et `data.sql`. Toujours vérifier la syntaxe de la version installée avec `supabase db dump --help` avant exécution. Ne jamais mettre l'URL de connexion ou le mot de passe dans l'historique shell, le nom de fichier ou Git.

### Niveau 4 — Copie réelle de Storage

- Quotidien : synchronisation incrémentale des objets vers un stockage externe chiffré et versionné.
- Hebdomadaire : inventaire complet des buckets, options, objets, tailles et checksums.
- Mensuel : copie immuable conservée 12 mois.
- Utiliser une méthode supportée et efficace pour le volume réel : CLI Storage ou client S3 compatible tel que `rclone`, avec identifiants temporaires placés dans le coffre.
- Ne jamais confondre `storage.objects` avec les objets eux-mêmes.
- Pour les passeports et documents : accès minimal, chiffrement, journalisation et politique de rétention conforme aux obligations applicables.

### Niveau 5 — Snapshot avant changement critique

Avant une grosse migration, un changement RLS/Auth, un changement financier ou Operations :

1. marquer le commit et la migration à appliquer ;
2. produire un export PostgreSQL portable cohérent ;
3. synchroniser Storage ou confirmer que la dernière copie est à jour ;
4. sauvegarder les configurations live et la liste des noms de secrets ;
5. calculer les checksums et vérifier l'archive ;
6. conserver le dernier frontend o2switch ;
7. inscrire l'heure, l'opérateur et le résultat dans le registre de changements.

Conserver ces snapshots au moins 90 jours, plus longtemps pour les changements financiers ou réglementaires.

### Manifeste obligatoire

Chaque jeu de sauvegarde doit avoir un manifeste non secret contenant :

- identifiant de sauvegarde, UTC de début et de fin ;
- environnement et référence de projet source ;
- commit et tag ;
- versions des outils ;
- fichiers, tailles et SHA-256 ;
- nombre de tables et résultat par table ;
- compte des utilisateurs Auth ;
- buckets, compte d'objets et octets par bucket ;
- fonctions et checksum de source ;
- noms des secrets attendus, jamais leurs valeurs ;
- erreurs, exclusions et statut final `complete` ou `failed` ;
- politique de rétention et date d'expiration.

Une sauvegarde avec erreur ne doit pas être étiquetée `complete`.

## 6. Procédure de restauration totale

Cette procédure suppose la perte complète du projet Supabase. Elle doit d'abord être répétée sur un environnement isolé. Toute restauration production exige une validation explicite, une fenêtre d'intervention et un responsable désigné.

### 6.1 Déclarer l'incident et choisir le point de reprise

**Manuel.**

1. Interdire les nouveaux déploiements et limiter les écritures sur l'ancien système s'il répond encore.
2. Consigner l'heure de l'incident et choisir la sauvegarde antérieure la plus récente validée.
3. Vérifier checksums, manifeste, chiffrement et disponibilité des quatre ensembles : Git, PostgreSQL/Auth, Storage, configuration.
4. Décider si la reprise utilise une restauration native Supabase ou un nouveau projet avec restauration portable.

Danger : restaurer une sauvegarde trop récente peut réintroduire une corruption logique ; une sauvegarde trop ancienne augmente la perte de données.

### 6.2 Récupérer le dépôt Git

**Automatique pour le contenu suivi ; manuel pour choisir la release.**

1. Cloner le remote dans un répertoire neuf.
2. Vérifier le commit et la signature/checksum attendus.
3. Extraire le tag de production validé.
4. Vérifier la présence de `package-lock.json`, `public/.htaccess`, `supabase/config.toml`, des migrations et des 20 fonctions attendues par la sauvegarde.

Ne pas utiliser une copie de travail contenant des modifications non validées.

### 6.3 Créer le nouveau projet Supabase

**Manuel.**

1. Créer le projet dans la région approuvée avec un plan et une capacité suffisants.
2. Activer les extensions nécessaires selon le manifeste.
3. Configurer les restrictions réseau, SSL et accès administrateurs.
4. Noter la nouvelle référence dans le registre d'incident, sans enregistrer le mot de passe dans ce document.

### 6.4 Restaurer le schéma et les données PostgreSQL

Choisir exactement un des deux chemins suivants.

#### Chemin A — restauration logique complète autoritative

**Principalement automatique, piloté manuellement.**

1. Restaurer `roles.sql`, `schema.sql` puis `data.sql` selon la procédure officielle et les versions d'outils consignées.
2. Restaurer séparément l'historique `supabase_migrations` si le paquet le contient.
3. Restaurer les personnalisations des schémas gérés `auth` et `storage` selon le paquet validé.
4. Réactiver les publications Realtime nécessaires.

Ne pas appliquer d'abord toutes les migrations qui créent les mêmes objets : mélanger replay DDL et restauration complète provoque des conflits et rend l'état difficile à prouver.

#### Chemin B — reconstruction par migrations puis données seules

**Automatique pour le replay ; manuel pour contrôler l'ordre et les écarts.**

1. Appliquer les migrations sur le projet vide dans leur ordre contrôlé.
2. Comparer le schéma obtenu avec le manifeste/dump de la sauvegarde.
3. Restaurer uniquement les données et séquences, avec les triggers neutralisés selon la procédure validée.
4. Restaurer l'historique des migrations de manière cohérente.

Ce chemin répond à la séquence « appliquer les migrations puis restaurer les données ». Il exige un dump data-only compatible et un test préalable des dépendances et clés étrangères.

Dans les deux chemins : capturer toutes les erreurs, ne pas les ignorer globalement, puis comparer tables, contraintes, fonctions, triggers, policies RLS, extensions et comptages.

### 6.5 Restaurer Auth

**Automatique si le schéma Auth complet est inclus ; sinon reprise manuelle dégradée.**

1. Restaurer les tables Auth et identités avec la méthode officielle correspondant au dump.
2. Vérifier que les UUID Auth correspondent aux références `profiles`, `user_roles`, membres fournisseurs/agences et données métier.
3. Tester un compte interne, un compte agence/client et un compte fournisseur.
4. Révoquer ou invalider les anciennes sessions si l'incident le justifie ; un nouveau projet implique normalement une reconnexion.

Danger : l'export du module `/admin/backups` n'est pas utilisable pour cette étape. Sans sauvegarde Auth complète, il faudra recréer les utilisateurs et imposer une réinitialisation des mots de passe, avec un risque de rupture des références UUID.

### 6.6 Recréer les buckets et restaurer Storage

**Automatique pour la copie ; manuel pour valider configuration et sécurité.**

1. Recréer tous les buckets avec leur nom exact, visibilité, limites et types MIME.
2. Réappliquer les policies Storage par les migrations ou le dump validé.
3. Restaurer chaque objet réel au même chemin et avec le bon type de contenu.
4. Comparer nombre d'objets, octets et checksums par bucket.
5. Tester une ressource publique et un fichier privé via un utilisateur autorisé ; confirmer le refus anonyme sur les buckets privés.

Restaurer les lignes `storage.objects` sans les fichiers produit des références cassées. Copier les fichiers sans les bonnes policies peut exposer des documents privés.

### 6.7 Redéployer les Edge Functions

**Automatique à partir de Git, déclenché manuellement.**

1. Vérifier le manifeste des fonctions et les checksums.
2. Vérifier `verify_jwt` dans `supabase/config.toml` et par rapport au manifeste live.
3. Déployer les fonctions vers la nouvelle référence de projet avec la version CLI validée.
4. Ne pas utiliser une option de suppression globale ou `prune` sans revue.
5. Tester CORS, authentification et un scénario non destructif par famille de fonctions.

### 6.8 Recréer les secrets et configurations externes

**Manuel depuis le gestionnaire de secrets.**

1. Charger les secrets Edge Functions depuis le coffre vers le nouveau projet.
2. Vérifier les noms avec `supabase secrets list`, sans journaliser les valeurs.
3. Reconfigurer SMTP, reCAPTCHA, IA, OCR, push et URLs autorisées.
4. Reconfigurer les fournisseurs Auth, templates, redirect URLs et Site URL.
5. Faire tourner les secrets qui auraient pu être compromis.

Ne jamais copier les anciennes valeurs la clé serveur Supabase ou autres clés propres au projet : utiliser celles générées par le nouveau projet.

### 6.9 Recréer cron et Vault

**Structure par migrations ; valeurs et activation contrôlées manuellement.**

1. Vérifier l'activation de `pg_cron` et `pg_net`.
2. Recréer les noms Vault nécessaires depuis le coffre ou laisser la migration générer les secrets internes prévus.
3. Mettre `project_url` à la nouvelle URL avant d'activer les jobs.
4. Recréer les jobs, vérifier leurs horaires et exécuter un test contrôlé.

Danger spécifique au dépôt actuel : `20260920114136_edge_cron_vault_auth.sql` contient l'URL du projet de référence. Lors d'une reconstruction vers un nouveau projet, ne pas laisser cron appeler l'ancien projet. Cette migration doit être paramétrée ou suivie d'une mise à jour contrôlée pendant une future sous-phase ; elle n'est pas modifiée par ce document.

### 6.10 Reconfigurer et reconstruire le frontend

**Build automatique ; configuration et déploiement manuels.**

1. Placer les nouvelles variables publiques Vite dans l'environnement de build sécurisé.
2. Exécuter `npm ci`, les tests et `npm run build` depuis le commit choisi.
3. Vérifier que `dist/.htaccess` correspond à `public/.htaccess` et que la redirection de l'aperçu social vise la nouvelle fonction.
4. Générer l'archive de release et son SHA-256.

Les variables `VITE_` sont intégrées au bundle navigateur. Elles ne doivent contenir aucune clé secrète ou `service_role`.

### 6.11 Déployer sur o2switch

**Manuel tant que la procédure d'upload exacte n'est pas automatisée dans le dépôt.**

1. Sauvegarder le contenu actuel de la racine web et sa configuration.
2. Déployer atomiquement le contenu du nouveau `dist/` via la méthode o2switch approuvée.
3. Conserver `.htaccess`, les permissions et le fallback SPA.
4. Purger seulement les caches nécessaires.
5. Garder l'ancienne release disponible pour rollback.

Le chemin distant et le mécanisme exact cPanel/SFTP/SSH doivent être relevés et ajoutés au registre d'exploitation en A.1.2 ; ils ne sont pas prouvés par le dépôt actuel.

### 6.12 Vérifier domaines et TLS

**Manuel.**

- vérifier DNS, certificat TLS, HTTPS et domaine canonique `www` ;
- vérifier la racine, les routes React profondes et les redirections historiques ;
- vérifier les URLs Auth, les liens email et les callbacks ;
- vérifier les URLs publiques Storage et Edge Functions ;
- confirmer qu'aucun ancien domaine/projet n'est encore utilisé.

### 6.13 Tests de reprise

Exécuter au minimum :

- connexion super administrateur et contrôle des rôles ;
- connexion client/agence/fournisseur représentative ;
- homepage et catalogue public anonymes ;
- lecture d'un client, d'une réservation, d'un dossier visa, d'un voyage et d'un programme ;
- lecture des versions de devis fournisseur et isolement RLS ;
- lecture/écriture autorisée d'un document privé de test, sans utiliser de passeport réel ;
- lecture d'un média public ;
- envoi d'un email de test vers une adresse contrôlée ;
- exécution contrôlée d'une fonction et d'un job cron ;
- comparaison des comptes et totaux avec le manifeste ;
- tests automatisés frontend et build de production ;
- scan de sécurité et vérification qu'aucune clé serveur n'est dans le bundle.

La reprise n'est déclarée terminée qu'après signature du rapport de validation et documentation de toute perte comprise entre le point restauré et l'incident.

## 7. Checklist de validité d'une sauvegarde

### Git et frontend

- [ ] Remote accessible depuis un compte de secours avec MFA.
- [ ] Commit et tag de production présents sur le remote.
- [ ] Dépôt clonable dans un répertoire vide.
- [ ] Lockfile, `.htaccess`, migrations, fonctions et `config.toml` présents.
- [ ] `npm ci`, tests et build réussissent depuis le tag.
- [ ] Archive frontend non vide, checksum connu et commit source enregistré.

### PostgreSQL et Auth

- [ ] `roles.sql`, `schema.sql` et `data.sql` non vides, ou sauvegarde native autoritative identifiée.
- [ ] Date, projet source, versions des outils et checksum connus.
- [ ] Nombre de tables, fonctions, triggers, policies et extensions cohérent.
- [ ] Historique `supabase_migrations` présent.
- [ ] Données Auth complètes présentes selon la méthode choisie.
- [ ] Utilisateurs, identités et hash de mots de passe couverts ; aucun mot de passe en clair.
- [ ] Comptages métier comparés au manifeste.
- [ ] Restauration testée sur un projet isolé sans erreur non expliquée.

### Storage

- [ ] Tous les buckets du live figurent dans le manifeste.
- [ ] Visibilité, limites et types MIME documentés.
- [ ] Objets réels présents, pas seulement `storage.objects` ou une liste de chemins.
- [ ] Nombre d'objets et octets cohérent par bucket.
- [ ] Checksums ou ETags disponibles et échantillons vérifiés.
- [ ] Archive chiffrée lisible par le compte de secours.
- [ ] Test de restauration d'un objet public et d'un objet privé réussi.

### Fonctions et configuration

- [ ] Toutes les Edge Functions figurent dans le manifeste avec checksum.
- [ ] Modes `verify_jwt` inventoriés.
- [ ] Liste des noms de secrets complète, sans valeur dans Git.
- [ ] Secrets disponibles dans un coffre indépendant avec deux responsables habilités.
- [ ] Configuration Auth, SMTP, reCAPTCHA, IA/OCR, push et URLs documentée.
- [ ] Jobs cron, horaires et noms Vault inventoriés.
- [ ] DNS, TLS et procédure o2switch documentés.

### Intégrité opérationnelle

- [ ] Sauvegarde marquée `complete`, sans table/bucket en erreur.
- [ ] SHA-256 vérifié après transfert hors site.
- [ ] Chiffrement et contrôle d'accès vérifiés.
- [ ] Rétention et date d'expiration connues.
- [ ] Journal de création mentionnant opérateur, durée et anomalies.
- [ ] Dernier exercice de restauration daté et accepté.

### Baseline de contrôle du 2026-09-21

Les valeurs suivantes ont été fournies comme ordre de grandeur de production et servent uniquement à détecter une sauvegarde manifestement incomplète : environ 66 utilisateurs Auth, 14 buckets, 1 026 objets Storage, 419 clients, 51 réservations, 80 dossiers visa, 10 voyages, 5 programmes et 20 Edge Functions. Elles doivent être remplacées dans chaque manifeste par les comptages live au moment de la sauvegarde et ne constituent jamais une règle métier.

## 8. Mesures de sécurité

- Ne jamais mettre dans Git un mot de passe DB, une clé secrète Supabase, une clé `service_role`, un secret SMTP, une clé IA/Gemini, un secret reCAPTCHA, un secret OCR ou une clé privée.
- Chiffrer les dumps et objets avant leur sortie du système source.
- Utiliser des identifiants de sauvegarde distincts, temporaires et à privilèges minimaux.
- Activer MFA sur GitHub, Supabase, o2switch, registrar et coffre de secrets.
- Restreindre les archives Auth/passeports à un nombre minimal de responsables.
- Ne jamais tester une restauration par-dessus la production.
- Journaliser téléchargements, restaurations et destructions d'archives.
- Faire tourner les clés après un incident de sécurité ou une exposition suspectée.

## 9. Recommandations pour Phase A.1.2

1. Réaliser un inventaire live en lecture seule : plan/retention/PITR, schémas, extensions, Auth, 14 buckets, objets, fonctions déployées, `verify_jwt`, cron, Vault et paramètres Auth.
2. Choisir l'emplacement hors site chiffré, sa région, la rétention et les deux responsables d'accès.
3. Prototyper un script de backup portable qui produit dump, manifeste, checksums et statut d'échec strict, sans jamais écrire dans Git.
4. Prototyper une synchronisation Storage externe avec reprise sur erreur et contrôle des 1 026 objets de baseline.
5. Tester un restore complet sur un projet Supabase isolé, puis mesurer RPO/RTO et documenter les écarts.
6. Établir l'inventaire de configuration par noms de secrets et la procédure de récupération depuis le coffre.
7. Paramétrer la migration cron/Vault afin qu'une nouvelle référence de projet ne réutilise pas l'ancienne URL.
8. Relever précisément le chemin et le protocole de déploiement o2switch, DNS/TLS et la procédure de rollback.
9. Retirer dans une opération validée les fichiers d'environnement et archives de release suivis par Git, renforcer `.gitignore`, puis décider si une purge d'historique est nécessaire. Aucun secret serveur n'a été détecté par le présent audit.
10. Après preuve par exercice, corriger les libellés du module `/admin/backups` et éventuellement l'intégrer au registre de sauvegardes métier sans le présenter comme une reprise totale.

## 10. Inventaire live de reprise — Phase A.1.2

Cet inventaire a été fourni et vérifié pour préparer la reprise. Il décrit l'état attendu, mais ne remplace pas le manifeste daté produit au moment de chaque sauvegarde.

### Storage

Les 14 buckets actuels sont :

1. `agency-fit-requests`
2. `article-images`
3. `booking-docs`
4. `database_export_19_09_26`
5. `hotel-images`
6. `international-payments`
7. `media`
8. `partner-onboarding`
9. `passports`
10. `programme-images`
11. `programme-pdfs`
12. `trip-documents`
13. `trip-message-attachments`
14. `visa-docs`

Classification opérationnelle :

- très sensibles : `passports`, `visa-docs`, `booking-docs`, `international-payments`, `partner-onboarding`, `trip-documents`, `trip-message-attachments`, `agency-fit-requests` ;
- publics ou marketing : `article-images`, `hotel-images`, `media`, `programme-images`, `programme-pdfs` ;
- à isoler jusqu'à audit de contenu et de rétention : `database_export_19_09_26`. Son nom suggère un export de base ; il doit être traité comme très sensible, privé et chiffré tant que son contenu n'est pas formellement classé.

### Edge Functions

20 Edge Functions sont actuellement déployées. Le dépôt contient 21 répertoires de fonctions courantes sous `supabase/functions/` (hors `_shared`) : cet écart doit être réconcilié par nom dans le futur manifeste, sans supposer qu'un répertoire local est déployé. Le manifeste de chaque sauvegarde doit comparer les noms live, les modes `verify_jwt` et les checksums du dépôt. Le pack historique de juin qui n'en recense que 13 n'est plus valide.

### Cron et Vault

- job actif : `process-marketing-queue-every-minute` ;
- schedule : `* * * * *` ;
- `send-visa-reminders` : volontairement désactivé ;
- noms Vault attendus : `edge_cron_secret` et `project_url`.

Les valeurs Vault ne doivent jamais apparaître dans Git, un manifeste, un log, une capture d'écran ou un rapport. Le manifeste note uniquement les noms, la finalité, la présence et la date de vérification.

### Extensions nécessaires

Extensions présentes notamment :

- `pg_cron`
- `pg_net`
- `pg_stat_statements`
- `pgcrypto`
- `pgmq`
- `supabase_vault`
- `uuid-ossp`

Avant restauration, relever les versions live. Sur le nouveau projet, activer les extensions requises avant les objets qui en dépendent et confirmer que les versions proposées sont compatibles avec le dump.

## 11. Éléments qui NE sont pas restaurés automatiquement avec un backup PostgreSQL

Même un dump PostgreSQL réussi ne reconstruit pas seul l'ensemble de la plateforme :

- les objets binaires Supabase Storage ; seules leurs métadonnées peuvent se trouver en base ;
- le code déployé des Edge Functions et leur configuration `verify_jwt` live ;
- les valeurs des secrets Edge Functions ;
- les valeurs déchiffrées de Vault et les clés externes ;
- les réglages Auth du Dashboard : Site URL, redirect URLs, fournisseurs, templates, SMTP et protections ;
- les clés API et identifiants des services tiers ;
- les réglages de plateforme, réseau, compute, sauvegardes, PITR, Realtime et restrictions ;
- la configuration DNS, TLS, cPanel/o2switch et les fichiers frontend déployés ;
- les clés propres au nouveau projet Supabase, qui doivent être régénérées et jamais copiées depuis l'ancien projet.

Le paquet de reprise est donc l'ensemble coordonné : Git + dump PostgreSQL/Auth + copie réelle Storage + inventaire de configuration + coffre de secrets + release frontend.

## 12. Protection contre un environnement cloné qui envoie de vrais emails ou lance de vrais cron

Une restauration de test contient potentiellement des emails, réservations et documents réels. Elle doit être considérée dangereuse jusqu'à neutralisation explicite.

Ordre obligatoire avant toute Edge Function ou application connectée :

1. créer l'environnement isolé sans domaine de production ;
2. laisser `pg_cron` désactivé ou supprimer tous les schedules du clone avant d'autoriser les connexions applicatives ;
3. confirmer que `process-marketing-queue-every-minute` est absent ou désactivé ;
4. maintenir `send-visa-reminders` désactivé ;
5. ne pas installer les secrets SMTP de production ;
6. utiliser un mail sink contrôlé ou bloquer complètement les emails externes ;
7. ne pas déployer d'abord les fonctions d'envoi, de marketing ou de rappel ;
8. remplacer toutes les URLs, callbacks, webhooks et destinataires par des valeurs de test ;
9. désactiver les campagnes et files marketing restaurées avant tout worker ;
10. interdire les push, webhooks, paiements, OCR payant et appels IA externes tant qu'ils ne sont pas explicitement testés ;
11. utiliser uniquement des comptes internes désignés et des données synthétiques pour les actions d'écriture ;
12. vérifier les logs réseau avant d'autoriser progressivement les intégrations.

La restauration des données précède toujours l'activation des automatismes. Aucun test ne doit notifier, modifier ou solliciter un client réel.

## 13. Stratégie Git et hygiène du dépôt

### État constaté

- branche de travail et de production actuelle : `checkpoint/fit-partner-reservation-fixes` à `ef3c768` ;
- cette branche est présente sur `origin` au même commit ;
- le tag `phase-zero-responsive-complete` est présent sur `origin` et pointe sur `ef3c768` ;
- `origin/main` pointe sur `6877dfa`, ancêtre de `ef3c768` avec 34 commits de retard ;
- la branche locale `main` pointe sur `9874acf`, ancêtre de `ef3c768` avec 17 commits de retard.

### Structure recommandée

Pour une petite équipe, la structure la plus simple est :

- `main` : production stable et déployable ;
- branches courtes `feature/...`, `fix/...` ou `phase/...` créées depuis `main` ;
- pull request ou revue avant intégration ;
- tags immuables pour chaque checkpoint réellement déployé.

Une branche longue `develop` n'est utile que si plusieurs chantiers doivent être intégrés ensemble avant release. Elle ajoute sinon une seconde source de vérité.

La convergence vers cette structure peut être un fast-forward de `main` vers `ef3c768`, puisque l'historique est linéaire. Elle doit être revue et autorisée séparément. Aucun merge, rebase, reset, checkout destructif ou push n'a été effectué pendant A.1.2.

### Fichiers à sortir ultérieurement du suivi

Après validation et copie locale sûre :

- `.env`, remplacé dans Git par `.env.example` et localement par `.env.local` ;
- `.migration-backups/` ;
- `lejapon-production-20260920.zip` ;
- les fichiers générés sous `supabase/.temp/` ;
- `supabase/functions.backup-20260920/` et `supabase/config.toml.backup-20260920`, après confirmation que le dépôt courant et les tags suffisent au rollback.

Utiliser plus tard `git rm --cached` pour conserver les copies locales. Ne pas supprimer ni réécrire l'historique sans une décision séparée. Les fichiers SQL reproductibles sous `supabase/migrations/`, `supabase/diagnostics/`, `supabase/tests/` et `docs/sql/` restent suivis ; il ne faut jamais ignorer globalement `*.sql`.

Les règles `.gitignore` préparées couvrent les environnements locaux, ZIP/TAR, formats de dump, dossiers de backup privés, snapshots locaux et état temporaire Supabase. Elles n'affectent pas les fichiers déjà suivis avant leur retrait explicite.

## 14. Backup PostgreSQL portable préparé

La CLI contrôlée pendant A.1.2 est Supabase CLI `2.117.0`. La commande demandée `npx --yes supabase@latest db dump --help` confirme les flags utilisés par le script : `--db-url`, `--file`, `--role-only`, `--data-only`, `--use-copy`, `--exclude` et `--schema`.

Le script proposé est `scripts/backup-production-db.sh`. Il n'a pas été exécuté contre une base. Il :

- exige `LEJAPON_PRODUCTION_DB_URL` et ne l'affiche jamais ;
- vérifie que la connexion mentionne la référence attendue ;
- exige deux acquittements explicites, dont la confirmation d'une destination chiffrée ;
- refuse toute destination située dans le dépôt Git ;
- fixe par défaut la CLI auditée `2.117.0` ;
- utilise `umask 077` ;
- produit `roles.sql`, `schema.sql`, `data.sql` et l'historique `supabase_migrations` ;
- exclut les tables vectorielles Storage indiquées par la procédure officielle ;
- conserve un répertoire `.partial` et un statut d'échec si une commande échoue ;
- refuse les fichiers vides ;
- génère `manifest.json` et `SHA256SUMS` ;
- ne copie pas Storage, ne charge rien hors site et n'exécute aucune commande Git.

Exemple d'utilisation future, uniquement après autorisation et depuis une machine sécurisée :

```bash
export LEJAPON_PRODUCTION_DB_URL='<connexion récupérée depuis le coffre>'
export LEJAPON_BACKUP_OUTPUT_DIR='<volume chiffré hors du dépôt>'
export LEJAPON_BACKUP_ACK='READ_ONLY_BACKUP_nkovgpzspprmmhorwaxl'
export LEJAPON_BACKUP_ENCRYPTED_DESTINATION_ACK='I_CONFIRM_OUTPUT_IS_ENCRYPTED'
./scripts/backup-production-db.sh
```

Le dump peut exposer temporairement l'URL de connexion dans la liste locale des processus parce que la CLI reçoit `--db-url`. L'exécuter seulement sur un hôte administré, sans autres utilisateurs non fiables, puis faire tourner le mot de passe DB selon la politique retenue. A.1.3 devra confirmer que `data.sql` permet bien la restauration Auth attendue avec la version courante de la plateforme.

## 15. Stratégie de copie réelle des 14 buckets

### Architecture proposée

1. créer des identifiants Storage source en lecture seule et à durée limitée ;
2. utiliser l'endpoint S3 compatible de Supabase avec `rclone` ;
3. utiliser `rclone copy`, pas `sync`, afin qu'une suppression source ne supprime pas automatiquement la sauvegarde ;
4. écrire vers un remote `crypt` avec chiffrement des contenus et des noms ;
5. activer versioning et, si possible, Object Lock sur le stockage de destination ;
6. conserver la structure `storage/<bucket>/<chemin-original>` ;
7. relancer la même copie après interruption : `rclone` compare les objets et reprend les éléments absents ou incomplets ;
8. produire par bucket un manifeste contenant chemin, taille, date, type, hash disponible et statut ;
9. lancer `rclone check` ou un contrôle équivalent après copie ;
10. signer le manifeste global avec SHA-256 et marquer la sauvegarde incomplète dès qu'un bucket échoue.

### Séparation et restauration

- Les 8 buckets très sensibles utilisent un remote chiffré distinct, des clés minimales et une rétention stricte.
- Les 5 buckets marketing peuvent utiliser une politique de coût différente, tout en gardant versioning et checksum.
- `database_export_19_09_26` reste dans la zone très sensible jusqu'à analyse ; aucune copie publique ou ouverture du bucket n'est autorisée.
- Chaque bucket doit être restaurable seul vers un bucket de test portant un nom différent.
- Les règles de bucket sont recréées séparément ; une copie d'objets ne restaure pas les policies RLS/Storage.

Aucun objet n'a été listé, téléchargé ou copié pendant A.1.2.

## 16. Comparaison des stockages hors site

Prix indicatifs relevés le 2026-09-21, hors taxes, requêtes, récupération, egress et éventuel KMS. Ils doivent être recalculés avant souscription.

| Option | Coût stockage indicatif | Chiffrement et versioning | Compatibilité | Europe et restauration |
| --- | --- | --- | --- | --- |
| AWS S3 Standard | environ 23 à 24 USD/To/mois dans plusieurs régions UE | SSE-S3 par défaut, KMS, versioning, Object Lock, IAM très complet | S3 natif, `rclone` excellent | Paris, Irlande, Francfort et autres régions ; restauration très robuste mais configuration et facturation plus complexes |
| Backblaze B2 | à partir de 6,95 USD/To/mois | AES-256 côté serveur, versioning natif et Object Lock ; ajouter `rclone crypt` | API B2 et S3, très bien supporté par `rclone` | EU Central à Amsterdam, choisie à la création du compte ; simple et économique pour une PME |
| Scaleway Object Storage | environ 16,06 EUR/To/mois en Multi-AZ, 8,03 EUR/To/mois en One Zone, 2,54 EUR/To/mois en Glacier | SSE-ONE/SSE-KMS/SSE-C, versioning et Object Lock ; ajouter chiffrement client | S3 compatible et support `rclone` | Paris, Amsterdam ou Varsovie ; fournisseur européen, restauration simple en Standard et plus lente depuis Glacier |

Choix initial recommandé à tester : Backblaze B2 EU Central pour le rapport simplicité/coût, ou Scaleway Multi-AZ Paris si la souveraineté européenne et la localisation en France priment. AWS S3 reste la solution la plus complète si la gouvernance IAM/KMS justifie sa complexité. Aucun service n'a été souscrit.

## 17. Vérifications manuelles Supabase Dashboard

Le propriétaire doit relever, sans rien activer pendant cet audit :

- plan exact du projet ;
- sauvegardes automatiques actives ou non ;
- date et statut de la dernière sauvegarde réussie ;
- fenêtre et durée de rétention ;
- type physical ou logical et possibilité de téléchargement ;
- PITR actif ou non ;
- point de restauration le plus ancien et le plus récent si PITR est actif ;
- coût actuel du PITR pour 7, 14 ou 28 jours et éventuelle exigence de compute ;
- région et version PostgreSQL ;
- inventaire et version des extensions ;
- configuration Auth, redirect URLs et fournisseurs ;
- inventaire des 14 buckets, options S3, limites, MIME, visibilité et nombre d'objets ;
- inventaire des 20 fonctions, leur dernier déploiement et `verify_jwt` ;
- job cron actif, jobs désactivés et erreurs récentes ;
- présence des deux noms Vault, sans révéler leur valeur.

Consigner ces informations dans un manifeste daté. Ne pas faire de capture contenant un secret, une chaîne DB ou une clé serveur.

## 18. Protocole A.1.3 — Disaster Recovery Drill

### Phase 0 — Autorisation et isolation

- validation écrite du périmètre, de la durée et des responsables ;
- nouveau projet distinct, région approuvée, aucun domaine production ;
- réseau sortant et emails neutralisés ;
- cron et fonctions automatiques désactivés ;
- jeu de sauvegarde validé et checksums vérifiés.

### Phase 1 — PostgreSQL et schéma

- restaurer selon un seul chemin documenté ;
- comparer extensions, migrations, tables, vues, fonctions, triggers, grants et RLS ;
- comparer les comptages métier au manifeste ;
- confirmer l'absence de job cron actif.

### Phase 2 — Auth

- vérifier utilisateurs, identités, UUID et rôles ;
- tester uniquement des comptes internes désignés ;
- confirmer qu'aucun email Auth réel ne peut partir.

### Phase 3 — Storage

- recréer les buckets et options ;
- restaurer d'abord un échantillon non sensible, puis bucket par bucket ;
- comparer chemins, tailles et checksums ;
- vérifier accès public attendu et refus anonyme sur les buckets privés.

### Phase 4 — Edge Functions et automatismes neutralisés

- déployer les sources avec secrets de test uniquement ;
- tester CORS et authentification ;
- garder marketing, rappels visa, emails, push, webhooks et paiements désactivés ;
- contrôler les logs réseau avant toute ouverture supplémentaire.

### Phase 5 — Frontend isolé

- construire depuis le tag choisi avec les variables du projet de test ;
- publier sur une URL de staging protégée et non indexable ;
- vérifier homepage, programmes, login, réservations, visa, documents et parcours fournisseurs.

### Phase 6 — Rapport et clôture

- mesurer RPO et RTO réels ;
- documenter erreurs, corrections et objets manquants ;
- confirmer qu'aucun client réel n'a été contacté ;
- décider de conserver ou détruire l'environnement et les copies conformément à la politique de données ;
- faire approuver le rapport avant de déclarer la procédure restaurable.

## 19. Références officielles

- [Supabase — Database Backups](https://supabase.com/docs/guides/platform/backups)
- [Supabase — Backup and Restore using the CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)
- [Supabase — Migrating Auth Users Between Projects](https://supabase.com/docs/guides/troubleshooting/migrating-auth-users-between-projects)
- [Supabase — Download Storage Objects](https://supabase.com/docs/guides/storage/management/download-objects)
- [Supabase — Edge Function environment variables and secrets](https://supabase.com/docs/guides/functions/secrets)
- [Supabase — Scheduling Edge Functions with cron and Vault](https://supabase.com/docs/guides/functions/schedule-functions)
- [Amazon S3 — Pricing](https://aws.amazon.com/s3/pricing/)
- [Amazon S3 — Default encryption](https://docs.aws.amazon.com/AmazonS3/latest/userguide/default-bucket-encryption.html)
- [Backblaze B2 — Pricing](https://www.backblaze.com/cloud-storage/pricing)
- [Backblaze B2 — Data regions](https://www.backblaze.com/docs/cloud-storage-data-regions)
- [Scaleway Object Storage — Pricing](https://www.scaleway.com/en/pricing/storage/)
- [Scaleway Object Storage — Versioning](https://www.scaleway.com/en/docs/object-storage/how-to/use-bucket-versioning/)
- [rclone — S3 provider and checksum behavior](https://rclone.org/s3/)

Ces pages évoluent. Avant un exercice ou une restauration réelle, vérifier la documentation et l'aide de la version CLI installée. Les commandes destructives ou de restauration exigent toujours une validation explicite.
