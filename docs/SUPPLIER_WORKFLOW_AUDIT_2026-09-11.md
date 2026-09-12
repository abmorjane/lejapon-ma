# Audit du workflow fournisseur — 11 septembre 2026

## Conclusion

Le workflow n'était pas absent : ses modèles principaux existaient, mais le parcours voyage était interrompu par une erreur de lecture frontend et par une création de devis administrateur sans `supplier_id`. Le portail demandait en outre directement des tables réservées au staff pour calculer ses compteurs.

Le raccordement proposé conserve les modèles existants :

- `trip_suppliers` reste l'assignation explicite des voyages ;
- `fit_supplier_requests.supplier_id` reste l'assignation explicite des demandes FIT ;
- aucune table générique `supplier_assignments` concurrente n'est créée ;
- aucun calcul financier FIT V3–V9 n'est modifié.

La migration doit être appliquée sur le projet de production avant le frontend. L'accès Supabase disponible dans l'environnement de travail pointe uniquement vers un autre projet de staging ; le test E2E authentifié de production reste donc à exécuter après connexion du projet `nxnncbddtpjusrnhilxk` et mise à disposition d'une session du compte fournisseur.

## 1. Modèle existant

| Domaine | Structure existante | Relation utile |
|---|---|---|
| Fournisseurs | `suppliers` | société fournisseur |
| Comptes fournisseur | `auth.users` + `user_roles` + `supplier_members` | `supplier_members.user_id -> auth.users.id`, `supplier_members.supplier_id -> suppliers.id`; le rôle portail est `user_roles.role = 'supplier'` |
| Voyages | `trips` | dossier groupe |
| Assignation voyage | `trip_suppliers` | clé composée `(trip_id, supplier_id)` |
| Ancien coût/jour | `supplier_day_costs` | `(trip_id, supplier_id, day_number)` |
| Devis voyage | `supplier_trip_quotes` | `trip_id`, `supplier_id`, statut et validation |
| Lignes devis | `supplier_quote_hotel_rows`, `supplier_quote_transport_rows`, `supplier_quote_activity_rows`, `supplier_quote_guide_rows`, `supplier_quote_other_rows` | toutes rattachées par `quote_id` |
| Commentaires devis | `supplier_quote_comments` | `quote_id`, visibilité `internal`/`supplier` |
| Messages voyage | `trip_messages`, `trip_message_attachments`, `trip_message_reads` | accès dérivé de l'assignation du voyage |
| Documents voyage | `trip_documents` + bucket privé `trip-documents` | accès dérivé du voyage ; la correction ajoute `supplier_visible` |
| FIT | `fit_quotes` + tables V4–V9 | dossier FIT et calculs inchangés |
| Assignation/réponse FIT | `fit_supplier_requests` | `supplier_id`, statuts, réponse, coûts fournisseur, confirmation et échéances |
| Documents FIT | `fit_supplier_request_attachments` + chemin `fit/<supplier_id>/<request_id>/...` | rattachés à la demande FIT |
| Historique FIT | `fit_supplier_request_events` | événements staff ; la réponse fournisseur passe par `supplier_update_fit_request_v5` |
| Confirmations | pas de table voyage dédiée | portées par `supplier_trip_quotes.status`, `validation_status`, les statuts des lignes et, pour FIT, `confirmation_number`/`confirmed_cost` |
| Japan Office annexe | `japan_suppliers` | utilisé par les paiements internationaux, distinct du fournisseur portail |

Le portail est routé par `/supplier`, `/supplier/trips`, `/supplier/trips/:tripId/quote` et `/supplier/fit-requests`, sous `SupplierLayout`. L'accès applicatif exige un rôle `supplier` ou administrateur.

## 2. Cas réel observé

- Voyage : `VOYAGE EN AVRIL 2027`.
- `trip_id` : `8498bf96-a9e2-45e0-be20-85c19268aad4`.
- Fournisseur assigné dans l'écran **Fournisseurs > Voyages & accès** : `TAPIS VOLANT LLC` (Japan Office / DMC).
- Deux membres étaient affichés pour ce fournisseur : `b2840112-e1c4-47da-be05-f2b813ba6709` et `c7c98502-810f-4e06-92f4-4d5ff8ce4e5a`.
- L'écran utilisateurs confirme l'existence de `marijooxx@gmail.com`. La session de production disponible ne permet plus de relire l'API Auth pour attribuer de façon certaine lequel des deux UUID fournisseur lui appartient ; ce rattachement exact reste donc à confirmer par SQL.
- Le devis visible dans l'administration est rendu sous `Japan office / admin`. Dans le code, ce libellé apparaît lorsque `supplier_trip_quotes.supplier_id` est `NULL`. Le devis réel est donc non rattaché au fournisseur, même si `trip_suppliers` contient l'assignation du voyage.
- La table ne possède pas de champ d'en-tête `assigned_to` ; `assigned_to` existe uniquement sur les lignes de devis. Le responsable FIT équivalent est `fit_supplier_requests.assigned_staff_id`.
- L'identifiant exact, le `created_by` et le statut relu par SQL du devis ne peuvent pas être certifiés sans accès au projet Supabase de production. L'UI observée l'affichait en `draft` au moment de l'audit.

Comparaison certaine : le `supplier_id` du devis est `NULL`, tandis que le compte fournisseur est membre d'un `supplier_id` non nul assigné au voyage. Ils ne peuvent donc pas correspondre.

## 3. Cause du portail vide

La première erreur est déterministe : `SupplierTrips.tsx` exécutait

```text
trips.select("id,title,status,start_date,end_date,duration_days,season,is_public")
```

Or `trips.is_public` n'existe ni dans les migrations ni dans les types Supabase. PostgREST rejette toute la requête ; le composant transforme alors cette erreur en `Impossible de charger vos voyages assignés.`

Les compteurs à zéro avaient une seconde cause : après cette lecture, le navigateur fournisseur interrogeait directement `booking_participants`, `trip_hotels`, `bookings` et `booking_extras`. Leurs policies sont staff-only. Les erreurs de ces requêtes étaient ignorées et les tableaux `null` étaient convertis en compteurs zéro.

Enfin, l'écran devis administrateur était rendu dans le layout fournisseur et cherchait le `supplier_id` dans les propres `supplier_members` de l'administrateur. En l'absence de rattachement de l'admin à un fournisseur, le devis était enregistré avec `supplier_id = NULL` tout en affichant le toast de succès.

## 4. Raccordement réalisé

- Suppression de la colonne inexistante dans la lecture admin.
- Nouveau RPC `get_supplier_trip_dashboard()` : voyages assignés et compteurs calculés côté serveur, sans ouvrir les tables complètes au fournisseur et en excluant les réservations annulées.
- Nouveau RPC `get_supplier_trip_workspace(trip_id, supplier_id)` : projection opérationnelle limitée (programme, participants utiles, chambres, hôtels, extras et activités), sans paiements, marge, commission, coût par personne, métadonnées CRM ni autres fournisseurs.
- Nouveau RPC `get_supplier_trip_quote(...)` : en-tête fournisseur nettoyé ; `internal_notes`, commission, taux de change et montants MAD internes sont absents.
- Nouveau RPC `supplier_save_trip_quote_header(...)` : contrôle de l'identité, de l'appartenance, de l'assignation, des statuts autorisés et verrouillage après soumission.
- L'admin doit sélectionner un fournisseur avant sauvegarde/soumission. La sauvegarde fait un `upsert` explicite dans `trip_suppliers` puis rattache le devis au même `supplier_id`.
- `trip_suppliers` reçoit les champs d'audit `assignment_type`, `status`, `assigned_at`, `assigned_by`, `updated_at`. Une désassignation passe à `cancelled` au lieu de supprimer l'historique.
- Réparation prudente des devis historiques sans fournisseur uniquement lorsqu'un voyage possède exactement une assignation fournisseur active.
- Brouillon et soumission fournisseur fonctionnent via RPC ; les lignes ne sont éditables qu'en `draft` ou `revision_requested`.
- Les statuts de validation réservés au Japan Office ne sont plus modifiables par le fournisseur.
- Les métriques financières internes sont masquées de l'UI et des exports fournisseur.
- Les documents doivent être explicitement partagés (`supplier_visible`) ou avoir été chargés par l'utilisateur fournisseur ; seul l'auteur fournisseur peut remplacer/supprimer son fichier.
- Les erreurs techniques Supabase sont affichées avec leur code/détail. L'absence de voyage conserve l'empty state `Aucun voyage ne vous est actuellement assigné.`

## 5. RLS et fonctions de sécurité

- `user_supplier_ids(user_id)` refuse désormais la consultation des rattachements d'un autre utilisateur, sauf staff.
- `supplier_can_access_trip(user_id, trip_id)` vérifie le caller, le membership et une assignation non annulée.
- `supplier_can_access_quote(...)` centralise la lecture et l'édition des lignes du devis.
- L'en-tête `supplier_trip_quotes` est direct staff-only ; le fournisseur utilise le RPC nettoyé.
- Les lignes fournisseur ont des policies séparées lecture/insert/update/delete, avec verrouillage des devis soumis.
- Les commentaires internes restent invisibles ; seules les entrées `visibility = 'supplier'` sont exposées.
- `trip_documents` et le bucket associé sont filtrés par visibilité, auteur et assignation.
- Les fonctions `SECURITY DEFINER` ont un `search_path` fixé, leurs droits `PUBLIC/anon` sont révoqués et leur exécution est limitée à `authenticated` quand elles sont appelables.
- Les policies FIT V5 existantes sont conservées : un fournisseur ne voit que les demandes envoyées dont `supplier_id` appartient à ses memberships ; les calculs V4–V9 ne sont pas modifiés.

## 6. Notifications

La table `supplier_portal_notifications` et son flux RLS ajoutent :

- notification lors d'une assignation ou réactivation de voyage ;
- notification lors d'une demande FIT envoyée ;
- notification lors d'une demande de correction, revue, approbation/refus ou confirmation Japan Office ;
- lecture/marquage comme lu dans le dashboard fournisseur ;
- champs `email_delivery_status` et `email_scheduled_at` pour brancher ultérieurement un worker email, sans envoi email dans cette livraison.

## 7. Fichiers et migration

- `src/admin/pages/Suppliers.tsx`
- `src/admin/pages/supplier/SupplierTrips.tsx`
- `src/admin/pages/supplier/SupplierTripCosts.tsx`
- `supabase/migrations/20260911123423_complete_supplier_workflow.sql`
- `docs/SUPPLIER_WORKFLOW_AUDIT_2026-09-11.md`

Le moteur de devis V1 existait historiquement dans `docs/sql/SUPPLIER_QUOTE_ENGINE_V1.sql` mais pas comme migration horodatée. La nouvelle migration normalise les tables attendues avec des opérations `IF NOT EXISTS`; cette dérive historique devra être gardée en tête lors d'un futur `db reset` complet.

## 8. Vérifications exécutées

- `npm run build` : réussi.
- `npx tsc --noEmit` : réussi.
- `npm test` : 5 fichiers, 18 tests, tous réussis.
- Migration SQL analysée par le parseur PostgreSQL 18 : 116 statements valides au niveau syntaxique.
- `git diff --check` : réussi.
- `npm run lint -- --quiet` : non vert sur le dépôt, avec 1 577 erreurs historiques (principalement `no-explicit-any`) réparties dans de nombreux fichiers ; ce résultat n'est pas spécifique au workflow fournisseur et n'a pas été traité pour éviter le refactor demandé.
- Inspection fonctionnelle admin de production : voyage, assignation, fournisseur, membres et devis sans fournisseur confirmés.

## 9. E2E restant avant validation production

Le scénario demandé n'est pas déclaré réussi tant que ces actions ne sont pas faites sur production :

1. connecter le CLI/connector au projet `nxnncbddtpjusrnhilxk` ;
2. appliquer la migration puis lancer les advisors sécurité/performance ;
3. déployer le frontend après la migration ;
4. identifier par SQL le `user_id` exact de `marijooxx@gmail.com` et confirmer son rôle `supplier` et son `supplier_id` ;
5. vérifier/réparer le devis historique et relever son `id`, `created_by` et statut ;
6. se connecter comme `marijooxx@gmail.com`, ouvrir `VOYAGE EN AVRIL 2027`, sauvegarder puis soumettre ;
7. contrôler immédiatement côté admin la réception, demander une correction puis approuver/confirmer ;
8. contrôler côté fournisseur le verrouillage après soumission, le nouveau statut et les notifications ;
9. tester négativement qu'un autre supplier ne peut lire ni dossier, ni lignes, ni messages, ni documents, ni champs financiers internes.
