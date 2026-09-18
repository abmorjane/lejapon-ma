# LeJapon.ma Messages/Documents implementation — 18 September 2026

Status: implemented and verified locally; **not deployed to production**.
Target project: `nxnncbddtpjusrnhilxk`.

## 1. Current production audit

Reviewed the complete supplied `query-results-export-2026-09-18_01-49-29.csv`.
It contains the read-only audit dated `2026-09-17T23:49:28.227293Z`, SQL Editor user `postgres`.
The project reference in the export is an expected-project label; project selection comes from the
user-provided LeJapon.ma SQL Editor export and the independently checked LeJapon.ma API URL.

| Object | Audited production state |
| --- | --- |
| `public.trip_messages` | Absent; no columns, indexes, policies or triggers |
| `public.trip_message_attachments` | Absent; no columns, indexes, policies or triggers |
| `public.trip_message_reads` | Absent; no columns, indexes, policies or triggers |
| `public.trip_documents` | Absent, including `supplier_visible` |
| `trip-message-attachments` bucket | Absent |
| `trip-documents` bucket | Absent |
| `storage.objects` / `storage.buckets` | Present; RLS enabled |
| Existing group-trip file write policies | Five present; explicitly authenticated, owner checks and `supplier_can_edit_trip` |
| `supplier read authorized trip document files` | Present; uses existing document visibility helper |
| Supplier FIT document read/upload policies | Present on the shared document bucket, but targeted PUBLIC |
| Current public trips supplier read policy | Explicitly authenticated; remains unchanged |

The missing backend objects explain the current migration-required UI warnings. This is confirmed
absence from the targeted audit, not inferred from the earlier supplier quote export.

Existing access helpers are present. Authenticated and service-role callers can execute
`supplier_can_access_trip`, `supplier_can_edit_trip` and `supplier_can_access_trip_document_file`;
anon cannot. `is_staff` is executable by those roles, including anon, and rejects a null actor.
The archive guard has direct authenticated/anon EXECUTE revoked, as intended for a trigger function.

The document file helper already enforces undeleted document metadata, `supplier_visible OR
uploaded_by = caller`, and assigned-trip access. It is preserved verbatim. Its dynamic lookup safely
returns false while the document table is absent. Both Storage ownership fields exist in the export:
legacy `owner uuid` and current `owner_id text`.

All audited Storage policies were reviewed for bucket scope. Existing unrelated permissive policies
are constrained to their other named buckets; the two FIT policies use `fit/...` paths and do not
match group-trip UUID paths. No unrelated policy is replaced.

## 2. New migration and objects

**One new migration:**
`supabase/migrations/20260917235053_trip_messages_documents_current_security.sql`

Created through the installed Supabase CLI's `migration new` command after audit review. The entire
file is transactional (`BEGIN` / `COMMIT`), with a five-second lock timeout and a 120-second statement
timeout. Neither historical communication/document migration is replayed.

The migration creates/completes all four tables, their canonical UUID keys and parent references,
frontend columns, valid category/type checks and lookup indexes. Documents have all twenty requested
columns, including `supplier_visible boolean NOT NULL DEFAULT true`. Existing visibility values,
file URLs, metadata, owner fields and version values are not rewritten.

Message types remain `general`, `hotel`, `transport`, `activities`, `guides`, `urgent`.
Document categories remain `hotel_vouchers`, `transport_vouchers`, `guide_confirmations`,
`flight_tickets`, `rooming_lists`, `emergency_contacts`, `contracts`, `other`.

It creates two SECURITY INVOKER trigger functions with pinned search paths and no direct
PUBLIC/anon/authenticated EXECUTE:

- `trip_centers_touch_updated_at()`: shared timestamp trigger for messages/documents.
- `guard_trip_center_supplier_identity()`: prevents suppliers from changing existing IDs, trip/quote
  associations, message parents, senders, sender source, uploaders or receipt owners. Staff retains
  current management behavior.

The existing `guard_archived_trip_supplier_writes()` is attached to INSERT/UPDATE/DELETE on all four
module tables without changing its definition or privileges. Existing same-name guards are reattached
and enabled. Known timestamp triggers are normalized. Other existing triggers are retained.

Idempotence includes missing-table/column/key/index handling, repeatable policy/trigger installation
and bucket upserts. Existing compatible partial records are preserved. Incompatible types, keys,
required-null data, invalid categories or foreign references abort the transaction instead of casting,
deleting or inventing values. Unreviewed module-table or explicitly target-bucket Storage policies
cause an explicit refusal; custom protections are not silently removed. This is deliberate safe
failure for unsupported drift, not automatic repair of arbitrary schemas.

## 3. Row policies and grants

All module policies explicitly target `authenticated`, including staff policies. PUBLIC/anon table
and column grants are revoked, including inherited historical default grants. Authenticated receives
only SELECT/INSERT/UPDATE/DELETE, with RLS determining supplier versus staff rights.

| Table | Supplier READ | Supplier WRITE |
| --- | --- | --- |
| Messages | Undeleted messages on assigned trips via read helper, including archived trips | Own sender ID, supplier/Japan sender source, editable trip; update own messages only; no supplier hard-delete policy |
| Attachments | Parent message readable and undeleted | Own uploader and own parent message; editable trip; file registration checks trip/message path and actual Storage ownership; own update/delete |
| Reads | Own receipts with readable parent message, including historical receipts | Own user ID, parent on editable trip; explicit INSERT/UPDATE/DELETE policies |
| Documents | Assigned-trip undeleted supplier-visible documents, or uploader's own metadata | Own uploader on editable trip; valid trip-prefixed file and owned Storage object; INSERT and UPDATE, including soft deletion |

Staff ALL policies use only the current `is_staff(auth.uid())` helper. Supplier UPDATE uses both USING
and WITH CHECK. Suppliers cannot claim a staff-only file by inserting a new metadata record pointing
to it. Archived-trip write restrictions apply regardless of quote version status.

The document owner keeps SELECT access to their own soft-deleted metadata so PostgreSQL can validate
soft-delete UPDATE/RETURNING. The existing frontend explicitly filters `deleted_at IS NULL`; other
suppliers cannot read deleted records, and archived deleted files do not become readable through the
registered-document file helper. Supplier document hard deletion is not granted by an RLS policy.

## 4. Storage policies

Both buckets are private. New default limits are 10 MiB for message attachments and 50 MiB for
documents. Existing custom limits, names and MIME restrictions are retained; an existing public bucket
is corrected to private.

- Staff management uses `is_staff` and explicitly targets authenticated.
- Group-trip supplier file uploads/updates/deletes require an editable assigned trip and actual
  object ownership. UUID parsing is guarded by CASE before casting.
- Ownership uses `COALESCE(owner_id, owner::text) = auth.uid()::text`: current owner_id is authoritative,
  with a fallback for legacy objects. This follows the current ownership column documented by
  [Supabase](https://supabase.com/docs/guides/storage/security/ownership).
- Registered document reads retain `supplier_can_access_trip_document_file`, including document
  visibility and historical assigned-trip access.
- A separate authenticated policy lets only an owner read their own uploads on an editable trip
  before metadata registration; uploads precede metadata INSERT in the existing frontend.
- Message file reads resolve the readable parent message from the existing trip/message path and
  use the read helper. Owner access to pending uploads requires the edit helper. The read policy
  avoids querying the attachment table, preventing recursive RLS during attachment registration.
- The historical folder-only document SELECT policy is removed if present so it cannot bypass
  `supplier_visible` checks through permissive-policy OR behavior.
- A scoped restrictive policy denies anon all operations on the two private buckets while leaving
  unrelated buckets' existing permissions unchanged.

The five existing archived-trip write protections are retained in the replacement policy predicates;
owner_id compatibility does not remove ownership or `supplier_can_edit_trip` checks. Message-file
UPDATE is also covered. Storage's own audited deletion-protection triggers are not modified.

The two existing FIT policies on the shared `trip-documents` bucket receive **only**
`ALTER POLICY ... TO authenticated`. Their predicates, paths and request authorization are unchanged.
No FIT tables, UI, helpers or financial rules are changed. No new policy uses legacy `v2_*` helpers.

## 5. Frontend changes

Only `src/admin/pages/supplier/SupplierTripCosts.tsx` application code changes:

- Show/log actual message, attachment, receipt, document and private-file signing errors, with retry.
- Suppress successful-empty result counts/messages while a load error is present.
- Preserve migration-required warnings for missing tables; successful retry clears them naturally.
- Skip supplier receipt writes on archived trips while loading historical messages and signed files.
- Check UPDATE/RETURNING results for document replacement/soft deletion; zero rows is not success.
- Save replacement metadata before removing the old file; a rejected update preserves the old file.
- Soft-delete metadata before requesting file removal; failed metadata writes do not delete a file.
- Report file-removal failures explicitly rather than silently ignoring them. A successful metadata
  update remains saved and the failed-to-remove file remains intact.

Messages/Documents layout, categories, filters and operational functionality remain in place.
Supplier quote prices, Excel parsing/import/versioning and public frontend pages are unchanged.

## 6. Tests and regression results

All database write tests used disposable PostgreSQL 17 containers with no network, host ports or
workspace mounts. Synthetic quote versions and financial rows are fixtures, not production data.
No quote-save/import/version-creation RPC is invoked by the new database tests. Tests roll back.

- **69 SQL assertions passed**: all six message types/eight document categories, active reads/writes,
  sender/uploader/receipt ownership, forged metadata/file ownership rejection, Supplier A/B isolation,
  hidden staff document/file privacy, modern owner_id uploads, legacy shared FIT upload/read,
  archived reads, rejection of INSERT/UPDATE/DELETE/receipt upsert and file writes, malformed paths,
  staff reads/writes including archive, anon module rows/files denied, unrelated public assets/trips.
- Archive guards independently reject writes on all four tables even under temporary permissive
  test policies. Those policies are confined to the rolled-back synthetic test transaction.
- Nonempty compatible partial deployment succeeds: historical message/document values and metadata
  preserved, missing columns completed, custom bucket configuration retained, PUBLIC/anon column
  grants repaired, all four archive triggers attached.
- Repeated migration application preserves full existing message/document JSON, including added
  timestamps/defaults; no duplicate versions or row rewrites.
- Incompatible-column and unreviewed row-policy fixtures refuse migration. Assertions confirm the
  transaction leaves no partial new tables/columns and preserves bucket and quote data.
- Unreviewed target-bucket Storage policy also causes explicit preflight refusal.
- Existing supplier frontend tests: **45 passed, one skipped**. New Messages/Documents integration
  tests: **10 passed**, including error visibility/retry, archived file/message rendering without
  receipt writes, receipt failures, and old-file preservation on rejected document mutations.
- `npm run build`: **passed**; existing bundle-size warning. `git diff --check`: passed.
- Live **read-only anonymous** LeJapon.ma catalogue and homepage queries: HTTP 200, three rows each.
- Live anonymous quote header/all five financial category queries: HTTP 401/Postgres 42501 denied.
- All synthetic V1/V2/V3/V4/B quote fields and financial row JSON remain identical. Synthetic V3
  retains hotels 20, transport 20, activities 19, guides 11, other 1: **71 before / 71 after**.
- Existing public trips and financial RLS policy snapshots remain identical after the new migration.
  FIT policy predicates remain identical; only their role target changes.

The local Storage tests verify PostgreSQL object access policies and bucket privacy; they do not
replace an end-to-end Storage API test with real Auth sessions. Live authenticated browser/Storage
smoke tests remain pending deployment to an authorized LeJapon.ma staging environment. Production
currently lacks these backend objects and was not changed, so no claim of post-deployment production
UI or file-API verification is made. The disposable local databases are removed after testing.

## 7. Files changed

- `supabase/migrations/20260917235053_trip_messages_documents_current_security.sql` — one new migration.
- `src/admin/pages/supplier/SupplierTripCosts.tsx` — scoped load/error/archive/mutation fixes.
- `src/admin/pages/supplier/SupplierTripCosts.messages-documents.test.tsx` — new integration tests.
- `scripts/tests/trip-centers-fixture-from-audits.py` — local-only fixture builder from both exports.
- `supabase/tests/trip_messages_documents.sql` — rolled-back synthetic authorization tests.
- `supabase/tests/fixtures/trip_centers_partial_synthetic.sql` — partial-history synthetic fixture.
- `supabase/tests/trip_messages_documents_partial.sql` — partial preservation/privacy checks.
- `supabase/diagnostics/20260918_trip_messages_documents_schema_audit.sql` — read-only audit, prepared
  in the preceding audit step and already executed manually by the user.
- This report — updated with the actual audit and final implementation.

Pre-existing `dist.zip` modifications and supplier-quote transactional migration are excluded from
this change. No historical migration was modified. No production schema, policies, quote/version,
financial row, message, document or file was changed or deleted. No production Excel import or new
quote version was created. Moroccan Express Travel OS was not accessed or modified.

## 8. Exact deployment instructions — manual, not executed

1. Validate in an authorized **LeJapon.ma staging environment** using test supplier/admin accounts.
   Do not target Moroccan Express Travel OS. Test active upload/send/replace/delete, archived read
   and rejected writes, Supplier A/B isolation, staff, anon rows/private file download, and public
   catalogue. Use synthetic test content; no Excel import or production quote/version creation.
2. In Supabase, select **LeJapon.ma**, project `nxnncbddtpjusrnhilxk`, and open SQL Editor as the project
   database administrator. Paste/run the **entire single file**
   `supabase/migrations/20260917235053_trip_messages_documents_current_security.sql`, including its
   BEGIN/COMMIT. Do not run either 20260606 historical migration or a bulk `supabase db push` that
   could replay unrelated unapplied historical migrations. Expected missing-object NOTICE messages
   are harmless; an ERROR means installation failed and the transaction must not be treated as applied.
3. Re-run the complete read-only diagnostic
   `supabase/diagnostics/20260918_trip_messages_documents_schema_audit.sql`. Confirm four existing
   module tables with RLS enabled; all requested columns; four enabled archive guards; module/staff/
   supplier policies explicitly authenticated; supplier read helpers deny anon EXECUTE; both target
   buckets exist and are private. Confirm public trips policy definitions did not change.
4. Build the reviewed frontend with `npm run build` and deploy the complete freshly generated
   `dist/` through the existing LeJapon.ma hosting release process. No automatic deployment is
   included here. No Supabase secrets belong in the frontend build.
5. Reload the authenticated supplier trip page and retry Messages/Documents if schema-cache
   propagation is still pending. The migration notifies PostgREST to reload after commit. The missing
   migration warnings should clear on a successful backend read. Inspect any remaining real error;
   do not hide the warning or normalize failed reads to an empty list.
6. Verify production read-only access for existing active/archived assignments and staff, plus the
   anonymous public catalogue/homepage. Perform write/denial/file-API probes in staging, not against
   production quotes. Record the migration filename as manually applied through the established
   release tracking process; do not replay historical migrations to reconcile drift.

An interrupted/erroring migration is transactional and repeatable once the reported drift/lock issue
is reviewed. There is no rollback script that drops populated module tables or deletes existing
content. Any later corrective deployment must preserve the newly saved history and existing quotes.
