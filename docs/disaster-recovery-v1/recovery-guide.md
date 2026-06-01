# Disaster Recovery Guide V1

Generated: 2026-06-01T01:35:32.611Z

This pack recreates the LeJapon.ma Supabase backend structure from the repository state. It contains:

- `schema.sql`: local migration replay plus the current V2 compatibility layer for organizations, external member profiles, partner onboarding, partner onboarding documents, partner onboarding storage, and the stable commission engine.
- `storage-buckets.json`: required Storage buckets, public/private mode, and source references.
- `edge-functions-manifest.json`: Edge Functions, JWT mode, environment variables, source path, and source checksum.

## Files

`schema.sql` is intended for a fresh Supabase project. It includes tables, indexes, constraints, triggers, functions, RLS policies, and storage policies available in this repository. The legacy local commission-engine migration is intentionally skipped and replaced by the stable V2 Commission Engine V1 table shape used by the app.

## Recovery Steps

1. Create a fresh Supabase project.
2. Enable email/auth providers as needed in the Supabase dashboard.
3. Open SQL Editor or connect with `psql`.
4. Apply `schema.sql`.
5. Create or verify all buckets in `storage-buckets.json`.
6. Deploy all functions listed in `edge-functions-manifest.json`.
7. Set required function secrets.
8. Create the first admin user and assign `super_admin` in `public.user_roles`.
9. Configure frontend environment variables with the new project URL and anon key.
10. Run a smoke test: admin login, backup page, visa form upload, partner onboarding upload, agency commissions, and one booking flow.

## Apply Schema

From SQL editor: paste and run `schema.sql`.

From CLI/psql:

```bash
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f docs/disaster-recovery-v1/schema.sql
```

If a migration references extensions not enabled on your Supabase plan, enable them from Database > Extensions first. The schema file includes `pg_cron` and `pg_net` requests because the existing migrations require them.

## Storage Buckets

Create buckets exactly as listed in `storage-buckets.json`. Public buckets must stay public because the frontend renders public asset URLs directly. Private buckets must stay private and use signed URLs or authenticated storage access.

Important buckets:

- Public: `media`, `programme-pdfs`, `programme-images`, `article-images`
- Private: `booking-docs`, `visa-docs`, `passports`, `partner-onboarding`

## Deploy Edge Functions

For each function in `edge-functions-manifest.json`:

```bash
supabase functions deploy <function-name> --project-ref <new-project-ref>
```

The repo config sets `verify_jwt = false` only for functions listed that way in the manifest. Keep all other functions JWT-protected unless intentionally changed.

## Required Secrets

Set secrets with:

```bash
supabase secrets set KEY=value --project-ref <new-project-ref>
```

Common required secrets discovered from function source:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM`
- `ADMIN_NOTIFICATION_EMAIL`
- `ADMIN_BASE_URL` or `SITE_URL`
- `PUBLIC_SITE_URL`
- `RECAPTCHA_SITE_KEY`
- `RECAPTCHA_SECRET_KEY`
- `LOVABLE_API_KEY`
- `OCR_API_URL`
- `OCR_API_KEY`
- `OCR_DEBUG_RAW_TEXT` optional
- `MARKETING_BATCH_SIZE` optional

See `edge-functions-manifest.json` for per-function variables.

## First Super Admin

After creating the first auth user, run:

```sql
insert into public.user_roles (user_id, role)
values ('<auth-user-id>', 'super_admin')
on conflict (user_id, role) do nothing;
```

## Data Restore

This pack recreates structure. To restore data:

1. Use the latest ZIP from `/admin/backups`.
2. Import JSON/CSV table exports in dependency order.
3. Restore Storage objects to matching buckets and paths.
4. Re-run smoke tests.

For production-grade point-in-time restore, prefer Supabase PITR or a direct `pg_dump`/`pg_restore` from the source project.

## Validation Checklist

- `select public.has_role(auth.uid(), 'super_admin'::public.app_role);` compiles.
- Admin user can open `/admin/backups`.
- `public.organizations`, `public.organization_members`, `public.organization_member_profiles` exist.
- `public.partner_onboarding_cases.form_data` exists.
- `public.partner_onboarding_documents` exists.
- `public.commission_engine_rules` has `scope`, `rule_type`, `value`, `destination`, `product_type`, `trip_id`, `starts_at`, `ends_at`.
- Private storage signed URLs work for visa docs, booking docs, passports, and partner onboarding docs.
- Edge Functions deploy and return CORS preflight responses.

## Notes

This pack is generated from local repository state because direct Supabase schema dumping was unavailable in the sandboxed environment. If live database access is available, compare this pack against an authoritative dump:

```bash
supabase db dump --schema public,storage --file live-schema.sql
```

Then reconcile any production-only hotfixes before using the pack for an actual disaster recovery event.
