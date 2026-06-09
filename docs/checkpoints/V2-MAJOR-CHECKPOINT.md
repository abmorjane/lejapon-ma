# V2 Major Checkpoint - before Japan Office Supplier Module

Date: 2026-06-09

This checkpoint records the stabilized V2 baseline before new Japan Office supplier development continues. It is intended as a restore point for production, staging, and future module work.

## Core Modules Completed

- CRM: client list, client profile editing, import/export support, passport scan helper, professional situation fields, client history, and booking links.
- Clients: structured contact fields, passport fields, OCR-assisted entry, address/city storage when supported, and role-aware sales/admin access.
- Reservations: public booking flow, admin booking detail, agency reservation visibility, payments, quote adjustments, receipts, confirmation PDFs, participants, rooms, hotel allocation, and operations tabs.
- Agency Portal: agency login, onboarding, reservations, editable requests, trip/programme/hotel libraries, commission visibility, agency profile, logo management, and agency-branded PDFs.
- Visa Portal: visa client signup, authenticated visa form, passport lookup/prefill, OCR scanner, checklist/procuration generation, document upload, client downloads, and admin visa management.
- OCR: `passport-ocr` Edge Function, CRM scanner, Visa form scanner, Moroccan passport visual/MRZ parsing, and safe metadata mapping.
- PDF Generation: programme PDFs, trip/quote PDFs, payment receipts, travel confirmations, visa official PDF, visa checklist PDF, and procuration PDF.
- Payment Receipts: admin and agency payment receipt generation with direct and agency branding paths.
- Travel Confirmations: booking confirmation PDF generation with agency stamp placement support.
- Translation System: admin translations coverage for trips, programmes, activities, FAQ, blog, pages, hotels, visa configuration, agency-facing content, and reusable public/business content.
- Homepage V2: conversion sections, comparison block, Google reviews CTA, Omotenashi messaging, mascot responsiveness, responsive hero image optimization, popup lead capture, and analytics events.
- Trip Management: trip catalog, departures, operations tabs, participants, rooms, extras, payments, hotel stays, supplier costs entry points, and international payment files.
- Hotels: admin hotel catalog, image upload support, public `/hotels`, agency hotel read-only catalog, and translation-ready descriptions.
- Programs: programme management, day content normalization, compact print/export support, public and agency views.
- Activities: extras/activities catalog, booking extras, agency display, operations aggregation, and supplier-facing activity quantities.
- Agencies: organizations, agency members, onboarding cases, partner documents, commission rules, agency settings, profile branding, and admin organization management.
- Email Templates: admin-managed transactional templates, email settings, email logs, template rendering helpers, and cleaned LeJapon.ma/Moroccan Express branding.
- Marketing and Analytics: GA4, Microsoft Clarity, public conversion event tracking, marketing campaigns, segments, templates, and unsubscribe route.
- Backups: admin backup tooling and storage/database manifest support.

## Edge Functions

- `admin-users`: manages admin-created users, role assignment, external/agency/supplier user provisioning, and password reset helpers. Deployment status: required in Supabase for admin user management.
- `convert-partner-request`: converts partner onboarding requests into organizations/users. Deployment status: required for partner approval workflow.
- `crm-export`: exports CRM data for authorized staff. Deployment status: required for CRM export action.
- `lookup-visa-prefill`: service-role passport lookup for visa prefill without exposing CRM tables. Deployment status: required for visa passport prefill.
- `passport-ocr`: reads passport uploads from storage and returns parsed OCR/MRZ fields. Deployment status: required for CRM and Visa scanner.
- `process-marketing-queue`: processes queued marketing campaign emails. Deployment status: required for campaign sending.
- `recaptcha`: exposes/verifies recaptcha configuration. Deployment status: required where recaptcha is enabled.
- `send-admin-notification`: sends rich booking/payment/agency/admin notifications and template test emails. Deployment status: required for internal transactional emails.
- `send-contact-email`: sends contact form notifications with recaptcha validation. Deployment status: required for public contact notifications.
- `send-marketing-campaign`: starts marketing campaign sending and test sends. Deployment status: required for marketing campaigns.
- `send-visa-email`: sends visa status emails through the email template system. Deployment status: required for visa client/admin notifications.
- `send-visa-reminders`: sends visa reminder emails for pending documents. Deployment status: required if reminders are scheduled.
- `track-email-open`: records marketing/email open events. Deployment status: required for email analytics pixels.
- `translate-content`: generates EN/AR translations through Lovable translation API. Deployment status: required for admin translation generation.
- `visa-client-signup`: creates visa client accounts and sends branded welcome emails. Deployment status: required for `/formulaire-visa/login` signup.

## Storage Buckets

- `media`: public media, agency logos, trip/admin images where reused.
- `visa-docs`: private visa documents, generated visa PDFs, checklist PDFs, procurations, and visa passport scans.
- `passports`: private CRM/admin passport scan uploads.
- `booking-docs`: booking PDFs and generated booking documents.
- `programme-pdfs`: public programme PDF exports.
- `programme-images`: public programme hero/day images.
- `article-images`: public blog/article images.
- `partner-onboarding`: private partner onboarding documents.
- `trip-message-attachments`: trip communication center attachments.
- `trip-documents`: operational trip document center files.
- `international-payments`: private international payment files, invoices, contracts, tickets, payment proofs, and subrogations.
- `hotel-images`: hotel catalog images if the environment uses the dedicated hotel bucket. If not present, use `media` or apply the hotel image storage migration/policy.

## Environment Variables

Frontend:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_SUPABASE_PROJECT_ID`
- `VITE_ENABLE_RECAPTCHA`
- `VITE_GA_MEASUREMENT_ID`
- `VITE_CLARITY_PROJECT_ID`

Edge Functions / Supabase secrets:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SITE_URL`
- `PUBLIC_SITE_URL`
- `ADMIN_BASE_URL`
- `ADMIN_NOTIFICATION_EMAIL`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM`
- `OCR_API_URL`
- `OCR_API_KEY`
- `OCR_DEBUG_RAW_TEXT`
- `RECAPTCHA_SITE_KEY`
- `RECAPTCHA_SECRET_KEY`
- `LOVABLE_API_KEY`
- `MARKETING_BATCH_SIZE`
- `VISA_SIGNUP_ALLOWED_ORIGINS`

SMTP can also be provided through the `email_settings` table where the relevant Edge Function reads active settings.

## SQL Migrations

Applied/tracked in this repository:

- Base schema migrations from `20260422170952_...sql` through `20260513180754_...sql`.
- `20260519090000_admin_email_logs.sql`
- `20260519093000_passport_ocr_admin.sql`
- `20260519101500_fix_passports_bucket.sql`
- `20260519103000_email_logs_internal_notifications.sql`
- `20260520120000_fix_clients_schema_frontend_alignment.sql`
- `20260520143000_add_client_personal_admin_fields.sql`
- `20260520150000_secure_crm_export_logs.sql`
- `20260520162000_add_crm_import_client_columns.sql`
- `20260526090000_v101_visa_trip_defaults_and_ocr_manager.sql`
- `20260526093000_v101_travel_docs_flights_hotels.sql`
- `20260526103000_agency_settings_public_read.sql`
- `20260526113000_admin_backup_logs.sql`
- `20260529090000_v2_commission_engine_v1.sql`
- `20260605090000_email_templates_runtime_integration.sql`
- `20260606120000_email_templates_schema_test_fix.sql`
- `20260606150000_trip_communication_center.sql`
- `20260606153000_trip_document_center.sql`
- `20260606154500_supplier_validation_workflow.sql`
- `20260608153000_international_payments_v1.sql`

Pending per environment:

- None confirmed from local code inspection. Each staging/production database should still verify migration history before deployment.

Deprecated:

- None formally removed. Older legacy compatibility columns remain in place where migrations intentionally preserve data.

## Current Architecture

- Supabase is the system of record for public content, CRM, bookings, agency data, visa applications, emails, operations, and storage.
- React/Vite frontend serves public site, admin backoffice, agency extranet, visa client portal, and supplier/Japan office routes.
- Admin routes use module permissions from `RequireRole` and the shared auth hook.
- Agency routes use organization membership guards and organization-scoped data.
- Visa prefill uses service-role Edge Functions for passport lookup, avoiding direct client reads of CRM tables.
- Passport OCR stores files in controlled buckets and returns only parsed fields to the user interface.
- Transactional emails use `email_templates` where available, with production-safe LeJapon.ma fallback rendering.
- PDFs are generated in frontend libraries and uploaded to storage where persistence is needed.
- Analytics helpers load GA4 and Clarity only when IDs exist and avoid personal data in event payloads.

## Stabilization Cleanup

- Removed the temporary supplier quote engine SQL diagnostic panel.
- Confirmed no `SOURCE_DEBUG`, `FRONTEND_DEBUG`, `ADMIN_BUILD_VERSION`, `FRONTEND_BUILD_visa-email-debug`, or `console.log` markers remain in `src` or `supabase/functions`.
- Kept production-safe error messages, validation messages, audit history, activity logs, admin logs, and server error logging.

## Known Issues After V2 Checkpoint

- None confirmed in local build at checkpoint creation time.

Items still requiring manual staging verification are deployment checks, not confirmed bugs:

- Supabase migration history matches the repository.
- Required storage buckets and policies exist in staging/production.
- Changed Edge Functions are deployed from the current repository.
- Email templates in the database match current transactional keys.
