# LeJapon.ma — audit de reproductibilité STAGING

Date : 16 septembre 2026. Projet PROD autorisé : `nxnncbddtpjusrnhilxk` uniquement.

## Verdict et périmètre

- **Rebuild depuis zéro avec la chaîne actuelle : NON.**
- **Prêt à provisionner un STAGING représentatif maintenant : NON.**
- Aucun STAGING créé, aucun déploiement, aucune réparation d'historique.
- Aucun fichier de migration ni comportement de l'import Excel modifié.
- Aucun environnement Moroccan Express utilisé comme base d'audit ou de test.
- L'audit PROD est **bloqué par les droits d'accès**, et non par une erreur de schéma constatée en PROD.

## Méthode et limites

1. Replay Supabase CLI de la chaîne inchangée sur une base locale vide : arrêt au premier défaut.
2. Replays diagnostiques supplémentaires, en omettant uniquement dans une copie temporaire les fichiers déjà défaillants : identification d'autres blocages et du doublon d'historique.
3. Le 16 septembre, nouvelle base Supabase/PostgreSQL 17 jetable et isolée. Les 123 fichiers originaux sont exécutés individuellement avec `psql --single-transaction -v ON_ERROR_STOP=1`. Chaque échec annule son fichier ; la poursuite sert seulement au diagnostic.
4. Nouvelle tentative des 21 fichiers défaillants après les créateurs tardifs, toujours sans modifier leur SQL : tous restent bloqués. Le moteur de commission expose alors aussi le helper manquant `is_super_admin(uuid)`.

Résultat diagnostique : **102 fichiers SQL passent, 21 échouent, 122 versions distinctes pour 123 fichiers**. Ce résultat n'est PAS un rebuild réussi : les migrations manquantes ont été annulées, et les corps PL/pgSQL peuvent différer la validation de références jusqu'à l'exécution. Aucun workflow FIT ou financier n'est certifié sur cette base partielle.

L'insertion de l'historique par le CLI apporte un échec supplémentaire : les deux fichiers `20260715120000_*` partagent la même version, même si leur SQL peut s'exécuter individuellement.

## Premier échec du rebuild strict

Fichier : `supabase/migrations/20260526103000_agency_settings_public_read.sql`.

47 fichiers précèdent ce premier échec. Statement 0 du CLI, ligne 5 du fichier :

```sql
DROP POLICY IF EXISTS "public read agency_settings" ON public.agency_settings;
```

Erreur exacte :

```text
ERROR: relation "public.agency_settings" does not exist (SQLSTATE 42P01)
```

`IF EXISTS` porte sur la policy, pas sur la table. Aucun `CREATE TABLE agency_settings` n'est présent dans la chaîne locale.

## Causes racines et dépendances historiques

| Zone | Preuve | Conséquence / correction à concevoir, pas appliquée |
|---|---|---|
| Agency settings | Table utilisée par `20260526103000`, jamais créée dans les migrations | Définition de baseline manquante ; récupérer sa définition autoritative, ne pas inventer les colonnes |
| Commission V2 | `20260529090000` référence `organizations` et `organization_members`, créées seulement dans `20260613100000` | Ordre historique non rejouable |
| Helper commission | `is_super_admin(uuid)` utilisé à la ligne 92 du moteur V2 ; aucune définition dans les migrations | Hypothèse d'objet manuel / de baseline ; après création tardive des organisations, erreur `42883` confirmée |
| Devis fournisseur V1 | Quote engine dans `docs/sql/SUPPLIER_QUOTE_ENGINE_V1.sql`, hors chaîne horodatée ; création dans la chaîne seulement le `20260911123423` | Les migrations communication/documents/validation du 6 juin échouent avant septembre |
| Dépendance circulaire de bootstrap | Le workflow du 11 septembre crée les quotes mais exige `trip_documents`, dont la migration de juin exige déjà les quotes | La migration tardive ne suffit pas à rendre l'historique autonome |
| Enum rôle | `20260629160000` caste `sales` et `sales_user` en `app_role` ; aucune migration n'ajoute ces deux valeurs | `22P02` sur `sales` ; `sales_user` est également absent statiquement |
| Historique doublonné | `20260715120000_flight_reservation_workflow.sql` et `20260715120000_smart_operational_checklists.sql` | CLI : `23505 schema_migrations_pkey`, version déjà enregistrée ; PROD doit être inspectée avant de décider quelle histoire préserver |
| Hardening vols | `20260716120000`, fonction `operation_task_template_defaults`, lignes 159–174 : `SELECT *` renvoie aussi `template_key` | Retour déclaré 5 colonnes, sélection 6 ; `42P13`, colonne 5 text au lieu d'interval. Une définition ultérieure correcte ne peut pas sauver le replay précédent |
| Helper opérations | `20260716130000` utilise `v2_is_admin(uuid)`, jamais défini dans la chaîne | `42883` indépendant, pas seulement un défaut d'ordre |
| FK FIT facultatives | `20260904120000`, lignes 30–37, ajoute les FK `supplier_quote_id` seulement si les quotes existent déjà | Un bootstrap sans ancien moteur peut omettre les FK silencieusement ; aucune compensation ultérieure identifiée dans la chaîne |
| Version non canonique | `20260617240000` contient une heure 24 | Pas d'échec SQL observé ; convention temporelle non canonique à documenter sans renommer une version PROD appliquée |

## Tous les échecs SQL observés dans la poursuite transactionnelle

Les erreurs aval ne sont pas toutes des défauts indépendants : leur préalable a pu être annulé plus tôt. Ne pas corriger les fichiers aval par supposition.

| Fichier | SQLSTATE et message exact principal | Nature |
|---|---|---|
| `20260526103000_agency_settings_public_read.sql` | `42P01 relation "public.agency_settings" does not exist` | Baseline absente |
| `20260529090000_v2_commission_engine_v1.sql` | `42P01 relation "public.organizations" does not exist` ; retry tardif : `42883 function public.is_super_admin(uuid) does not exist` | Ordre + baseline helper |
| `20260606150000_trip_communication_center.sql` | `42P01 relation "public.supplier_trip_quotes" does not exist` | Quote engine prématurément référencé |
| `20260606153000_trip_document_center.sql` | `42P01 relation "public.supplier_trip_quotes" does not exist` | Quote engine prématurément référencé |
| `20260606154500_supplier_validation_workflow.sql` | `42P01 relation "public.supplier_trip_quotes" does not exist` | Quote engine prématurément référencé |
| `20260629160000_agency_fit_request_workflow.sql` | `22P02 invalid input value for enum app_role: "sales"` | Enum incomplet |
| `20260711120000_agency_fit_v1_dual_commission.sql` | `42P01 relation "public.commission_engine_rules" does not exist` | Aval du moteur de commission |
| `20260716120000_harden_flight_reservation_workflow.sql` | `42P13 return type mismatch in function declared to return record` ; `Final statement returns text instead of interval at column 5` | Défaut SQL indépendant |
| `20260716130000_operation_task_templates_admin.sql` | `42883 function public.v2_is_admin(uuid) does not exist` | Baseline helper |
| `20260722120000_flight_booking_simplified_ticketing.sql` | `42P01 relation "public.booking_flight_travelers" does not exist` | Aval du hardening vols |
| `20260901120000_secure_public_fit_quote_access.sql` | `42P01 relation "public.agency_fit_requests" does not exist` | Aval agence FIT/commission |
| `20260903120000_fit_commercial_lifecycle_v3.sql` | `42703 column q.public_link_revoked_at does not exist` | Aval accès public FIT |
| `20260904120000_fit_supplier_costing_profitability_v4.sql` | `42P01 relation "public.fit_quote_acceptances" does not exist` | Aval FIT V3 |
| `20260906120000_fit_agency_sales_workspace_v6.sql` | `42703 column "commercial_status" of relation "fit_quotes" does not exist` | Aval FIT V3 |
| `20260907120000_fit_premium_client_proposal_v7.sql` | `42P01 relation "public.fit_quote_acceptances" does not exist` | Aval FIT V3 |
| `20260908120000_fit_financial_closure_v8.sql` | `42703 column "fit_quote_id" does not exist` | Aval FIT V3 / payments |
| `20260910120000_fit_financial_calculation_reconciliation_v10.sql` | `42703 column l.supplier_id does not exist` | Aval FIT V4 |
| `20260911123423_complete_supplier_workflow.sql` | `42P01 relation "public.trip_documents" does not exist` | Aval quote engine/documents |
| `20260911232626_supplier_quote_collaborative_versioning.sql` | `42P01 relation "public.supplier_trip_quotes" does not exist` | Aval workflow fournisseur annulé |
| `20260912193312_trip_archiving.sql` | `42P01 relation "public.supplier_trip_quotes" does not exist` | Aval workflow fournisseur annulé |
| `20260913022132_supplier_quote_excel_import.sql` | `42P01 relation "public.supplier_trip_quotes" does not exist` lors de compilation PL/pgSQL | Aval workflow fournisseur annulé, pas régression Excel |

Échec d'enregistrement CLI distinct :

```text
ERROR: duplicate key value violates unique constraint "schema_migrations_pkey" (SQLSTATE 23505)
Key (version)=(20260715120000) already exists.
```

Aucun autre conflit SQL `CREATE` dur n'a été observé dans les chemins exécutés. Les statements non atteints après une erreur et les branches différées ne sont pas déclarés validés. `IF NOT EXISTS` ne garantit pas l'équivalence des objets existants.

## Risque d'isolation : cron ciblant PROD

`20260422200157_ec594eac-b135-41b9-bb23-b992e159ac21.sql` crée `visa-document-reminders-daily`, schedule `0 9 * * *`, avec `net.http_post` vers la fonction PROD `send-visa-reminders` de `nxnncbddtpjusrnhilxk` et un bearer JWT PROD intégré (rôle `anon`). Aucun jeton n'est reproduit dans ce rapport.

Ce fichier passe SQL, mais son replay non isolé est dangereux pour un STAGING. Il faut neutraliser les tâches externes avant import de baseline/replay, puis reconstruire uniquement des tâches pointant vers le STAGING avec ses propres credentials. Ne pas recopier ce bearer dans le staging.

À la découverte, le seul conteneur d'audit a été immédiatement arrêté. Heures Docker : `2026-09-16T20:08:03Z` → `20:11:20Z`, donc hors horaire 09:00. Les logs du conteneur arrêté ne contiennent aucun indice correspondant à une exécution de cette tâche. L'historique `cron.job_run_details` n'a pas été lu : le redémarrage risqué a été refusé par le contrôle de sécurité et n'a pas été contourné. Ne pas interpréter l'absence de logs comme une preuve exhaustive des exécutions.

Les deux projets locaux jetables ont ensuite été nettoyés avec `supabase stop --project-id <ID_EXACT> --no-backup`, jamais `--all`. Leurs données temporaires ne sont plus conservées dans des volumes Docker ; les constats et résultats utiles sont conservés dans ce rapport. Aucun volume appartenant à un autre projet n'a été ciblé.

## Audit PROD et historique : accès indisponible

Les tentatives ciblent exclusivement `nxnncbddtpjusrnhilxk` :

- Connecteur `get_project` : `You do not have permission to perform this action`.
- Connecteur SQL, simple SELECT de métadonnées : même refus.
- CLI `link --project-ref nxnncbddtpjusrnhilxk` dans un workspace temporaire : `Your account does not have the necessary privileges to access this endpoint`.
- Catalogue OpenAPI, sans données clients, avec la clé frontend existante : HTTP 401 ; endpoint non accessible avec cette clé.
- Aucun navigateur connecté disponible pour un autre accès autorisé.

**Aucun inventaire PROD réussi.** Tables, colonnes, enums, indexes, FK, RPC, triggers, RLS, buckets et historique actuels en PROD ne peuvent donc pas être comparés honnêtement. Aucune absence de table en PROD n'est déduite d'un défaut de rebuild local. Les types générés et les documents du dépôt ne remplacent pas un catalogue PROD actuel.

Historique PROD : migrations appliquées absentes localement, migrations locales non appliquées, contenu de la version doublonnée, réparations éventuelles et gaps PROD restent **INCONNUS**. Aucun `migration repair`, `db push`, `db pull` ou déploiement exécuté sur PROD.

Un export de métadonnées uniquement est fourni dans `docs/audits/lejapon-prod-readonly-catalog.sql`. Son SELECT principal a été exécuté avec succès sur une seconde base Supabase locale vide, sans application ni cron : `transaction_read_only = on`. Les blocs historique et cron sont optionnels et séparés, pour supporter l'absence de ces catalogues. L'export n'a pas été exécuté en PROD.

## Release candidate fournisseur : ordre et compatibilité conditionnelle

Ordre de dépendance correct sur une baseline complète et équivalente à PROD :

1. `20260911123423_complete_supplier_workflow.sql` — assignments/memberships/helpers, quote engine, dashboard/workspace, notifications ; exige déjà les documents/messages, structures opérationnelles et FIT supplier.
2. `20260911232626_supplier_quote_collaborative_versioning.sql` — versions et contrôle des lignes/totaux ; exige le précédent.
3. `20260912193312_trip_archiving.sql` — couche archive et protections ; exige les structures supplier précédentes et les structures/fonctions FIT/finance/operations historiques.
4. `20260913022132_supplier_quote_excel_import.sql` — exige archive/edit permissions, versioning, tables de lignes et `recalculate_supplier_quote_totals_v2`.

Ces quatre fichiers ne sont pas un bootstrap autonome. Leur certification locale authentifiée antérieure n'est pas remise en cause par les échecs de baseline observés ici, mais elle ne prouve pas leur compatibilité avec l'état PROD inconnu.

Le correctif alias `42702` est présent aux lignes 116–121 de l'import : les expressions utilisent `source.value` et `jsonb_array_elements(...) as source(value)`, pas la référence ambiguë `item`. Handling, commission interne, parser, décisions ambiguës, versioning et permissions de l'import sont inchangés.

Empreintes SHA-256 des fichiers audités :

```text
20260911123423 d4449d863e949415cf76131c1a8221a6d15fefa7042af52cb6e0922461999440
20260911232626 3779ca0803ef4e518dfbcccf13dd7085df2da138c3f5aa3179fc0db255e0dc1d
20260912193312 a7e89ee44d990a095791c674c71515b317c4f24f9b6576c02896884130f7ca57
20260913022132 50674530fe37389adad88b3fd92910e8b68f7936b05eeee874f2666ced47a4c2
```

## Stratégie STAGING recommandée et prochaines étapes

La préférence « chaîne historique propre depuis zéro » n'est pas satisfaite. Sans réécrire les migrations déjà appliquées, **baseline de schéma revue + migrations forward** est la stratégie recommandée, sous réserve de l'audit PROD restant.

1. Authentifier le connecteur/CLI avec un compte autorisé à lire LeJapon.ma, ou exécuter l'export de catalogue depuis le SQL Editor de ce projet et fournir les résultats comme fichier local. Ne pas partager de service-role key ni de secrets dans le chat.
2. Comparer le catalogue et l'historique aux fichiers Git, notamment la version doublonnée, les helpers manquants, les enums, les FK FIT et le moteur supplier historique.
3. Si nécessaire, obtenir un dump **schema-only** de PROD pour établir la baseline autoritative. Exclure données Auth, clients, passeports, documents, storage objects, secrets et tâches externes PROD ; revoir aussi les credentials potentiellement intégrés aux fonctions/defaults.
4. Préserver l'historique PROD et les migrations existantes. Concevoir une procédure de provisioning/baseline distincte pour nouveaux environnements ; ne pas réparer ou squasher PROD pour faciliter STAGING.
5. Séparer explicitement les changements RC non appliqués de la baseline et appliquer leur ordre ci-dessus seulement après validation des prérequis. Ne pas déduire qu'ils sont tous pending sans lire l'historique PROD.
6. Valider cette baseline et ses migrations forward deux fois sur des bases locales vides, avec jobs externes neutralisés **avant** démarrage. Comparer les catalogues finaux et tester les accès authentifiés/RLS.
7. Provisionner le projet dédié seulement après ce gate et accord utilisateur. Utiliser fixtures synthétiques, utilisateurs Auth indépendants, nouveaux secrets STAGING, stockage vide et SMTP de test ; aucune donnée client réelle.
8. Rejouer ensuite la certification Excel authentifiée (72 lignes, 10 815 700 JPY), les tests négatifs, le versioning et les smoke tests portail.

Fichiers nécessitant une décision de baseline/replay : ceux listés dans les causes racines ; les fichiers aval ne doivent pas être modifiés sans preuve supplémentaire. Les corrections exactes et la liste forward PROD ne peuvent pas être finalisées avant inventaire PROD.

**Conclusion : techniquement reproductible en principe via une baseline validée, mais non reproductible depuis la chaîne actuelle seule et non prêt à créer un STAGING représentatif maintenant.**
