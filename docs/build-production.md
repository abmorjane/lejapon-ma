# Build de production LeJapon.ma

Le fichier `.env` reste local et ignoré par Git. `.env.example` documente les noms des variables, **pas** leurs valeurs de production. Fournir les valeurs réelles par un environnement de build contrôlé ou un gestionnaire de secrets ; ne jamais placer de clé serveur ou `service_role` dans une variable `VITE_*`.

Avant `vite build`, `npm run build` **et** `npm run build:vite` exécutent `scripts/validate-build-env.mjs`. Il refuse une variable manquante, un placeholder, un autre projet Supabase ou une clé `sb_secret_`, sans afficher la clé publique.

Variables Supabase requises pour ce déploiement :

- `VITE_SUPABASE_PROJECT_ID=nkovgpzspprmmhorwaxl`
- `VITE_SUPABASE_URL=https://nkovgpzspprmmhorwaxl.supabase.co`
- `VITE_SUPABASE_PUBLISHABLE_KEY` : clé **publique réelle** du même projet, injectée au build.

Configuration marketing du premier déploiement :

- `VITE_MARKETING_TRACKING_ENABLED=false`
- `VITE_GA_MEASUREMENT_ID=G-RN0Y6FTMQF`
- `VITE_CLARITY_PROJECT_ID=x1qyez2dwm`
- `VITE_META_PIXEL_ID=2129665337343090`

Exécuter `npm run build`, puis contrôler `dist/sitemap.xml`, les 42 routes prérendues, les HTML et l'initialisation réelle dans un navigateur. Seul `dist/` complet doit être archivé. Un ZIP valide ne prouve pas qu'il est le bundle effectivement servi : comparer aussi les noms des assets en production après déploiement et purger les caches du serveur/CDN si nécessaire.

Ne pas passer le flag marketing à `true` tant que la stratégie de consentement n'est pas approuvée. Ne pas déployer la PR CMP avec ce hotfix ; sa migration de consentement suit un ordre de déploiement distinct.
