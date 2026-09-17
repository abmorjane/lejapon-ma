# LeJapon.ma supplier quote reads — 2026-09-17

Status: frontend error masking corrected locally; production visibility root cause is **not established**. Do not deploy this as a completed RLS repair.

## 1. Root cause established so far

`SupplierTripCosts.tsx` previously converted failed section requests into `normalizeRows(section, data ?? [])` for both supplier and staff reads. It saved the last error in `lastQuoteEngineError`, but displayed that error only when `sqlMissing` was true. A `42501` permission error is not a missing-table error, so it produced empty tables with no visible explanation. Version comparisons also discarded request errors.

This proves the error-masking defect, **not** the database cause of production V1–V4 invisibility. A successful HTTP 200 response filtered to zero rows by RLS is also possible. The frontend cannot distinguish such filtering from a genuinely empty authorized result without additional evidence. No permission or policy repair has been guessed.

## 2. Affected policies/functions

Production project: `nxnncbddtpjusrnhilxk`, confirmed by the existing frontend configuration.

The connector refused even a read-only catalog query with `You do not have permission to perform this action`. Its project list contains only Moroccan Express staging. That project was not queried or modified. Computer-use inspection did not yield an accessible supplier session or SQL dashboard.

Consequently, the live RLS enabled state, policy names/expressions/roles, helper definitions/EXECUTE permissions, supplier/staff grants, historical version access, quote/supplier relationships, and latest/historical RPC behavior remain unverified.

Repository definitions are evidence of intended behavior, not current production behavior:

- `20260911123423_complete_supplier_workflow.sql` defines authenticated supplier SELECT policies calling `supplier_can_access_quote(auth.uid(), quote_id, false)` and separate staff policies calling `is_staff(auth.uid())`.
- `20260912193312_trip_archiving.sql` keeps archived quotes readable when `_require_editable=false`, subject to membership and an active assignment.
- `20260911232626_supplier_quote_collaborative_versioning.sql` retrieves the latest quote by descending version/creation time and retrieves a historical quote by its ID with authorization.
- The historical V1 SQL uses SELECT subqueries against `supplier_trip_quotes` and status filters. Live policy and parent-table RLS evidence is required to determine whether any historical policy remains relevant.

Audit scripts include the parent quote table, memberships and trip assignments because row policies may depend on those tables. They include all policy-called helper functions registered in `pg_depend`, recursively follow helper calls in function source text, and include known quote RPCs explicitly. Source matching includes overloads conservatively; inspect returned definitions for dynamic calls or unqualified dependencies needing a further audit.

## 3. Files changed in this task

- `src/admin/pages/supplier/SupplierTripCosts.tsx`
- `src/admin/lib/supplier-quote-section-loader.ts`
- `src/admin/lib/supplier-quote-section-loader.test.ts`
- `src/admin/pages/supplier/SupplierTripCosts.test.tsx`
- `supabase/diagnostics/20260917_supplier_quote_read_audit.sql`
- `supabase/diagnostics/20260917_supplier_quote_authenticated_read_check.sql`
- This report.

Other existing staged/unstaged changes were preserved. In particular, the parser, import migration, financial formulas, and existing versioning migration were not changed by this task.

## 4. SQL migration

None created. A smallest-safe RLS migration requires the live audit results first. Both new SQL files are **diagnostics**, not migrations, and have not been executed against production. Each explicitly starts a read-only transaction and rolls back. Neither calls an import/save/create RPC or changes schema/data.

## 5. Frontend changes

- Shared five-section reader preserves `data: null` on failure and an actual array on success. Rejected requests and malformed null responses also remain failures.
- Each failed table displays its table name and actual error code/message/details/hint, logs the error with the quote ID, and displays no zero count or zero total.
- Loading has a separate UI state. Successful empty reads still display zero rows.
- All current-version section errors are retained rather than overwriting one another.
- Failed header reads no longer seed a new editable default draft.
- Save/submit/import/version-creation/review controls are blocked during incomplete reads. Save/import handlers also enforce a synchronous guard before making any write request.
- Incomplete aggregate totals and financial dashboard data are marked unavailable; quote-dependent exports are blocked. Financial calculation functions are unchanged.
- A retry action reloads existing quote data. Successful retry clears error state and restores editing.
- Parent-version read failures display comparison-unavailable errors instead of invented changes or “no difference”.

## 6. Before/after RLS behavior

No RLS change was applied. Verified anonymous access behavior is therefore unchanged:

| Request | Production result |
| --- | --- |
| Exact public catalogue query from `src/pages/Trips.tsx` | HTTP 200, 3 trips |
| Exact featured homepage query from `src/pages/Index.tsx` | HTTP 200, 3 trips |
| Each of the five supplier row tables, anonymous `select=id&limit=1` | HTTP 401, PostgreSQL `42501 permission denied for table ...` |
| Supplier/staff current and archived version reads | Blocked by lack of authorized production SQL/browser access; not tested |

The anonymous checks used the existing frontend public key, never a service-role key. Only HTTP status/count/error was printed, not trip or financial data.

## 7. Existing V3 counts

| Category | Reported by user before this task | Independently measured after |
| --- | --- | --- |
| Hotels | Approximately 20 | Not available |
| Transport | Approximately 20 | Not available |
| Activities | Approximately 19 | Not available |
| Guides | Approximately 11 | Not available |
| Other | Approximately 1 | Not available |
| Total | Approximately 71 | Not available |

No quote-data writes were performed, so this task did not change these rows. The approximate user-supplied counts must not be presented as fresh production measurements.

## 8. Tests

Local command:

```bash
npm run test -- src/admin/lib/supplier-quote-section-loader.test.ts src/admin/pages/supplier/SupplierTripCosts.test.tsx src/admin/lib/supplier-quote-excel-import.test.ts src/lib/trip-archiving.test.ts
```

30 passed, 1 skipped. The existing parser suite skips its real workbook test when that workbook is unavailable; its synthetic tests passed. No workbook was imported into a database.

New checks cover all five categories, filtering by each requested V1/V2/V3/V4 fixture ID, zero-result versus permission failure, network/null-response failures, error rendering, initial loading, disabled writes/import, header failure without default-draft fallback, and retry recovery. A mocked page test receives/renders five categories with synthetic counts 20/20/19/11/1. **These fixtures are not the existing production quote versions and do not certify production V3 or actual V1–V4 dropdown selection.**

Production anonymous REST checks passed as recorded above. Production supplier A versus supplier B isolation, actual browser-role V3 counts, staff/admin reads, archived version reads, latest/historical RPC results and UI display remain outstanding.

## 9–10. Data preservation

No quote, version or line was deleted. No DELETE/TRUNCATE was executed. No Excel import/save/version-creation RPC was executed against any database. No V5 was created. No production deployment, migration application, migration-history repair, or database write occurred.

## 11. Build

`npm run build` passed. Vite reports its chunk-size warning.

The optional repository-wide `tsc --noEmit -p tsconfig.app.json` fails with 94 diagnostics. A compiler-host check against the saved pre-task page source also reports 94 diagnostics, and the 14 quote-page diagnostics match by code/message. The new loader/tests introduced no diagnostics in that check. Unrelated type errors were left untouched.

`git diff --check` passed.

## 12. Remaining evidence and deployment instructions

1. In an authorized SQL editor for **LeJapon project `nxnncbddtpjusrnhilxk`**, run `supabase/diagnostics/20260917_supplier_quote_read_audit.sql` and retain all result sets. Do not run it in Moroccan Express.
2. After reviewing the audit, fill the five existing UUID placeholders in `supabase/diagnostics/20260917_supplier_quote_authenticated_read_check.sql`. Use the **actual supplier browser user**, an independent supplier B with an existing quote, an existing staff/admin user, and the existing V3 quote ID. Run the script as database owner; retain its JSON NOTICE messages. It compares privileged counts with authenticated-role counts for existing V1–V4, tests historical/latest/list RPCs, opposite supplier reads, staff reads, anonymous denial and anonymous trips. SET LOCAL ROLE/JWT impersonation is a database check, not proof of a browser session.
3. Inspect actual supplier browser PostgREST requests for each table/quote ID, including HTTP status, response counts and errors. Select existing V1/V2/V3/V4 and verify all five tables. Do not use Import Excel, Save, Submit or Create Version during diagnosis.
4. Only after evidence identifies the failing policy/helper/grant, prepare the scoped forward migration, validate supplier isolation and historical access, and obtain explicit production deployment authorization. **No RLS deployment command can be specified yet because the repair is not known. Do not replay historical migrations or run a blanket `db push` as a workaround.**
5. Once authorized for a reviewed frontend release, use a checkout containing the intended supplier changes and their existing import dependencies; the shared working tree already contains unrelated pending changes and is not a scoped release package. Run the test command above, then `npm run build` with LeJapon production frontend configuration. Publish the **contents** of `dist/` through the site's existing static-host deployment procedure, retaining the previous assets for rollback. No Edge Function deployment is needed for these frontend changes. The hosting destination/path is not available in this session, so an exact remote upload command cannot be supplied honestly.
6. After any authorized repair/deployment, rerun both read-only diagnostics and browser version/category checks, verify the existing V3 privileged counts are unchanged, and repeat the exact anonymous catalogue/homepage queries. No new quote version is needed for any verification.

The next required input is authorized LeJapon production access or the read-only audit outputs, without passwords or access tokens.
