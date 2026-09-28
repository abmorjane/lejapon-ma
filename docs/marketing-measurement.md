# Marketing Measurement & Attribution V1

## Architecture

`src/lib/analytics.ts` est l’unique point d’entrée navigateur pour GA4, Microsoft Clarity et Meta Pixel. `src/lib/attribution.ts` collecte uniquement les identifiants d’acquisition non personnels et maintient le first-touch / last-touch. `src/lib/booking-funnel.ts` porte la sémantique et l’idempotence du tunnel. Supabase (`bookings`, puis `payments`) reste la source de vérité métier.

Le tracking navigateur est activé uniquement si les quatre conditions suivantes sont vraies : build de production, environnement déclaré production, hôte `lejapon.ma` ou `www.lejapon.ma`, route marketing publique inscrite dans le registre SEO. Il est bloqué sur localhost, preview, staging, test, prerender et toutes les familles privées.

## Identifiants publics

Variables Vite publiques :

- `VITE_GA_MEASUREMENT_ID=G-RN0Y6FTMQF`
- `VITE_CLARITY_PROJECT_ID=x1qyez2dwm`
- `VITE_META_PIXEL_ID=2129665337343090`

Ces identifiants ne sont pas des secrets. Aucun token serveur ne doit être placé dans une variable `VITE_*`.

## GA4

GA4 est chargé une fois, de façon asynchrone, avec `send_page_view: false`. Chaque navigation SPA publique réelle envoie manuellement un `page_view`. `/voyages` ajoute `view_trip`, `/programme` ajoute `view_programme`, et `/reserver` ajoute `booking_page_viewed` sans déclencher `booking_form_started`.

Les paramètres autorisés sont des données non personnelles : `trip_id`, `trip_slug`, `travelers_count`, `room_type`, `hotel_option`, `source`, `step`, `placement`, `traffic_source_normalized` et UTMs non sensibles. La sanitization écarte notamment nom, email, téléphone, adresse, documents, données visa/médicales et identifiants de clic opaques.

## Microsoft Clarity

Clarity conserve le projet `x1qyez2dwm`, est injecté une seule fois et reçoit les noms d’événement ainsi que des propriétés déjà nettoyées. À l’entrée dans une route non publique, le code suspend le consentement Clarity pour éviter une capture de l’espace sensible.

Il n’existe actuellement ni CMP ni préférence cookies exploitable dans le repository. Le choix juridique entre consentement préalable, consentement implicite ou catégorisation des outils doit être validé avant production. Ce chantier ne crée ni wording juridique ni fausse bannière.

## Meta Pixel

Le Pixel existant `2129665337343090` est chargé une seule fois, de manière asynchrone. Mapping navigateur :

| Événement métier | Meta |
|---|---|
| navigation publique réelle | `PageView` |
| `/voyages`, `/programme`, `/experiences`, `/hotels` et fiche hôtel | `ViewContent` |
| première validation intentionnelle d’une étape de réservation | `InitiateCheckout` |
| booking créé avec succès | `Lead` |
| paiement confirmé | aucun en V1 |

Un chargement de `/reserver` ne produit jamais `InitiateCheckout`. Un booking n’est jamais un `Purchase`.

## Meta Conversions API

La fonction préparée `supabase/functions/meta-conversion` accepte uniquement `Lead` et `Purchase`. Elle valide l’URL, l’UUID booking et l’`event_id`, relit le booking avec le client serveur, normalise puis SHA-256 l’email, le téléphone et l’ID externe, et transmet `fbp`/`fbc`, IP et user-agent lorsqu’ils sont disponibles. Elle ne logue aucune PII.

Pour `Purchase`, la fonction refuse l’envoi tant qu’elle ne trouve pas un paiement `status = received` avec `paid_at` non nul. Aucun appel `Purchase` n’est actuellement branché au workflow admin : il faudra un déclencheur serveur idempotent dédié.

Secrets Edge Function requis, exclusivement dans le secret manager Supabase :

- `META_CAPI_ACCESS_TOKEN`
- `META_PIXEL_ID=2129665337343090`
- `META_GRAPH_API_VERSION` (version approuvée au moment du déploiement)
- `SUPABASE_SECRET_KEY` recommandé, avec compatibilité temporaire `SUPABASE_SERVICE_ROLE_KEY`

La fonction n’est ni déployée ni configurée par ce commit.

## ChatGPT Ads et OpenAI Ads

Les paramètres reconnus sont `utm_source=chatgpt` ou `openai`, `utm_medium`, `utm_campaign`, `utm_content` (ID annonce), `chatgpt_campaign_id`, `chatgpt_ad_group_id`, `chatgpt_ad_account_id`, `oppref` et `click_id`.

`oppref` est opaque : il n’est ni décodé, ni modifié, ni hashé, ni tronqué. S’il est présent, `openai_click_ref = oppref`; sinon `openai_click_ref = click_id`. Lorsque les deux existent, les deux valeurs originales sont conservées. Une valeur dépassant la limite de sécurité est rejetée entièrement, jamais raccourcie.

La source normalisée est `chatgpt_paid`. L’abstraction `OpenAiConversionSender` prépare ce mapping sans appel réseau :

| Événement produit | Conversion logique future |
|---|---|
| navigation | `page_viewed` |
| contenu commercial | `contents_viewed` |
| intention de réservation | `checkout_started` |
| booking créé | `lead_created` |
| inscription métier distincte | `registration_completed` |
| paiement confirmé | `order_created` |

Aucun endpoint, secret ou payload OpenAI n’est activé dans V1. Une éventuelle clé serveur future (`OPENAI_ADS_CONVERSIONS_API_KEY`) et un éventuel pixel ID doivent rester hors `VITE_*`.

## Attribution first-touch / last-touch

La clé locale `lejapon.marketing_attribution.v1` ne contient aucune PII. Elle conserve UTMs, referrer externe, landing path, `fbclid`, `gclid`, `_fbp`, `_fbc` et identifiants ChatGPT Ads.

- First-touch : créé une seule fois ; direct, reload et navigation interne ne l’écrasent jamais.
- Last-touch : mis à jour uniquement lorsqu’une nouvelle acquisition réelle est détectée.
- Normalisation : ChatGPT/OpenAI → `chatgpt_paid`, Instagram → `instagram`, Facebook → `facebook`, Google → `google`, absence de signal → `direct`, autre referrer → `other`.

À l’insert, ces deux objets sont copiés dans `bookings.marketing_first_touch` et `bookings.marketing_last_touch`. La migration est additive, limite la taille, la forme, les clés et les sources autorisées. Le JSONB est préféré à une table 1:1 afin de garder l’écriture atomique dans le flux public existant et de ne créer ni nouveau endpoint PostgREST ni nouvelle politique RLS.

## Taxonomie

| Événement canonique | Déclencheur |
|---|---|
| `booking_page_viewed` | vraie navigation `/reserver` |
| `booking_form_started` | première sélection volontaire d’un voyage |
| `trip_selected` | sélection volontaire, dédupliquée par voyage |
| `booking_step_1_completed` | étape voyage validée |
| `booking_step_2_completed` | configuration validée |
| `booking_contact_step_viewed` | affichage effectif de l’étape coordonnées |
| `booking_submit_attempted` | clic réel de confirmation |
| `booking_submit_failed` | échec catégorisé sans message brut |
| `booking_form_submitted` | insert Supabase réussi uniquement |
| `whatsapp_clicked` | clic WhatsApp, avec placement et contexte disponible |
| `phone_clicked` | clic téléphone, avec placement et contexte disponible |
| `pdf_downloaded` | téléchargement PDF |
| `view_trip` | consultation `/voyages` |
| `view_programme` | consultation `/programme` |

Catégories d’échec autorisées : `recaptcha_failed`, `validation_failed`, `database_failed`, `network_failed`, `unknown`.

## Déduplication Meta

Après succès DB, le client génère un seul `event_id`. Ce même ID est transmis au `fbq Lead` et à la fonction CAPI. Les deux transports sont best-effort : une panne analytics ne modifie jamais le succès du booking. Si l’insert échoue, aucun `booking_form_submitted` et aucun `Lead` ne sont émis.

## Routes exclues

Sont notamment exclues : `/admin`, `/agency`, `/supplier`, `/client`, `/espace-voyage`, `/sales`, `/devis-fit`, `/accord-voyage`, `/unsubscribe`, formulaires visa privés, login/récupération de mot de passe, routes inconnues et routes noindex non marketing. Le registre central SEO reste la source des routes publiques.

## Privacy / PII

Aucune PII ne part vers GA4, Clarity ou le Pixel navigateur. Les PII nécessaires à CAPI ne sont jamais lues ni envoyées par le navigateur : l’Edge Function relit le booking puis effectue la normalisation et le hash côté serveur. L’attribution stockée localement et dans les colonnes marketing ne contient aucune PII.

## Tests et vérifications

- `npm test` : attribution, guards d’environnement/routes, initialisation unique, sanitization, funnel, déduplication browser/CAPI et non-réseau OpenAI.
- `npm run lint` : diagnostic global historique.
- lint ciblé : uniquement les fichiers V1.
- `npm run build` : Vite, sitemap, prerender, validateur SEO.
- Le prerender pose `window.__LEJAPON_PRERENDER__ = true`, intercepte les domaines GA/Google Tag Manager, Meta, Clarity et OpenAI, et échoue si une seule requête est tentée.

## Vérification après déploiement

1. GA4 : contrôler Realtime puis DebugView sur une navigation et un tunnel test ; confirmer l’absence de PII.
2. Meta Events Manager : utiliser Test Events avec un booking test, vérifier un `Lead` dédupliqué browser/server portant le même `event_id`.
3. Clarity : vérifier une session publique et confirmer l’absence de sessions privées.
4. Supabase : contrôler les deux colonnes d’attribution d’un booking test et leur absence de PII.
5. Paiement : ne brancher `Purchase`/`order_created` qu’après création d’un mécanisme serveur idempotent lié à `payments.status = received` et `paid_at`.

## Procédure de déploiement

1. Faire approuver le choix de consentement/CMP et la version Graph Meta.
2. Appliquer la migration `20260928151222_marketing_measurement_v1_booking_attribution.sql` sur staging, exécuter les contrôles DB, puis appliquer en production.
3. Configurer les secrets de la fonction sans les écrire dans Git.
4. Déployer `meta-conversion`, appeler un événement de test contrôlé et vérifier Events Manager.
5. Configurer les trois variables Vite publiques puis lancer le build complet.
6. Déployer `dist` seulement après validation sitemap/prerender et test navigateur sans PII.
7. Tester un booking de bout en bout ; confirmer l’attribution DB, le `Lead` dédupliqué et les emails métier.
8. Surveiller GA4/Meta/Clarity ; conserver un rollback frontend et fonction indépendant.

La migration et l’Edge Function sont uniquement préparées dans cette branche : aucune écriture, migration, secret ou fonction n’a été appliqué en production.
