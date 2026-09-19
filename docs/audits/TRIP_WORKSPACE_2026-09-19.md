# Dossier Voyage / Trip Workspace — 19 septembre 2026

## 1. Architecture choisie

Le workspace est un shell transversal sous l'`AdminLayout` existant. Il conserve la barre latérale, les permissions et les breadcrumbs admin. Le contexte du voyage reste monté pendant les changements d'onglet ; les onglets sont des routes et non un état local, afin que les liens profonds et les actualisations navigateur restent stables.

Le workspace ne crée ni table ni moteur métier parallèle. Il compose les composants existants lorsque leur périmètre est déjà le voyage, et ajoute des vues de synthèse en lecture lorsque monter un composant d'édition sur un voyage archivé serait incorrect.

## 2. Routes

- `/admin/trips/:tripId/workspace`
- `/admin/trips/:tripId/workspace/:tab`

Les onglets acceptés sont `overview`, `reservations`, `participants`, `finance`, `visa`, `flights`, `hotels`, `supplier`, `operations` et `documents`. Une valeur inconnue redirige vers `overview`.

Les routes restent protégées par `RequireRole module="trips"`. Chaque section applique ensuite la permission de son module (`bookings`, `accounting`, `visa`, `flight_tickets`, `operations_center` ou `supplier_costs`).

## 3. Composants réutilisés

- `OpsParticipants` pour les participants actifs.
- `OpsRooms` pour les hôtels, chambres et rooming actifs.
- `FlightTickets` avec un nouveau mode `embedded` et une requête filtrée par `trip_id`.
- `SupplierTripCosts` pour le moteur de devis fournisseur existant lorsqu'un seul dossier fournisseur est courant.
- `TripOperations` pour le suivi opérationnel actif.
- `StatusBadge`, `PageHeader`, les composants UI et les helpers financiers existants.
- `organizedTripRevenue`, `groupSupplierQuoteVersions` et `getBookingPricingBreakdown` pour éviter une nouvelle définition du CA, des versions ou des prix négociés.

## 4. Nouveaux composants

- `TripWorkspace`: shell, contexte, navigation, alertes et intégration paresseuse des modules.
- `WorkspaceOverview`: actions et synthèse compacte.
- Vues compactes réservations, finance, visa et documents.
- Vues historiques sans édition pour participants, hôtels, opérations et fournisseur archivés.
- Helpers de route et de sélection de la version fournisseur courante dans `trip-workspace.ts`.

## 5. Stratégie de requêtes

Le chargement initial effectue des requêtes parallèles, toutes filtrées par le voyage : voyage, réservations, participants, devis autorisés, fournisseur assigné, documents, tâches et hôtels. Les dépendances sont ensuite regroupées : visas et vols par liste de `booking_id`, chambres par liste de `trip_hotel_id`, puis affectations par liste de `room_id`. Aucun appel par ligne n'est effectué.

Le contexte n'est pas rechargé lors d'un simple changement d'onglet. Les composants lourds sont chargés avec `React.lazy` et montés uniquement pour l'onglet ouvert. `FlightTickets` filtre désormais sa requête à la source quand il est intégré. Les erreurs de chaque source sont affichées avec leurs diagnostics et ne deviennent pas des listes vides silencieuses.

## 6. Actions de la Vue générale

Les alertes relient directement à leur onglet : réservations non soldées, données participants incomplètes, visas ouverts, vols absents/incomplets, devis fournisseur soumis, révision fournisseur demandée, exécution fournisseur en attente, dossier documentaire vide et tâches en retard.

La synthèse affiche réservations, passagers, CA, coût fournisseur, coût interne, marge, avancement visa, rooming et fournisseur. Le CA réutilise les montants négociés des réservations `confirmed`, `paid` et `completed`. Une requête incomplète, un montant invalide ou un nombre de lignes non vérifiable produit `CA non disponible`. Une valeur zéro vérifiée reste un vrai zéro. La marge n'est calculée que si CA et coût interne sont tous deux connus.

## 7. Permissions

La présence d'un onglet n'accorde aucun droit. Les sections sensibles rendent `Accès restreint` lorsque la permission du module manque. La requête de devis et les coûts fournisseur ne sont même pas exécutés sans `supplier_costs`. La finance exige `accounting`. L'ouverture des documents privés utilise un URL signé du bucket privé `trip-documents` et affiche une erreur réelle si la signature échoue.

Aucune RLS, policy, fonction SQL, permission Storage ou règle publique n'a été modifiée.

## 8. Voyages archivés

Le bandeau d'archive et le motif restent visibles. Les participants, hôtels/rooming, tâches et versions fournisseur utilisent des vues historiques en lecture seule ; leurs composants d'édition ne sont pas montés. Les documents restent consultables via les règles Storage existantes. Les règles d'archivage et protections d'écriture existantes restent la source d'autorité.

## 9. Navigation transversale

Des liens vers le dossier voyage ont été ajoutés depuis :

- le catalogue et la gestion opérationnelle des voyages ;
- le détail d'une réservation ;
- les coûts fournisseur ;
- les demandes visa rattachées à une réservation ;
- les groupes de billets d'avion.

Le module Réservations comprend maintenant un filtre `?tripId=` appliqué à la requête LeJapon.ma et aux demandes agence reliées, avec retour vers le workspace.

## 10. Tests et régressions

- Suite complète Vitest : **164 réussis, 1 test existant ignoré, 20 fichiers**.
- 15 tests workspace ciblent les routes, versions fournisseur, CA inconnu/zéro, alertes, liens, permissions, archive, lazy loading, navigation directe des onglets et fichiers privés signés.
- `npx tsc --noEmit` : réussi.
- `npm run build` : réussi ; seul l'avertissement Vite existant sur les gros chunks subsiste.
- `git diff --check` : réussi.
- Les fonctions protégées de calcul fournisseur, normalisation, sérialisation et validation de soumission sont identiques à `HEAD`.
- Aucune migration, donnée de production, version de devis, import Excel ou notification n'a été créé.

## 11. Capture

La capture utilise le DOM du composant testé et des données synthétiques ; elle ne contient aucune donnée de production :

- [Vue générale desktop](../screenshots/trip-workspace-overview.html.png)
- [Aperçu HTML inspectable](../screenshots/trip-workspace-overview.html)

La navigation compacte déborde horizontalement sur les petites largeurs, conformément au choix de conserver des tables et des onglets denses plutôt que de les transformer en grandes cartes.

## 12. Fichiers du sprint

- `src/admin/pages/trips/TripWorkspace.tsx`
- `src/admin/pages/trips/TripWorkspace.test.tsx`
- `src/admin/lib/trip-workspace.ts`
- `src/admin/lib/trip-workspace.test.ts`
- `src/App.tsx`
- `src/admin/components/PageHeader.tsx`
- `src/admin/pages/trips/TripsCatalog.tsx`
- `src/admin/pages/trips/TripsManagement.tsx`
- `src/admin/pages/Bookings.tsx`
- `src/admin/pages/BookingDetail.tsx`
- `src/admin/pages/FlightTickets.tsx`
- `src/admin/pages/VisaApplications.tsx`
- `src/admin/pages/SupplierCosts.tsx`
- `docs/screenshots/trip-workspace-overview.html`
- `docs/screenshots/trip-workspace-overview.html.png`

## 13. Limites Phase 1 et déploiement

La phase 1 ne transforme pas tous les écrans globaux en composants embarqués. Réservations, visa et documents ont des vues trip-scoped compactes qui ouvrent leurs écrans existants pour l'édition avancée. Plusieurs fournisseurs sont présentés comme dossiers/version à choisir avant d'ouvrir le moteur existant, afin de ne pas sélectionner silencieusement le mauvais fournisseur. La section Hôtels réutilise le rooming opérationnel du voyage ; le catalogue hôtel global reste séparé. Un smoke test avec un compte réel autorisé et le voyage Novembre 2026 reste nécessaire après publication.

Déploiement, non exécuté :

1. Créer un checkout de release contenant les changements validés et conserver les assets frontend précédents pour rollback.
2. Exécuter `npm ci`, `npm test -- --run`, `npx tsc --noEmit` et `npm run build`.
3. Publier le contenu frais de `dist/` avec le processus frontend LeJapon.ma existant. Conserver le fallback SPA pour les routes `/admin/trips/:tripId/workspace/:tab`.
4. Ne lancer ni migration SQL, ni `supabase db push`, ni déploiement d'Edge Function : ce sprint n'en contient aucun.
5. Avec des comptes autorisés, ouvrir un voyage actif et un voyage archivé, actualiser chacun des dix onglets, vérifier les restrictions de rôle, les URLs signées documentaires et les retours vers le workspace.
6. Vérifier ensuite les pages publiques et le portail fournisseur. En cas de rollback, republier uniquement les assets frontend précédents.

Le fichier `dist.zip` présent dans le workspace avait déjà été modifié en dehors de ce sprint et n'a pas été utilisé comme artefact de release.
