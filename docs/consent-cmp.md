# Consent / CMP V1 — couche technique

`COPY_REQUIRES_HUMAN_VALIDATION` : les textes FR/EN/AR sont provisoires. Cette implémentation ne constitue pas une validation juridique. Ne pas activer le tracking en production avant revue humaine du wording, de la stratégie de consentement, des cookies et des fournisseurs.

## États et stockage

`src/lib/consent.ts` est la source unique. `lejapon.consent.v1` contient uniquement `version: 1`, deux booléens `analytics`/`marketing` et `updated_at` ISO. Absence, corruption, ancienne version, clé supplémentaire ou stockage inaccessible donnent `unknown` et aucun droit provider. Le choix n'est pris en compte qu'après écriture locale réussie. `clearConsent()` revient à `unknown`; le footer public rouvre le Dialog de préférences à tout moment.

| Choix | GA4 | Clarity | Meta Pixel | Meta CAPI futur |
|---|---|---|---|---|
| inconnu ou refus total | off | off | off | off |
| mesure seule | on | on | off | off |
| marketing seul | off | off | on | autorisable sous autres contrôles |
| tout accepter | on | on | on | autorisable sous autres contrôles |

Les outils nécessaires au parcours de réservation ne dépendent pas de ce choix. Le flag `VITE_MARKETING_TRACKING_ENABLED` est un **permis d'infrastructure**, pas un consentement : sa valeur versionnée reste `false`. Même avec `true`, les règles de production, hôte canonique, route publique, non-prerender et catégorie consentie s'appliquent indépendamment.

## Protocoles providers

- [Google Consent Mode v2](https://developers.google.com/tag-platform/security/guides/consent), mode **Basic** : aucun script GA4 sans consentement mesure. Avant le premier `config`/événement, `gtag('consent', 'default', …)` refuse `analytics_storage`, `ad_storage`, `ad_user_data` et `ad_personalization`. L'accord mesure met seulement `analytics_storage` à `granted` ; les trois valeurs publicitaires restent `denied`. Retrait : `analytics_storage: denied` et `ga-disable-<measurement-id>=true`.
- Clarity est dans la catégorie mesure. Chargement uniquement après accord mesure. `clarity('consentv2', { analytics_Storage: 'granted', ad_Storage: 'denied' })` accompagne le démarrage. Le retrait envoie les deux valeurs `denied`, puis `clarity('consent', false)` uniquement comme mécanisme [documenté d'effacement/arrêt des cookies Clarity](https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-consent-api-v2). La logique principale reste Consent V2 ; aucun appel V1 `true` n'est utilisé.
- Meta Pixel est dans la catégorie marketing. Aucun `fbevents.js`, `init` ou événement avant accord. Après accord, init unique et `fbq('consent','grant')`. Retrait : `revoke`; nouvelle acceptation : `grant` sans double init. CAPI n'est **pas déployée** et ne sera appelée que si le flag, la route et le choix marketing l'autorisent.

Les routes privées suspendent les trois providers même si les deux catégories sont acceptées. Un retour public reprend seulement les catégories encore consenties. Un accord tardif sur la page courante envoie exactement un `page_view` GA et/ou Meta à la catégorie nouvellement autorisée. La réservation reste fonctionnelle sans consentement ; l'événement métier `booking_form_submitted` n'atteint GA qu'avec consentement mesure et Meta browser/CAPI qu'avec consentement marketing.

## Attribution et réservation

L'attribution first-touch / last-touch locale est distincte des envois externes. Les UTMs, `oppref` et identifiants de clic restent capturés sans requête provider ; `oppref` reste opaque, intact, non décodé, non hashé et jamais envoyé à GA/Clarity. Les paramètres opaques ne sont retirés de l'URL qu'après confirmation de leur persistance locale.

La migration **non appliquée** `20260928184511_measurement_consent_v1.sql` ajoute `bookings.measurement_consent jsonb` nullable, avec une contrainte de taille et de clés strictes. L'insert public enregistre `{version, analytics, marketing, captured_at}`. Une absence de choix donne les deux booléens à `false`. Les anciennes réservations restent `NULL`. L'Edge Function préparée relit le champ et refuse `Lead` avec `marketing_consent_required` si `marketing !== true` ou si le snapshot manque. Les vérifications V1 du booking, de la source, de l'Origin, de la fraîcheur et de l'ID d'événement restent en place. Ce snapshot issu du navigateur n'est pas une preuve cryptographique de consentement ; la stratégie probatoire doit être revue avant CAPI.

**Ordre impératif d'une future mise en production :** revue humaine des textes et catégories ; appliquer/tester la nouvelle migration sur staging puis production ; vérifier un booking sans consentement ; seulement ensuite construire le frontend avec flag `true` et les IDs publics `G-RN0Y6FTMQF`, `x1qyez2dwm`, `2129665337343090`. Configurer et déployer CAPI séparément après validation des secrets et du workflow. Tester acceptation, refus, retrait, routes privées, et absence de tracking avant choix. Ne jamais déployer le frontend qui écrit `measurement_consent` avant la migration.

Le Service Worker garde son cache d'interface admin et privilégie le réseau pour les navigations. Aucun état CMP n'est dans `APP_SHELL` ni dans le HTML prérendu ; le choix demeure local au navigateur.
