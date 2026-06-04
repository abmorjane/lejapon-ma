# V2 Major Checkpoint - before Japan Office supplier module

Date: 2026-06-04

## Completed modules

- V2 external users stabilized around `organization_members`, `organization_member_profiles`, and `organizations`.
- Agency onboarding stabilized around `partner_onboarding_cases.form_data` and `partner_onboarding_documents`.
- Admin organization validation drawer reads submitted onboarding data and documents.
- Commission Engine V1 uses canonical `commission_engine_rules` columns and computed frontend labels.
- Agency booking requests/reservations support trip-based requests, extras, commission preview, payment metadata, quote adjustments, and unified admin visibility.
- Admin bookings/reservations show public/admin bookings and agency reservations in one list.
- Agency portal includes reservations, profile, onboarding, trips, programmes, hotels, commissions, and PDF actions.
- Agency logo management persists in organization metadata and is used by agency-issued PDFs.
- Hotels catalog foundation exists for admin, agency, and public display.
- Custom programmes support admin-only/public visibility, trip linkage, duplication, archive/delete safeguards, and dynamic visa programme PDFs.
- Visa flow includes client signup edge function, passport lookup/prefill, OCR scanner UI, procuration PDF, checklist PDF, stricter validation, admin editability, and official PDF date/field fixes.
- CRM client forms include passport OCR enrichment and professional situation fields.
- Transactional email templates for booking/payment/visa have richer branded payloads.
- Public homepage conversion sections, promotional pricing fields, lead popup, and hero mascot responsiveness were added.
- Admin theme switcher and premium-dashboard theme shell were added.
- Disaster recovery pack docs/artifacts were generated earlier in V2.

## Remaining known bugs / watch list

- Verify staging RLS for agency logo metadata updates and storage writes under `media/{organization_id}/branding/*`.
- Verify `passport-ocr`, `lookup-visa-prefill`, `visa-client-signup`, and `send-admin-notification` are redeployed after this checkpoint.
- Verify CRM passport lookup behavior with real RLS in staging because direct client reads may be blocked and should fall back to secure lookup.
- Verify all new hotel image upload/storage policies on staging if `hotel-images` or `media` policies differ.
- Verify agency reservation audit/history persistence if metadata is used instead of a dedicated audit table.
- Verify quote/receipt PDFs with and without agency logo, with private/public storage behavior.
- Verify Japanese visa official PDF visually after any template or coordinate changes.

## SQL migrations applied / expected V2 schema

- `organization_member_profiles`
- `organization_members.metadata`
- `partner_onboarding_cases.form_data`, `submitted_at`, `reviewed_at`, `reviewed_by`, `review_notes`
- `partner_onboarding_documents`
- `commission_engine_rules`
- `agency_booking_requests`
- `bookings.quote_adjustments` or `bookings.metadata.quote_adjustments`
- Visa linked fields where applied: linked participant/client references and checklist/procuration metadata support
- Trip promo fields: `original_price`, `promotional_price`/current price, promo label/active fields where applied
- Hotels catalog table/columns where applied
- Storage buckets/policies for passports, visa documents, media/hotel/agency assets where applied

All production SQL should remain idempotent: `create table if not exists`, `add column if not exists`, safe policies with `drop policy if exists`, and `notify pgrst, 'reload schema'`.

## Edge functions deployed / changed in V2

- `admin-users`
- `convert-partner-request`
- `passport-ocr`
- `lookup-visa-prefill`
- `visa-client-signup`
- `send-visa-email`
- `send-admin-notification`
- `send-contact-email`
- `send-visa-reminders`

## Required redeploys before production

- Redeploy changed Edge Functions from this checkpoint:
  - `admin-users`
  - `convert-partner-request`
  - `passport-ocr`
  - `lookup-visa-prefill`
  - `send-admin-notification`
  - `send-contact-email`
- Redeploy frontend build to staging/production after `npm run build` succeeds.
- Refresh Supabase schema cache after final SQL migrations.

## Environment variables

Frontend:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- Any public site URL / admin URL variables used by email links

Edge Functions:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- SMTP configuration from `email_settings` and/or secrets:
  - SMTP host
  - SMTP port
  - SMTP user
  - SMTP password
  - SMTP from email/name
  - reply-to where configured
- `OCR_API_URL`
- OCR provider credentials if required by the external OCR service
- Recaptcha secrets where used by contact/lead forms

## Current architecture

- Supabase remains the system of record.
- Public site reads public trips, programmes, hotels, homepage content, popups, FAQs, blog, and reusable marketing data.
- Admin backoffice manages bookings, CRM clients, trips, programmes, hotels, organizations, agency onboarding, commission rules, users, translations, backups, email settings/logs, visa dossiers, and payments.
- Agency extranet reads organization-scoped data through `organization_members` and `organization_member_profiles`.
- Agency reservations are stored as `agency_booking_requests` until explicitly converted to real bookings.
- Partner onboarding is stored in `partner_onboarding_cases.form_data` with documents in `partner_onboarding_documents`.
- Agency branding is stored in `organizations.metadata` and used by quote/receipt PDF builders when the reservation source is agency.
- Visa client signup uses a custom Edge Function instead of Supabase default confirmation email.
- Passport lookup should use secure RPC/Edge Function flows to avoid exposing CRM/passport data through client-side RLS holes.
- PDFs are generated client-side in frontend libraries where currently implemented, with Supabase Storage used for uploaded/generated assets where applicable.

## Stabilization cleanup

- Visible debug/diagnostic panels removed.
- Temporary raw JSON accordions removed from admin/agency screens.
- Temporary console diagnostics removed from frontend and changed Edge Functions.
- Production-safe user-facing errors and server warnings remain.
