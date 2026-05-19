## Objectif

Activer FR / EN / AR sur tous les contenus éditables (voyages, extras, FAQ, frontend textes, pages, articles), avec **pré-remplissage automatique** des traductions manquantes via l'IA Lovable, fallback FR en cas de vide, et UX d'édition par onglets côté admin.

## Architecture choisie

Plutôt que d'ajouter des dizaines de colonnes `_en` / `_ar` partout, on centralise dans **une seule table** `content_translations` :

```
content_translations(
  id, table_name, row_id, field, language,
  value_text, status ('auto'|'verified'|'manual'), source_text_hash,
  created_at, updated_at, updated_by
)
unique(table_name, row_id, field, language)
```

Avantages : zéro casse sur les tables existantes (FR reste tel quel), facile à étendre à n'importe quel champ ou table, on stocke le statut + le hash de la source FR pour détecter les drifts.

Helpers :

- Hook React `useTranslated(table, row, fields)` qui charge en lot les traductions pour la langue active et fait fallback FR.
- Composant `TranslationField` (admin) : input/textarea avec onglets FR/EN/AR + badge statut + bouton "Re-traduire".
- Edge function `translate-content` : reçoit `{table, rowId, field, sourceText, targetLang}`, appelle Lovable AI (`google/gemini-2.5-flash`), upsert dans `content_translations` avec `status='auto'`. Bulk endpoint `{items: [...]}`.

## Champs couverts par langue

| Table | Champs traduits |
|---|---|
| `trips` | title, season, short_description, long_description, highlights[], label, cover_alt |
| `extras` | name, description, alt_text |
| `faqs` | colonnes `_en` / `_ar` existent déjà — on les remplit, pas de nouvelle table |
| `programmes` | title, subtitle, introduction, description, hero_alt, cta_label, meta_description |
| `programme_days` | title, description, city, badge, special_note |
| `articles` | title, excerpt, meta_title, meta_description |
| `pages` | title, meta_description, content (jsonb : on traduit les feuilles texte) |
| `route_slugs` | label uniquement (slugs restent FR) |
| `site_content` (clé/valeur frontend) | value |

## 1. Migration SQL

- Création de `content_translations` + index + RLS (lecture publique, écriture staff).
- Trigger `set_updated_at`.
- Fonction `get_translation(_table, _row, _field, _lang) returns text` (fallback FR : si pas trouvé, renvoie NULL côté SQL — fallback géré côté client pour rester simple).

## 2. Edge function `translate-content`

- `supabase/functions/translate-content/index.ts` (verify_jwt par défaut → laissé activé, appelée depuis l'admin authentifié).
- Body : `{ items: [{table, rowId, field, sourceText, targetLang}], model? }`.
- Appel Lovable AI Gateway (`https://ai.gateway.lovable.dev/v1/chat/completions`, modèle `google/gemini-2.5-flash`) avec un prompt court : "Translate from French to {target}. Preserve tone, brand names, and inline HTML/markdown. Output only the translation."
- Gestion 429/402 (renvoi statut explicite).
- Upsert chaque résultat dans `content_translations` (`status='auto'`, `source_text_hash=md5`).
- Limite : 25 items / appel, exécution en parallèle.

## 3. Backfill global (one-shot)

Page admin `/admin/translations` (visible super_admin/admin) avec :

- Tableau des entités cibles (trips, extras, faqs, programmes, programme_days, articles, pages, site_content).
- Pour chaque ligne : nb champs FR, nb traductions EN existantes, nb AR existantes, bouton **"Générer les traductions manquantes"**.
- Bouton global **"Tout traduire (EN + AR)"** qui itère par batchs de 25.
- Pour `faqs` : remplit directement les colonnes `_en` / `_ar` existantes (pas via `content_translations`).
- Barre de progression + résumé succès/erreurs.

Cette page est le levier principal pour respecter "je ne veux pas remplir chaque case manuellement".

## 4. UX admin par contenu

- `TranslationTabs` : composant générique avec 3 onglets FR / EN / AR. FR = champ source (lit/écrit la table d'origine). EN/AR = lit/écrit `content_translations` + badge :
  - `status='auto'` → badge orange "Traduit auto · à vérifier"
  - `status='manual'` ou `'verified'` → badge vert "Traduit manuellement"
  - Si la source FR a changé depuis la traduction (hash différent) → badge "Source modifiée"
- Bouton "Régénérer" appelle l'edge function pour ce seul champ.
- Intégration dans :
  - `Trips.tsx` (édition voyage) → onglets sur les champs textuels
  - `Extras.tsx` → name + description
  - `Faqs.tsx` → déjà multilingue, on ajoute juste un bouton "Auto-traduire les manquantes"
  - `Programmes.tsx`, `Articles.tsx`, `Pages.tsx`, `Frontend.tsx` → onglets sur les champs textuels

## 5. Frontend (site public)

- Hook `useTranslatedRow(table, row, fields)` : pour la langue courante (`i18n.language`), récupère depuis `content_translations` (cache React Query par `(table, lang)`) et merge avec FR (fallback si vide).
- Adapter les hooks de fetch existants (`useExtras`, pages voyages, FAQ, articles, programmes) pour appliquer la traduction côté client.
- RTL : déjà géré au niveau du wrapper i18n ? Vérifier `src/i18n/index.ts` et au minimum poser `<html dir="rtl">` quand `lang === 'ar'`. Ajouter classe Tailwind `rtl:` au besoin sur Header/Footer/Layout.

## 6. Garde-fous

- Aucune colonne supprimée. Le FR reste la source canonique, slugs et SEO FR inchangés.
- Backfill idempotent (skip si traduction non vide existe déjà sauf si l'utilisateur clique "Régénérer").
- Anti-spam : rate-limit côté edge function (max 25 items/appel, max 100 appels/min par IP).

## Fichiers

- Migration SQL (table + RLS + index).
- `supabase/functions/translate-content/index.ts` (+ entrée dans `supabase/config.toml`).
- `src/lib/translations.ts` — helpers client (get/set, hash, bulk).
- `src/admin/components/TranslationTabs.tsx` — onglets FR/EN/AR réutilisables.
- `src/admin/components/TranslationStatusBadge.tsx`.
- `src/admin/pages/Translations.tsx` — page backfill globale + route admin.
- Adaptations : `src/admin/pages/Trips.tsx`, `Extras.tsx`, `Faqs.tsx`, `Programmes.tsx`, `Articles.tsx`, `Pages.tsx`, `Frontend.tsx`.
- `src/hooks/useTranslated.ts` — hook frontend.
- Adaptations frontend : `pages/Trips.tsx`, `pages/Faq.tsx`, `pages/Experiences.tsx`, `pages/Programme.tsx`, `pages/Blog.tsx`, `pages/BlogPost.tsx`.
- `src/i18n/index.ts` — direction RTL pour AR.
- `src/admin/components/AdminLayout.tsx` — entrée menu "Traductions".

## Livraison en 2 étapes

**Étape A (cette session)** :
1. Migration `content_translations` + RLS.
2. Edge function `translate-content`.
3. Helpers `src/lib/translations.ts` + `useTranslated`.
4. Composants `TranslationTabs` + `TranslationStatusBadge`.
5. Page admin `/admin/translations` (backfill global) avec progress.
6. RTL pour AR.
7. Application au site public (lecture avec fallback) sur trips, extras, faqs, programmes, articles, pages.

**Étape B (suite, sur demande)** :
- Onglets FR/EN/AR intégrés à chaque écran d'édition (Trips, Extras, etc.).
- Édition manuelle inline avec bouton "Régénérer ce champ".

L'Étape A donne immédiatement un site multilingue complet sans saisie manuelle. L'Étape B améliore l'édition fine.

## Coût / temps

- ~1 appel IA par champ × ~2 langues × volume actuel. Modèle `gemini-2.5-flash` rapide et bon marché. Backfill estimé < 2 min pour le volume actuel du site.
