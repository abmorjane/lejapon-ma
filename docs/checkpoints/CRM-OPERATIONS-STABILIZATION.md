# CRM Operations Stabilization Checkpoint

Date: 2026-06-10

## Scope

This checkpoint captures the CRM-centered booking and operations stabilization work after the V2 major checkpoint.

## Stabilized Areas

- Admin quick action bar for internal users.
- Admin booking creation with CRM client linking/deduplication.
- Public booking submission with CRM client creation/update.
- Booking detail 360-degree client linkage.
- Booking travellers persistence and duplicate cleanup.
- Manual responsible traveller selection.
- Responsible traveller tombstone behavior using `bookings.metadata`.
- Trip operations participant synchronization from active bookings.
- Trip operations rooming copy between hotels.
- Natural numeric room ordering in admin operations and supplier exports.
- Booking documents and client profile document visibility.
- Admin quick action payment creation flow.
- International payments V2 workflow fixes for participant import and subrogation document links.
- Bureau Japon / supplier settings workflow changes.

## Files And Modules Touched

- Admin layout and quick actions.
- Booking creation and detail flows.
- CRM client helpers.
- Client profile.
- Trip operations participants and rooms.
- Supplier trip costs operational rooming/export views.
- International payments admin module and helpers.
- Visa settings Bureau Japon restructuring.
- Supabase generated type metadata for new CRM/payment fields.

## SQL Migrations Added

- `20260609100000_international_payments_v2_workflow.sql`
- `20260609113000_fix_international_payment_participant_import.sql`
- `20260609114500_fix_international_payment_document_participant_fk.sql`
- `20260610100000_crm_centered_workflow_v1.sql`
- `20260610103000_responsible_traveller_tombstone.sql`

## Database Expectations

- `bookings.client_id` links reservations to CRM clients.
- `payments.client_id` links payments to CRM clients when available.
- `visa_applications.client_id` links visa requests to CRM clients.
- `bookings.metadata` stores operational flags, including `responsible_traveller_deleted`.
- `booking_documents` supports operational document types.
- International payment participant imports use `source_participant_id` and payment-file scoped uniqueness.
- International payment generated documents reference `international_payment_participants.id`.

## Operational Behavior

- Deleting an auto responsible traveller persists and prevents respawn.
- Admin can select any existing traveller as the booking responsible.
- Duplicate traveller cleanup prefers CRM-linked records.
- Trip operations sync rebuilds participants from active bookings without recreating deliberately deleted responsible fallbacks.
- Rooming lists display rooms in natural order, including text values such as `Ch. 10`.
- Quick action `Ajouter paiement` opens a payment modal, links the selected booking/client, updates paid totals, and triggers admin notification when supported.

## Build Verification

Command:

`npm run build`

Result:

Succeeded.

Known warnings:

- Browserslist `caniuse-lite` data is outdated.
- Some production chunks exceed 500 kB after minification.

## Manual Checks Recommended

- Create an admin booking and confirm CRM client linkage.
- Submit a public booking and verify no duplicate CRM client is created for the same email/phone.
- Delete an auto responsible traveller, reload booking detail, and confirm it does not respawn.
- Select a different traveller as responsible and verify persistence after reload.
- Run Trip Operations participant sync and confirm no cancelled/deleted bookings reappear.
- Copy rooms between hotels and confirm room assignment consistency.
- Verify room ordering: `1, 2, 3, 4, 5, 6, 9, 10`.
- Use quick action `Ajouter paiement` and confirm payment appears in booking detail and client profile.
- Import international payment participants and generate subrogations.

## Checkpoint Notes

This checkpoint intentionally includes the current working tree state as requested, including CRM, operations, international payment workflow, and related SQL migrations.
