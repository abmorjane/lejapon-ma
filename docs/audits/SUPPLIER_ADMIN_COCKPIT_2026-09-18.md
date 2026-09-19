# Supplier admin cockpit, review UX and financial correctness

Date: 18 September 2026. Local implementation only; no production deployment.

## Audit findings

- `SupplierCosts.tsx` previously rendered one card per quote row/version and linked staff into `/supplier/trips/:tripId/quote`.
- Its separate fallback calculator summed services and internal commission but omitted the scoped supplier handling model. It also used truthy fallbacks (`stored || calculated`), which could replace legitimate zeros.
- `SupplierTripCosts.tsx` previously converted a failed bookings read into `[]` and calculated revenue as a sum of `total_amount_mad`. Failed/missing data therefore produced artificial zero revenue and negative profitability. Stored negotiated discounts/supplements were not included.
- The existing quote component already correctly separates supplier commercial editing, staff review, approval and operational execution. It is reused, not rebuilt.
- The existing version history already has a closed outer disclosure, compact addition/removal/modification counts and closed category disclosures including Handling. That behavior is preserved.

The preceding Japan Office EN/JA changes are still present in the working tree and were preserved. The files below describe this sprint's incremental changes, not every earlier uncommitted change.

## Files changed in this sprint

| File | Change |
| --- | --- |
| `src/App.tsx` | Protected admin quote routes under the existing AdminLayout |
| `src/admin/pages/AdminSupplierQuote.tsx` | Small keyed wrapper around the existing quote component |
| `src/admin/pages/SupplierCosts.tsx` | One dossier per supplier, version links, current cost hierarchy, explicit load errors |
| `src/admin/pages/supplier/SupplierTripCosts.tsx` | Admin navigation/context, exact requested quote, review counts/gate, explicit revenue state, financial presentation, approved supplier next step |
| `src/admin/lib/supplier-admin-review.ts` | Dossier grouping, route builder, review counts, committed-revenue and nullable profitability helpers |
| `src/admin/components/PageHeader.tsx` | Optional current breadcrumb label; other callers retain their previous behavior |
| `src/admin/pages/OperationsCenter.tsx` | Supplier-related staff links stay inside admin; other operations logic unchanged |
| `src/i18n/supplier/catalog.json` | EN/JA approved-quotation next-step labels and revised internal financial labels |
| `supabase/functions/send-admin-notification/index.ts` | Staff quotation email CTA points to the admin quote route; supplier CTA stays under supplier |
| `src/admin/lib/supplier-admin-review.test.ts` | Grouping, review counts, revenue and profitability tests |
| `src/admin/pages/SupplierCosts.test.tsx` | Dossier UI, version links, handling/current and historical totals, failed reads, known/unknown revenue UI |
| `src/admin/pages/supplier/SupplierAdminCockpit.test.tsx` | Lifecycle, route/version behavior, review gate/in-flight guard, supplier prices, historical supplier selection, archive behavior and collapsed history |
| This report | Audit, regression evidence and deployment instructions |

No migration was created. No database helper, policy, table, bucket, trigger or grant was changed.

## Routing and admin context

New routes:

- `/admin/supplier-costs/:tripId/:quoteId` opens that exact existing quote version, constrained by trip ID.
- `/admin/supplier-costs/:tripId` keeps the existing supplier assignment/quotation-request controls available within admin.

Both routes use the existing `RequireRole module="supplier_costs"` and are children of the unchanged AdminLayout, retaining its sidebar. The current module permission remains admin/super-admin only. The wrapper keys the quote component by trip/quote ID so local state cannot carry into a newly selected version.

Admin navigation returns to `/admin/supplier-costs?tripId=:tripId`; the summary restores the selected trip, including its archived view. Breadcrumbs show Admin → Coûts fournisseurs → supplier/version. Version selection navigates to another admin quote route.

A quote-specific route resolves the supplier from the requested quote, rather than taking the trip's first assigned supplier. It also supports historical/inactive suppliers. The assignment picker is reserved for the general trip route, preventing a historical-version view from implicitly reassigning suppliers.

The supplier routes and supplier version selector remain under `/supplier/...`. Context controls navigation; it does not grant privileges. The shared component still derives financial/review permissions from Auth, and explicitly refuses supplier-only users entering admin context. Backend RLS/RPC authorization remains unchanged.

## Dossier grouping and summary

Grouping key: `trip_id + supplier_id`. Versions are sorted by descending version number, then creation time and ID for deterministic ties. The current card uses the highest non-superseded version; if every version is archived/superseded, the highest historical version remains readable. Historical update timestamps cannot promote an older version to current.

One card shows supplier name, current version/commercial status, retained supplier total, services subtotal, supplier handling percentage/amount, internal office commission, internal total cost JPY/MAD, participant count, quote row count, operational status and last update. Every version has a compact direct link to its exact admin route.

The summary calls the quote engine's existing `calculateQuoteTotals` projection. Its previous duplicate calculator is removed. The existing subtotal/handling/commission formulas themselves are unchanged. Successful zero totals are displayed as zero, not replaced with old header values. Incomplete/failed section reads show unavailable amounts/counts and the real diagnostic, with retry. Exact counts also detect truncated quote/section responses.

Legacy day-cost records remain available in a closed disclosure inside the corresponding supplier's dossier, instead of creating another card. Suppliers with only legacy day costs retain one legacy card and their previous aggregate/day detail.

For pre-handling versions, the engine's existing historical handling detection is reused: retained legacy handling rows are distinguished from service subtotal without adding that amount twice. The original source percentage is shown when documented; otherwise it is labelled undocumented. Historical handling scope is never inferred or overwritten.

## Review-state behavior

Review decision and inclusion are separate. The review summary uses mutually exclusive counts:

- Approved: included lines approved by staff.
- To review: included lines pending, missing or unrecognized review decisions.
- Rejected: included lines rejected by staff.
- Excluded: all excluded lines, regardless of review decision.

Final commercial approval is disabled if any included line is pending/rejected, if quote sections are unavailable, or while a write is pending. The action handler also checks the loaded review state. Staff must approve the relevant line or exclude it before approval. Excluded pending/rejected lines do not block this review gate.

Line-review writes use the same existing RPC and only send quote/row IDs, inclusion and review status. Supplier-entered prices remain untouched. The existing busy state locks review controls and final approval while a review save is in progress; failures retain the previous state and show the real error.

This is a frontend review UX gate. The existing staff-only approval RPC and its server-side financial/authorization checks are unchanged. It is not a new database constraint or a change to other RPC clients.

Passports, rooming, documents, vouchers and reservation confirmation are not inputs to the commercial review gate. They remain operational follow-up. Supplier editing still requires draft/revision_requested and an editable trip; submitted/approved/archived quotes remain commercially read-only. After approval, the supplier sees “Quotation approved by LeJapon.ma” / “LeJapon.maによる見積り承認済み”, an operational next-step action, and the operational tab opens initially. The supplier can still open the quotation tab for review.

## Revenue source audit and terminology

Repository evidence:

- `BookingDetail.tsx` loads actual booking rows and uses `getBookingPricingBreakdown` and stored quote adjustments for negotiated booking pricing.
- `src/lib/booking-pricing.ts` defines `enteredFinalTotal` from `bookings.total_amount_mad` plus stored adjustments, independently of catalogue price estimates.
- `src/lib/quote-adjustments.ts` resolves direct `quote_adjustments`, metadata adjustments and the legacy `quote_discount` representation, and applies the existing discount/supplement formulas.
- `Dashboard.tsx` labels summed received payments **CA encaissé**. Payments are cash collected, distinct from committed selling value; they are not added to booking revenue.
- `20260903120000_fit_commercial_lifecycle_v3.sql` writes an accepted FIT selling amount into `bookings.total_amount_mad` when converting to a confirmed booking. It is not counted again as an additional sale.
- The booking-status schema and current booking UI distinguish lead, confirmed, paid, cancelled and completed.

This dashboard now explicitly shows **Chiffre d’affaires engagé**, using current trip bookings with status confirmed/paid/completed. Leads and cancelled bookings are excluded. Each retained booking uses the existing `getBookingPricingBreakdown(...).enteredFinalTotal`; no catalogue-price estimate or payment amount is substituted.

The staff read uses `select('*', { count: 'exact' })` to retain actual negotiated adjustment fields without assuming a drifted optional-column list. Query failures, missing/invalid committed amounts, unknown statuses, missing exact count or incomplete results yield UNKNOWN. A successful complete empty committed-sales set, or explicit numeric zero amounts, yields known ZERO. The count option was verified against [Supabase select documentation](https://supabase.com/docs/reference/javascript/select).

The supplied schema exports do not contain booking-column audits. Accordingly no booking DDL/schema migration was inferred, and no authenticated production revenue aggregate is claimed as verified. The source audit and tests establish the existing repository pricing path; actual inaccessible/invalid backend data remains explicitly unavailable in the UI.

Revenue is the current trip's committed sales value, not a versioned historical sales snapshot. Historical quote costs/handling remain version-specific. The displayed net result is a projection over this quote's retained cost plus internal commission, not company-wide accounting profit.

## Formulas and UNKNOWN/ZERO behavior

Existing cost projection, unchanged:

```text
Services = sum of included supplier services
Handling base = included service subtotals in the selected categories
Handling = existing scoped handling calculation
Supplier total = services + supplier handling
Internal commission = supplier total × existing internal commission percentage / 100
Internal total cost = supplier total + internal commission
```

Historical included handling rows retain their existing value; their amount is separated for presentation and is not added again as new percentage handling.

Staff profitability presentation:

```text
Revenue MAD = sum of existing negotiated final totals for committed bookings
Revenue JPY = revenue MAD / version's JPY→MAD exchange rate
Gross margin = revenue − supplier total cost
Projected net result = revenue − internal total cost
Net margin % = projected net result MAD / revenue MAD × 100
```

JPY conversion and MAD cost/margin calculations require a valid positive exchange rate. Missing/invalid costs or revenue produce unavailable profitability. Per-participant metrics remain unavailable when no passenger count is present, avoiding the engine's division-by-one safety value being presented as a genuine per-person cost. Margin percentage is unavailable when revenue is zero rather than reporting a misleading 0%.

UNKNOWN revenue shows **CA non disponible**, neutral unavailable margins and any real backend diagnostic. Known ZERO may legitimately show a projected loss; that distinction is intentional. Supplier handling is never labelled internal commission. All internal commission/revenue/margin controls remain staff-only.

## Tests and regression results

Complete Vitest suite: **145 passed, 1 existing skip, 18 files**. This includes 29 new sprint tests and all preceding supplier/i18n/email tests. After the final per-participant presentation guard, the 15 affected admin UI/workflow tests were rerun and passed, and the build passed again.

The local lifecycle fixture exercises supplier draft → submit/read-only → admin request revision → supplier price edit → resubmit/read-only → admin line review → commercial approval → supplier operational phase. No operational participant/document completion is supplied. Admin prices remain disabled and the supplier's revised price is retained.

Additional checks cover exact /admin routes and version selection, unchanged /supplier route, multiple suppliers/current grouping, every historical link, historical supplier B selection rather than first assigned supplier A, archived supplier read-only controls, comments/revision feedback, blocked pending/rejected approval, excluded-price retention and retained total, in-flight review writes, non-staff admin-context denial, scoped handling inclusion/exclusion, legacy handling, collapsed full history, negotiated revenue adjustments, unknown/missing/truncated revenue, known zero and available profitability.

`npm run build`: passed (existing Vite large-chunk advisory). Isolated notification Edge Function type check: passed. `git diff --check`: passed. Standalone repository TypeScript check still reports the same 86 pre-existing diagnostics as the separately checked unchanged HEAD baseline; no new diagnostics were introduced.

Read-only production regression checks:

- Anonymous public catalogue: HTTP 200, three rows.
- Anonymous homepage trip query: HTTP 200, three rows.
- Anonymous supplier quote header and all five financial section tables: HTTP 401 / PostgreSQL 42501.

All new workflow/version tests use local fixtures/mocks, not production writes. No live staff/supplier production session or interactive browser smoke test was available. Messages/Documents, Excel, handling, financial read-error and archiving tests continue to pass; their backend security objects were not altered.

## Deployment instructions — not executed

1. Obtain explicit deployment authorization. Preserve the previous frontend assets and single notification-function source for rollback. The release checkout includes the preceding uncommitted Japan Office i18n/email work; review and release the complete intended working tree together rather than reverting those files.
2. From the release checkout:

   ```bash
   npm ci
   npm test -- --run
   npm run build
   ```

3. This sprint requires no SQL, migration replay, database push, RLS/Storage edit, secret change or quote-data update.
4. Publish the contents of `dist/` through the existing LeJapon.ma static-host release process. Preserve the SPA fallback for /admin and /supplier deep links. The repository does not specify a unique production upload host/path, so no invented upload command is provided.
5. To release the staff email CTA change (and the preceding supplier email work), deploy only the notification function using the authenticated CLI:

   ```bash
   supabase functions deploy send-admin-notification --project-ref nxnncbddtpjusrnhilxk
   ```

   Keep existing JWT/secrets configuration; do not deploy all functions or use prune flags. A function check can be run from an isolated release copy with `deno check --no-config --node-modules-dir=auto --no-lock supabase/functions/send-admin-notification/index.ts` to avoid replacing frontend lockfile dependencies.
6. Smoke-test existing trip/quote versions read-only in production: one dossier per supplier, every version link, admin sidebar/breadcrumb/return link, exact quote/supplier identity, financial hierarchy, existing EN/JA supplier labels and archived reads. Do not save/import/create versions for this smoke test.
7. Exercise the full write lifecycle only with authorized staging fixtures/test accounts. Inspect staff requests to confirm line review has no supplier-price fields; verify the approval gate before and during unresolved line-review writes. Test known/unknown revenue and denied booking reads. Do not trigger production notification emails solely for testing.
8. Confirm the public homepage/catalogue and anonymous financial denial remain normal. Rollback by publishing previous frontend assets and redeploying the previous single notification function; no database rollback is needed.

## Data/security preservation

No quote/version/row was deleted, merged or overwritten by this work. No production quote version, workbook import, assignment, revision, approval or email was created/sent. No production deployment occurred.

Supplier subtotal/handling/commission engine formulas and Excel parser/mappings are unchanged. Public trips, supplier row RLS, Messages/Documents security, Storage and archive rules are unchanged. Moroccan Express Travel OS was not accessed or modified.
