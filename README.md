# lejapon.ma

Site officiel de lejapon.ma — agence de voyage premium spécialisée Japon, départs depuis Casablanca.

## Stack technique

- Vite + React 18 + TypeScript
- Tailwind CSS + shadcn/ui
- React Router, React Query, i18next
- Backend : base de données managée + edge functions

## Développement

```bash
npm install
npm run dev
```

## Build de production

```bash
npm run build
```

Le dossier `dist/` peut ensuite être déployé sur n'importe quel hébergement statique (o2switch / cPanel, Netlify, Vercel, etc.).

## Supabase Storage requis

### Passeports OCR admin

La fonctionnalité `Scanner passeport` utilise un bucket Supabase Storage unique :

- Nom : `passports`
- Visibilité : privé (`public = false`)
- Accès : lecture/écriture/suppression uniquement pour les rôles `admin` et `super_admin`
- Formats : JPG, PNG, PDF

L'upload passe directement par Supabase Storage depuis une session admin authentifiée :

```ts
supabase.storage.from("passports").upload(...)
```

La lecture OCR reste déléguée à l'Edge Function `passport-ocr` après la réussite de l'upload. Le bucket doit donc exister en production et ses policies doivent autoriser uniquement les rôles `admin` et `super_admin`.

Si ce bucket n'existe pas, l'interface affiche :

```text
Bucket passports missing
```

Si les policies Storage manquent, l'interface affiche :

```text
Storage policy missing
```

Migration incluse :

```text
supabase/migrations/20260519101500_fix_passports_bucket.sql
```

SQL de référence :

```sql
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'passports',
  'passports',
  false,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'application/pdf']::text[]
)
ON CONFLICT (id) DO UPDATE
SET
  public = false,
  file_size_limit = 10485760,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'application/pdf']::text[];

CREATE POLICY "admins read passports"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'passports'
  AND (public.has_role(auth.uid(), 'super_admin') OR public.has_role(auth.uid(), 'admin'))
);

CREATE POLICY "admins upload passports"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'passports'
  AND (public.has_role(auth.uid(), 'super_admin') OR public.has_role(auth.uid(), 'admin'))
);

CREATE POLICY "admins delete passports"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'passports'
  AND (public.has_role(auth.uid(), 'super_admin') OR public.has_role(auth.uid(), 'admin'))
);
```
