# LeJapon.ma supplier quotation and handling implementation

## Evidence and current behavior audit

The user-supplied read-only catalog export `query-results-export-2026-09-17_22-47-14.csv` was reviewed **before** creating the migration. Database: `postgres`; database user: `postgres`; `transaction_read_only=on`; timestamp: `2026-09-17T20:47:12.424602+00:00`; expected project: `nxnncbddtpjusrnhilxk`. Export SHA256: `0d25acbbc9623a8c260f1a6ba3d7a52a2ba304443b572d2f810429c75a802d71`.

The export contains schema, policies, grants, indexes, constraints, triggers and function definitions. It does **not** contain production quote contents, browser sessions or production V3 row counts. No contents of the export were treated as user instructions.

Confirmed findings:

- All five quote row tables have RLS enabled. Anonymous users have no table privileges; authenticated users have SELECT but no direct INSERT/UPDATE/DELETE. The repaired row policies use authenticated quote authorization. Those policies and helpers are preserved.
- Commercial submission already uses financial-only frontend validation. The confusing operation checklist, financial row status controls and labels were still mixing the phases. The old financial save could write reservation statuses; suppliers could not update reservations through a dedicated path after approval.
- Handling was a generic Other cost, with no quote-level handling percentage, scope, base or amount. Import explicitly required a detected handling Other row.
- Live quote-header SELECT/INSERT/UPDATE policies used legacy `v2_*` predicates TO public. Their UPDATE predicates did not restrict commercial status or price fields. They are permissive in design; **a working production self-approval exploit was not demonstrated**. The pre-migration local reproduction confirms the legacy path errors on missing `supplier_members.status` referenced by `v2_user_supplier_ids`. `v2_supplier_can_access_trip` also refers to that missing column and historical `active` assignment status. These global legacy helpers are not modified.
- Supplier-returning quote RPCs removed canonical internal commission fields but retained historical `commission_percent` and `admin_notes` aliases. Their exposure was reproduced in the isolated pre-migration fixture.
- `admin_feedback` and `approved_at` are absent from the export, although the live staff review/sync functions reference them. The migration adds them without rewriting existing data.
- The assignment-sync trigger handled every version. Archiving a superseded version could cancel the supplier relationship and make historical row reads fail. The replacement ignores older versions when a newer version exists.
- The existing history panel expanded all changes. It is now collapsed, grouped and complete on demand.

## State machine

| Phase | Transition | Authorized actor | Blocking conditions |
|---|---|---|---|
| Commercial quotation | Draft → Submitted to LeJapon.ma | Supplier | Valid financial service values, positive included services total, valid handling percentage and category scope |
| Commercial quotation | Submitted / Under review → Revision requested | LeJapon.ma staff | Existing authorized review workflow |
| Commercial quotation | Submitted / Under review → Approved | LeJapon.ma staff | Positive included financial total; no passport/rooming/document/booking gate |
| Commercial quotation | Revision requested → Draft revision/version → Submitted | Supplier | Financial validation only |
| Execution after approval | To book → Booking in progress → Operationally confirmed | Authorized supplier/staff | Final execution confirmation requires included reservations to be confirmed |
| Travel preparation checklist | Preparation → Japan Office control → Ready to travel | Existing supplier/staff permissions | Operational checklist, separate from quotation |

Historical `reviewed`, `rejected` and `archived` states remain supported; no status history is rewritten. Suppliers cannot approve commercial quotations. Submitted prices remain locked until the existing revision workflow permits editing. Approved/archived financial terms are frozen; a new version preserves the parent terms.

Passports, passenger identities, rooming, vouchers and documents remain visible as operational follow-up. They do not enter quotation submission validation. Reservation status updates use separate RPCs and never save supplier prices.

## DB changes and formulas

Migration: `supabase/migrations/20260917204854_supplier_quote_phases_and_scoped_handling.sql`.

New quote columns:

- `supplier_handling_percentage`, numeric, default 0.
- `supplier_handling_categories`, text array, default empty; categories: `hotels`, `transport`, `activities`, `guides`, `other`.
- `supplier_handling_base_jpy`, numeric, calculated server-side.
- `supplier_handling_amount_jpy`, numeric, calculated server-side.
- `supplier_total_jpy`, generated from service subtotal plus handling.
- `supplier_execution_status`, `to_book` / `booking_in_progress` / `operationally_confirmed`.
- Missing review columns `admin_feedback` and `approved_at`.

Percentage must be finite and between 0 and 100. Categories must be a flat, unique array of the five permitted values, with no nulls. A positive percentage requires at least one category. Entire quote is represented by selecting all five categories, not by an assumed default.

```
services subtotal = Σ persisted service subtotals where included_in_total=true
handling base = Σ included service subtotals in selected categories only
handling amount = round(handling base × supplier_handling_percentage / 100, 2)
supplier total = services subtotal + handling amount
internal LeJapon.ma commission = supplier total × commission_percentage / 100
internal final total = supplier total + internal commission
```

`grand_total_jpy` retains its existing service-subtotal meaning. Internal commission still uses the supplier acquisition cost, including supplier handling; it remains a separate staff-only percentage. Existing line formulas and non-handling Excel mappings are preserved. Hotel quantities use the audited numeric room-count columns instead of the old incompatible integer casts.

Rows and handling-term changes refresh draft/review totals automatically. Recalculation does not rewrite approved/archived financial snapshots. Cloned versions carry their percentage, scope, base and amount; new supplier terms affect the new version only.

The migration performs **no existing quote or row backfill, DELETE or TRUNCATE during application**. Previously imported handling rows/prices/audit remain intact on old versions. An explicit positive-handling conversion on an editable version retains the legacy row and price but excludes it from the total; the fee then lives at quote level. Re-inclusion alongside positive quote-level handling is rejected. The pre-existing RPC behavior for a supplier explicitly removing an editable draft row is retained; it was not invoked against production.

Historical fee percentages remain in their original Excel audit. A scope for an old approved quote is never invented. The UI identifies legacy handling separately and preserves its original supplier total. Existing historical versions are not retrospectively remodeled.

## Policies and functions

Only legacy **quote-header** policies are dropped:

- `supplier_trip_quotes_select`
- `supplier_trip_quotes_insert`
- `supplier_trip_quotes_update`
- `supplier_trip_quotes_delete`

`staff manage supplier_trip_quotes` remains. Authenticated direct header INSERT/UPDATE/DELETE is revoked; staff and suppliers use their existing authorized RPCs. Staff SELECT remains available. Suppliers read filtered headers through getters; row reads still use the original repaired row RLS.

| Access | Before | After |
|---|---|---|
| Supplier own row reads | Repaired authenticated row policies | Same policies/helpers |
| Supplier other supplier rows | Denied by row authorization | Denied, locally verified |
| Anonymous financial reads | No grants | Same denial; no new anon financial RPC |
| Supplier direct header changes | Legacy permissive policy, currently errors on helper/schema drift | Explicitly denied by grants; commercial approval staff RPC only |
| Supplier RPC headers | Canonical commission removed, legacy aliases retained | Canonical and legacy internal fields removed |
| Staff supplier prices | RPC/UI review did not offer price edits | Same review functions, plus price-update guard |
| Superseded history | Old-version archival could cancel assignment | Latest-version sync only; historical getters/rows stay readable while assignment is authorized |

Updated audited functions:

- `supplier_save_trip_quote_v2(uuid,uuid,uuid,text,jsonb,jsonb)`
- `recalculate_supplier_quote_totals_v2(uuid)`
- `create_supplier_quote_version_v2(uuid)`
- `import_supplier_quote_excel_v1(uuid,uuid,uuid,text,text,text,jsonb,integer,jsonb)`
- `get_supplier_trip_quote(uuid,uuid)`
- `get_supplier_quote_version_v2(uuid)`
- `get_supplier_quote_versions_v2(uuid,uuid)`
- `review_supplier_quote_v2(uuid,text,text)`
- `admin_save_supplier_quote_settings_v2(uuid,numeric,numeric,text,text,text,jsonb,jsonb,numeric)`
- `save_supplier_operational_state_v2(uuid,text,text,jsonb,jsonb,numeric)`
- `sync_supplier_quote_assignment()`

The obsolete header-only financial save RPC is revoked for authenticated callers. New validation/refresh/price-guard functions and reservation/execution RPCs are declared in the migration. New write RPCs are revoked from PUBLIC/anon and granted to authenticated/service_role, with actor, quote and whitelist checks. Trigger functions are not directly executable by application users.

Preflight checks compare exact audited function definitions, helper definitions, EXECUTE permissions and financial-table policies; they also verify RLS and anonymous grant denial. Deployment stops on drift rather than replacing an unexpected live definition. No public trips policy or supplier row policy is altered.

## Excel and frontend changes

Handling detection keeps the source amount and prefers explicit percentages/formulas over a ratio so mismatches remain detectable. Handling no longer produces a service payload. The preview enumerates category combinations and suggests a scope only if one combination matches to the calculation precision. Ambiguous scope stays unset and displays `Handling scope: confirmation required`. Even an inferred scope requires supplier confirmation.

The preview shows source and projected amounts separately. A handling discrepancy exceeding 0.01 JPY requires explicit acknowledgment; PostgreSQL repeats the check and rejects an unacknowledged discrepancy atomically. Changing an ambiguous service decision clears any prior discrepancy acknowledgment. Metadata preserves original source rows, source percentage/formula/origin, suggested scope, confirmed terms, acknowledgment and server reconciliation. Financial and operational saves retain the original Excel audit.

The quote form exposes handling controls to editable supplier versions only. Admin reviews the terms read-only and uses comments/revision requests. Reservation controls after approval call dedicated status RPCs. Checklist text distinguishes reservations, travel preparation and commercial approval. History is collapsed by default with summary counts and expandable category groups, including handling changes. It compares against the actual parent version number and retains every existing generated detail.

Existing section-load error handling remains: a failed read is unavailable, not zero rows; writes/import are blocked while reads are incomplete. If an existing quote header lacks the new handling fields, supplier edits/import are disabled while rows remain visible. Deploy the DB before the frontend.

Business-model files added/changed:

- `src/admin/pages/supplier/SupplierTripCosts.tsx`
- `src/admin/pages/supplier/SupplierQuoteExcelImportDialog.tsx`
- `src/admin/pages/supplier/SupplierHandlingFields.tsx`
- `src/admin/pages/supplier/SupplierQuoteVersionHistory.tsx`
- `src/admin/lib/supplier-quote-business-model.ts`
- `src/admin/lib/supplier-quote-excel-import.ts`
- `src/admin/lib/supplier-quote-business-model.test.ts`
- `src/admin/lib/supplier-quote-excel-import.test.ts`
- `src/admin/pages/supplier/SupplierTripCosts.test.tsx`
- `src/admin/pages/supplier/SupplierHandlingFields.test.tsx`
- `supabase/migrations/20260917204854_supplier_quote_phases_and_scoped_handling.sql`
- `supabase/tests/supplier_quote_business_model.sql`
- `supabase/tests/fixtures/supplier_quote_synthetic_seed.sql`
- `scripts/tests/supplier-quote-fixture-from-audit.py`
- This audit/deployment report.

The already-existing repaired section loader is retained as a dependency. Other staged workspace changes, older migrations, public catalogue code and Moroccan Express modules were not modified by this business-model implementation.

## Tests and regression results

An isolated PostgreSQL 17.6 container was initialized with `--network none`, no published ports, no host mounts and no production data. Exact audited quote columns/constraints/policies/functions/grants were loaded. Dependencies outside the quote audit and V1–V4 data are explicitly synthetic fixtures. Tests run in a transaction and roll back.

- Migration applies successfully with its function/policy/grant preflight checks.
- **57 SQL assertions pass:** original quote/row preservation; five category reads; V1–V4 identities; latest getter; supplier A/B isolation; anonymous denial; staff reads; internal field redaction; direct/RPC supplier self-approval denial; financial-only submission; handling at 8/10/12%; all-category and partial scope; excluded service removal from base; internal commission separation; revision/version copying; approved parent immutability; staff price-write rejection; post-approval reservations and execution; explicit legacy conversion without row deletion/double counting; import scope confirmation; atomic mismatch rejection; no fee Other row; source discrepancy/audit preservation.
- **45 frontend/parser tests pass; 1 optional real-workbook test skipped.** Tests cover business formulas, scope validation/inference/confirmation, preserved mappings/first-sheet isolation/ambiguity decisions, source discrepancies, readonly admin terms, collapsed full history, financial-only submission with incomplete operations, dedicated reservation actions, all five read-error states/retry and outdated-schema write blocking.
- A byte comparison of the non-handling Excel service mapping body against the saved pre-change file is identical.
- Production anonymous read-only checks: exact public catalogue and featured homepage queries each return **HTTP 200, 3 trips**. Header plus all five supplier row tables return **HTTP 401, PostgreSQL 42501** for anon.
- `npm run build`: passes; existing chunk-size warning remains.
- Repository-wide TypeScript: 94 diagnostics, matching the saved pre-task count; all 14 quote-page messages match by code/message. No diagnostics in the new handling/history/parser modules. These unrelated existing errors are not fixed here.

Synthetic V3 rows before/after migration: Hotels 20 → 20; Transport 20 → 20; Activities 19 → 19; Guides 11 → 11; Other 1 → 1; total 71 → 71. Authenticated supplier reads and frontend rendering of those synthetic counts pass.

Production V3 counts in the earlier user report were approximately 20/20/19/11/1. This schema export does not independently verify them. Actual production authenticated browser/role checks remain a post-deployment read-only step; **local tests do not certify production UI behavior**.

No production quote/version/row was deleted, rewritten or created. No production Excel import/save/submit/approval/version-creation RPC was called. Local tests create synthetic revisions/imports and roll them back; they are not production V5/V6.

## Deployment instructions — do not deploy automatically

1. Prepare a clean release checkout based on the current production code, including only the supplier workflow changes and their existing loader/import dependencies. This shared working tree contains unrelated staged changes; do not deploy them as part of this release.
2. Review the migration and take the usual database backup. Confirm the Supabase SQL Editor is for **LeJapon `nxnncbddtpjusrnhilxk`**, not Moroccan Express. Do not use a blanket `supabase db push` from this drifted/shared repository.
3. Only after explicit deployment authorization, run **this migration alone** in one transaction: paste `BEGIN;`, the complete migration contents, then `COMMIT;` into the SQL Editor and run the entire batch. If any guard fails, roll back and repeat the read-only audit; do not remove the guard or guess a replacement signature. Do not run the local fixture/seed/business test SQL on production.
4. If maintaining Supabase CLI migration history, first link/verify the authorized LeJapon project (`supabase link --project-ref nxnncbddtpjusrnhilxk`), then record only the migration already manually applied: `supabase migration repair --status applied 20260917204854 --linked`. This command records history; it does not apply other migration files. Verify the target project before either command.
5. Build the clean release with `npm run build` and publish it through the existing LeJapon hosting process **after** the DB succeeds. Do not publish the shared working-tree build automatically. No hosting account deployment was performed here.
6. Verify with existing production V1/V2/V3/V4 only. Capture privileged and browser-authenticated counts for each category; inspect supplier requests and UI. Compare existing V3 counts/totals with a saved baseline. Verify staff reads, supplier A/B isolation, archived-version reads, internal-field redaction, and anonymous catalogue/homepage access. Existing read-only diagnostic scripts can be used with actual authorized user/quote UUIDs. Do not use Save, Submit, Approve, Import or Create Version during these production regression checks.
7. Test writes/imports/approvals and variable scope/rates on a staging clone or the isolated synthetic fixture. Never create a production test version/import. Post-approval reservation write tests also belong in staging unless separately authorized as real operational work.
8. If the frontend must be rolled back, restore the prior supplier release. Leave the additive columns/data and security restrictions intact pending a reviewed DB rollback; do not drop fields or weaken RLS to roll back UI. Supplier getters remain compatible with the previous repaired quote-read path. A pre-model import client may be unable to import source handling against the new server; restore the compatible import UI rather than restoring a double-counting fee path.

### Reproduce isolated SQL tests

The fixture generator reads the provided audit CSV and writes SQL; it does not connect to Supabase. Use a fresh disposable container/database only.

```sh
python3 scripts/tests/supplier-quote-fixture-from-audit.py /path/to/audit.csv /tmp/lejapon-audited-baseline.sql
```

Load the generated baseline into a fresh isolated Postgres instance, then the synthetic seed, then **only** the new migration, then `supabase/tests/supplier_quote_business_model.sql`, using `psql -v ON_ERROR_STOP=1` and `--single-transaction` for migration application. Keep the instance disconnected from production. The test transaction ends in ROLLBACK.

Frontend checks:

```sh
npx vitest run src/admin/lib/supplier-quote-business-model.test.ts src/admin/pages/supplier/SupplierHandlingFields.test.tsx src/admin/lib/supplier-quote-excel-import.test.ts src/admin/pages/supplier/SupplierTripCosts.test.tsx src/admin/lib/supplier-quote-section-loader.test.ts
npm run build
```

To exercise the optional workbook test, provide `SUPPLIER_QUOTE_IMPORT_FIXTURE` pointing to an existing local workbook. This parser test does not call an import RPC.
