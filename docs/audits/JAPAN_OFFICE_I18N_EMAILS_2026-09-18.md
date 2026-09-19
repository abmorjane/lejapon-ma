# Japan Office EN/JA and supplier emails — 18 September 2026

## Audit and scope

The application already uses i18next for public French/English/Arabic content. Supplier pages contained French labels and a few English labels. Supplier workflow emails were French and presented `trips.start_date` / `trips.end_date` as arrival/departure. These are commercial dates, not reliable Japan operational dates.

The supplied production schema export `query-results-export-2026-09-18_01-49-29.csv` confirms these nullable canonical `trips` fields:

| Field | Production type | Supplier email use |
| --- | --- | --- |
| `visa_japan_arrival_date` | date | Arrival in Japan / 日本到着日 |
| `visa_japan_departure_date` | date | Departure from Japan / 日本出発日 |
| `visa_arrival_port` | text | Actual arrival airport/port, when provided |
| `visa_arrival_flight_number` | text | Actual arrival flight number, when provided |
| `return_flight_text` | text | Departure reservation details, preserved verbatim when provided |

The trip editor already saves these fields. The supplied export has no structured departure-airport or departure-flight-number columns. Its canonical return reservation text can contain these details and is displayed unchanged, under `Departure flight details` / `日本出発便の詳細`. No airport/flight is guessed from multi-leg reservation text or copied from arrival data. The generic visa date helper derives dates from commercial dates, so supplier emails deliberately do not use that helper. No schema migration is required.

## Architecture and persistence

`src/i18n/supplier/SupplierLanguageProvider.tsx` uses an isolated i18next instance with the existing installed dependency. A single catalogue contains 721 app-owned source labels/templates, each with English and Japanese translations. Components use `useSupplierTranslation()`; pages are not duplicated. Interpolation preserves values such as hotel names and imported descriptions.

The provider wraps the supplier layout and supplier login only. Staff pages outside this provider retain French. Existing public i18n resources and public `lang` storage are unchanged. The supplier document language is EN or JA with left-to-right direction while mounted and is restored on exit.

The header has the compact `日本語 | EN` selector. The supplier login also exposes it.

Preference audit: the supplied production export lists only `id`, `supplier_id`, `user_id` and `created_at` on `supplier_members`. Repository profile definitions/generated types contain contact/avatar fields, with no language preference. The export does not audit `profiles`, so this is repository evidence rather than a claim about live profile columns. `agency_profiles.preferred_language` belongs to agency onboarding, not supplier membership. Reusing existing Auth user metadata avoids assuming an unaudited profile column or creating unnecessary schema.

Persistence uses:

- Supabase Auth user metadata: `supplier_language: "en" | "ja"`, saved through `auth.updateUser`. This is a presentation preference and is never used for authorization.
- Per-user local storage: `lejapon:supplier-language:<user-id>`, with a separate `guest` key for login.
- A per-user `:pending` key preserves a locally selected language if Auth synchronization fails. The UI reports the failure with the real diagnostic; selecting the language again retries synchronization.

A valid saved Auth preference takes priority unless a local update is pending. Otherwise the cached/login preference is used, then English. A supplier without a stored Auth preference saves the initial selection on entering the portal. No production Auth user was updated during this work.

Auth API contracts were checked against [updateUser documentation](https://supabase.com/docs/reference/javascript/auth-updateuser) and [getUserById documentation](https://supabase.com/docs/reference/javascript/auth-admin-getuserbyid). The official changelog was also reviewed; the listed changes do not affect these preference APIs or the existing custom SMTP workflow.

## Translation coverage and examples

Both languages cover the dashboard, assigned/archived trips, FIT assignment response controls, quotation sections and statuses, commercial review/revision controls, operational controls/checklists, scoped handling, Excel import preview and ambiguity decisions, version history, Messages, Documents, participants, rooming, flight information, buttons, empty/loading states, validation messages and app-owned notification labels.

Known generated Excel diagnostics are translated at the display boundary. Source workbook descriptions, companies, hotels, participant names, comments, review feedback and other entered content remain unchanged. Generated total-row descriptions are translated only when identified by the parser's existing total-row diagnostic. Excel parsing, mapping, payloads and financial calculations are unchanged.

Backend failures show a localized explanation alongside the original code/message/details/hint. Technical diagnostics are preserved; they are not machine-translated or hidden. The existing distinction between failed section loads and zero returned rows remains intact.

| Concept | English | Japanese |
| --- | --- | --- |
| Quotation draft | Draft | 下書き |
| Submitted quotation | Submitted | 提出済み |
| Revision requested | Revision requested | 修正依頼 |
| Approved quotation | Approved | 承認済み |
| To book | To book | 手配待ち |
| Booking underway | Booking in progress | 手配中 |
| Bookings confirmed | Confirmed | 手配確定 |
| Messages | Messages | メッセージ |
| Documents | Documents | 書類 |

Raw database statuses and authorization checks remain unchanged. Quotation approval still belongs to LeJapon.ma; operations remain a separate phase.

## Email changes

Only supplier workflow rendering/recipient language resolution changed in `send-admin-notification`. The existing caller authentication, staff/supplier membership checks, internal comment filtering, notification tracking and SMTP delivery code remain in place. Staff-directed submission/comment emails remain French.

The new shared renderer produces individual English/Japanese emails for:

| Event | EN CTA | JA CTA |
| --- | --- | --- |
| New assignment / quotation request | Prepare quotation | 見積を作成する |
| Revision requested | Review requested changes | 修正内容を確認する |
| Quotation approved | View approved quotation | 承認済み見積を確認する |
| Shared staff quotation comment | View comment | コメントを確認する |

Supplier membership recipients are resolved individually through Auth's admin `getUserById`, using each user's stored language. Duplicate email addresses are deduplicated; a member preference overrides the contact-address English default. A contact-only recipient without a linked user defaults to English. Lookup failures remain real errors rather than silently dropping recipients.

Revision feedback and shared comments are included as unchanged text, with HTML escaping. Existing portal operational notification labels are translated. The current supplier email dispatcher has no separate operational event implemented; no new operational email dispatch or business trigger was introduced.

Dates must be valid date-only canonical operational values. Rendering uses UTC to avoid shifting date-only values. Missing/invalid dates show `To be confirmed` / `未確定`. The supplier renderer never reads commercial `start_date` or `end_date` and has no commercial fallback. Optional airport/flight details appear only when provided.

Branding remains LeJapon.ma with the existing Moroccan Express Travel & Events attribution. Email markup includes a viewport, a maximum-width card, Japanese font fallbacks, wrapping long content, and a narrow-screen layout that stacks labels/values and expands the CTA.

## Files changed

### Application

- `src/App.tsx`: supplier-login provider only.
- `src/admin/components/SupplierLayout.tsx`: supplier provider/header selector and labels.
- `src/admin/components/StatusBadge.tsx`: optional display label while preserving raw status styling.
- `src/admin/pages/Login.tsx`: supplier-context login translations and signup preference; staff context remains French.
- `src/admin/pages/supplier/SupplierTrips.tsx`: dashboard/trip/notification labels.
- `src/admin/pages/supplier/SupplierFitRequests.tsx`: FIT controls/statuses/errors.
- `src/admin/pages/supplier/SupplierTripCosts.tsx`: supplier quotation/operations/Messages/Documents/participants/rooming presentation and diagnostics.
- `src/admin/pages/supplier/SupplierHandlingFields.tsx`: handling labels and validation presentation.
- `src/admin/pages/supplier/SupplierQuoteExcelImportDialog.tsx`: preview, ambiguity and handling labels/diagnostics.
- `src/admin/pages/supplier/SupplierQuoteVersionHistory.tsx`: version-history labels.
- `src/i18n/supplier/SupplierLanguageProvider.tsx`: translation/context/persistence/date/error helpers.
- `src/i18n/supplier/catalog.json`: bilingual supplier catalogue.

### Emails, tests and review artifacts

- `supabase/functions/send-admin-notification/index.ts`: supplier canonical-date query and individual recipient rendering.
- `supabase/functions/_shared/supplier-workflow-email.ts`: recipient preferences and EN/JA renderer.
- `src/i18n/supplier/SupplierLanguageProvider.test.tsx`: language/persistence/catalogue/error checks.
- `src/admin/pages/supplier/SupplierPortal.i18n.test.tsx`: supplier portal integration checks.
- `src/test/supplier-workflow-email.test.ts`: email/date/recipient tests.
- `docs/examples/japan-office/`: request, revision, approval and missing-date emails in both HTML and plain text, generated from the actual renderer with synthetic data.
- This audit/deployment report.

## Verification

The complete Vitest suite passes: **149 passed, 1 skipped, 18 files**. The skip is an existing test. This includes existing supplier tests, the prior admin-cockpit tests, and supplier i18n/email tests. Four additional follow-up checks cover workflow terminology and canonical departure flight details.

New tests verify EN ↔ JA switching; refresh preference; guest-to-user preference; account isolation; synchronization errors; unchanged public language storage and staff French; catalogue/interpolation parity; real permission diagnostics; all five quote sections; supplier-entered names/comments unchanged; handling; Messages/Documents; FIT; Excel preview and ambiguity; identical import payloads; and V1–V4 selection without a version-creation call.

Email tests verify both languages and event CTAs, individual member preferences, contact/member deduplication, preserved free text and HTML escaping, mobile markup, exact canonical Japan dates distinct from commercial dates, missing operational dates, invalid-date rejection without fallback, unchanged departure reservation text in both languages, and omission of unavailable flight details.

`npm run build` passes. Vite reports its existing large-chunk advisory. `deno check --no-config --node-modules-dir=auto --no-lock supabase/functions/send-admin-notification/index.ts` passes in an isolated temporary copy. `git diff --check` passes.

A repository-wide standalone TypeScript check reports existing repository errors; it is not a clean acceptance gate. The unchanged HEAD baseline and current checkout each report the same 86 diagnostics, with no added or removed diagnostics after ignoring line-number shifts. The production build and Edge Function type check are the applicable passing checks.

Read-only calls to the existing production public catalogue/homepage REST queries both return HTTP 200 with three available trips. Anonymous reads of `supplier_trip_quotes` and all five supplier financial row tables return HTTP 401 / PostgreSQL 42501. No policies were changed.

Portal integration tests use fixtures/mocked authenticated roles, not live supplier accounts. Emails were rendered locally, not delivered. No controllable browser was available for screenshots or an interactive production smoke test. The HTML examples below are reviewable; actual mobile mail-client rendering and real-account preference synchronization still require the authorized release smoke test.

## EN/JA review examples

All example data are synthetic and CTA links use `example.invalid`.

- [Request EN](../examples/japan-office/email-request-en.html) / [Request JA](../examples/japan-office/email-request-ja.html)
- [Revision EN](../examples/japan-office/email-revision-en.html) / [Revision JA](../examples/japan-office/email-revision-ja.html)
- [Approval EN](../examples/japan-office/email-approved-en.html) / [Approval JA](../examples/japan-office/email-approved-ja.html)
- [Missing dates EN](../examples/japan-office/email-missing-dates-en.html) / [Missing dates JA](../examples/japan-office/email-missing-dates-ja.html)

Plain-text `.txt` companions are in the same directory. Open the HTML examples at desktop and approximately 375px width to review the responsive layout; inspect them in the target mail clients before relying on client-specific CSS support.

## Production deployment instructions — not executed

1. Obtain explicit deployment authorization and retain the previous frontend build and `send-admin-notification` source for rollback. Use the existing LeJapon.ma production environment; the project reference is `nxnncbddtpjusrnhilxk`.
2. From the release checkout, install the exact locked dependencies and verify:

   ```bash
   npm ci
   npm test -- --run
   npm run build
   ```

   Type-check the Edge Function in an isolated copy of the release checkout if using Deno's automatic node-module initialization, so the frontend's locked `node_modules` are not replaced:

   ```bash
   deno check --no-config --node-modules-dir=auto --no-lock supabase/functions/send-admin-notification/index.ts
   ```

3. Deploy only this Edge Function using the authenticated Supabase CLI:

   ```bash
   supabase functions deploy send-admin-notification --project-ref nxnncbddtpjusrnhilxk
   ```

   The shared renderer is imported relatively and is bundled with the function. Keep the existing secrets and authentication configuration. Do not deploy all functions, change JWT configuration, or use prune flags.
4. Publish the built **contents** of `dist/` through the existing LeJapon.ma static-host deployment process. Preserve the current SPA route fallback so `/supplier/login` and supplier deep links resolve. The repository does not identify a unique production upload destination or transport command; do not substitute an assumed host/path. No frontend environment-variable change is needed. Build fresh release assets; the existing user-modified `dist.zip` was preserved and must not be assumed to contain this release.
5. No SQL migration, `db push`, policy update, storage update or historical migration replay is required.
6. Smoke-test using existing quote versions and normal authorized accounts:
   - Switch EN ↔ 日本語, refresh and sign out/in; confirm saved Auth language and public homepage language remain independent.
   - Open existing V1–V4 without saving/importing/creating a revision. Review all categories, handling, Messages/Documents, participants/rooming and operations.
   - Check localized validation and real permission/backend diagnostics using existing test fixtures or staging errors.
   - Review the EN/JA HTML email examples in mobile mail clients. If email delivery is tested, use explicitly authorized test recipients in staging; do not trigger production assignment/revision/approval notifications solely for testing.
   - On the next real authorized supplier notification, confirm recipient language, Japan dates, and missing-date presentation against the canonical fields.
   - Confirm anonymous public catalogue/homepage responses and continued denial of supplier financial data.
7. Rollback, if needed: redeploy the previous single Edge Function and previous frontend assets through the same paths. Language metadata may remain; it is non-security presentation data and does not affect old business logic.

## Preserved invariants

No financial formulas, handling formulas, internal commission logic, quote/version creation logic, Excel parser/mappings, SQL migrations, public/supplier/Messages/Documents RLS, Storage policies or archiving rules were changed. Core subtotal/row serialization/quote-total/submission-validation functions were compared with HEAD and remain unchanged.

No existing quote, version or financial row was deleted. No production quote/version/import was created, no workbook was re-imported, no production notification email was sent and no production deployment occurred. Moroccan Express Travel OS was not accessed or modified.
