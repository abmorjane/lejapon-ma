# Japan Office Supplier Module Roadmap

This roadmap describes the target Japan Office / Supplier architecture after the V2 checkpoint. It should be implemented incrementally without weakening the stabilized public, admin, agency, booking, and visa flows.

## 1. Supplier Portal

- Dedicated `/supplier` workspace for Japan office and local suppliers.
- Supplier login through existing authentication and role checks.
- Supplier profiles scoped by organization/member where possible.
- Supplier types: hotel, guide, transport, activity, and internal Japan office.
- Supplier users should see assigned trips and operational tasks only.
- Admin users retain full read/write oversight.

## 2. Japan Office Dashboard

- Dashboard of active trips and departures.
- Quote status, operational readiness, pending confirmations, missing documents, and urgent messages.
- High-level participant, room, hotel, transport, activity, guide, and document counters.
- Filters by trip, departure date, status, supplier, and urgency.

## 3. Trip Cost Engine

- Structured quote engine per trip/departure.
- Section totals for hotels, transport, activities, guides, and other costs.
- JPY totals, MAD conversion, commission, cost per passenger, and margin analysis.
- Draft, submitted, reviewed, approved, and revision requested states.
- Admin-only visibility for sales price, margin, and internal commercial notes.

## 4. Hotel Cost Tables

- Hotel rows by city, hotel, check-in, check-out, nights, room type, participant count, unit cost, subtotal, status, and comment.
- Default rows generated from itinerary and rooming list.
- Room types: double/twin, single, triple, and tour leader.
- Chronological ordering and export-ready formatting.

## 5. Transport Cost Tables

- Transport rows by programme day, route/city, service date, transport type, quantity, unit price, subtotal, status, and comment.
- Transport types: bus, metro, taxi, train, shinkansen, boat, and other.
- Links to operational itinerary and daily transport notes.

## 6. Guide Cost Tables

- Guide rows by day, date, city, guide type, guide count, daily price, subtotal, status, and comment.
- Guide types: francophone, anglophone, Japanese, assistant, and other.
- Predefined Japan itinerary guide rows can seed the first quote.

## 7. Activity Cost Tables

- Activity rows by day, date, activity, required/optional flag, participant count, unit price, subtotal, status, and comment.
- Required activities use total participant count.
- Optional activities use selected extras/activities from bookings.
- Aliases should normalize names such as USJ, Disney, tea ceremony, Maiko dinner, and meditation.

## 8. Rooming Lists

- Reuse the admin operations room allocation data.
- Show hotel/stay, room number, room type, assigned participants, passport summary where allowed, and notes.
- Support hotel-to-hotel room copy while preserving participant assignment rules.
- Export rooming list to Excel/PDF for Japan office and hotels.

## 9. Participant Lists

- Reuse admin operations participants data.
- Show names, booking references, nationality, passport number, date of birth, sex, passport issue/expiry, CIN/national ID, selected extras, room type, and special notes where permission allows.
- Keep payment data, private admin notes, and visa documents hidden from supplier users unless explicitly approved.

## 10. Supplier Collaboration

- Trip-level message center with Morocco office, Japan office, and admin roles.
- Message types: general, hotel, transport, activities, guides, and urgent.
- Attachments, unread counters, search, and filters.
- Optional row/day comments for quote and operational tasks.

## 11. Internal Notifications

- Notify supplier users when a quote request, task assignment, urgent message, or revision request is created.
- Notify admin users when supplier quote is submitted, row status changes, or urgent issues are raised.
- Use the admin email template system for notification copy.
- Store notification events for future in-app notification center.

## 12. Quote Approval Workflow

- Quote states: draft, submitted, reviewed, revision requested, approved, cancelled.
- Admin approval locks baseline totals.
- Revisions create history entries rather than overwriting prior decisions silently.
- Approval should require required operational sections to be complete when validation rules are enabled.

## 13. Cost vs Sale Price Analysis

- Admin-only dashboard comparing supplier cost with booking revenue.
- Metrics: revenue MAD/JPY, supplier cost, gross margin, margin percentage, cost per passenger, revenue per passenger, and net profit.
- Exclude client payments and internal notes from supplier view.

## 14. Margin Tracking

- Track final supplier totals, commission, exchange rate, final MAD cost, revenue, and margin by trip/departure.
- Preserve historical exchange rates and approved quote snapshots.
- Feed admin finance summaries and international payment preparation.

## 15. Future Accounting Integration

- Link approved supplier costs to international payment files.
- Generate invoices, subrogation acts, participant lists, passport copy checklists, and bank dossier status.
- Future export to accounting software should use stable IDs and immutable payment history.

## Implementation Principles

- Reuse existing trip operations data instead of duplicating participants, rooms, and extras.
- Prefer dedicated costing/quote tables for indexed financial workflows.
- Keep supplier visibility narrow and role-scoped.
- Keep CRM, passport, visa, payment, and margin data protected by default.
- Use idempotent SQL migrations and explicit RLS policies for every new table.
