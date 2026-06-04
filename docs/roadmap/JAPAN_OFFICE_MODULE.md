# Japan Office / Supplier Module Roadmap

Goal: prepare a Japan-side operations workspace for suppliers and internal Japan office coordination without disrupting the stabilized V2 agency/admin/public flows.

## Supplier portal

- Supplier login at `/supplier/login`.
- Supplier dashboard at `/supplier`.
- Supplier profile scoped to the supplier organization/account.
- Supplier types:
  - hotel
  - guide
  - transport
  - activity
- Supplier sees only assigned trips, service requests, comments, documents, and operational tasks.
- Admin creates and manages supplier accounts from `/admin/suppliers` or `/admin/users`.

## Quote engine

- Internal quote builder for Japan office costing.
- Cost lines by supplier, destination, trip, departure, and service type.
- Margin and commission visibility for admin only.
- Comparison between supplier cost, client price, agency commission, and LeJapon.ma margin.
- Versioned quote snapshots for approvals.

## Hotel costing

- Hotel supplier profiles with city, category, room types, contract rates, seasons, taxes, and cancellation rules.
- Costing per room type:
  - single
  - double
  - twin
  - triple
- Rooming-list integration.
- Hotel confirmation status per departure.

## Transport costing

- Transport supplier profiles with vehicle types, routes, pickup/dropoff, luggage limits, and driver language.
- Costing by route, date, vehicle, duration, and group size.
- Assignment to trip departures and operational day blocks.

## Guide costing

- Guide supplier profiles with languages, cities, day rates, half-day rates, overtime, and availability notes.
- Assignment by programme day, city, and group.
- Guide instructions and participant context.

## Activity costing

- Activity supplier profiles with ticket/activity cost, capacity, booking deadline, cancellation policy, and included/excluded notes.
- Activity allocation by programme day and participant count.
- Integration with selected extras where appropriate.

## Participant lists

- Shared read-only participant lists for selected suppliers when needed.
- Privacy-controlled fields only:
  - names
  - room allocation where needed
  - dietary/accessibility notes where needed
  - no passport data unless explicitly required and policy-approved.

## Rooming lists

- Exportable hotel rooming lists.
- Copy allocation between hotels.
- Supplier-facing rooming-list confirmation.
- Admin override history.

## Collaboration and comments

- Threaded comments by trip/departure/service.
- Internal-only notes separated from supplier-visible comments.
- Attachments for confirmations, invoices, vouchers, and operational docs.
- Mentions and assigned follow-ups for Japan office/admin.

## Notifications

- Email notifications for supplier assignments, quote requests, confirmation requests, and changes.
- Admin notifications for supplier replies, price changes, and missing confirmations.
- Future WhatsApp/LINE integration can be added without changing core supplier records.

## Approval workflow

- Draft quote/costing.
- Supplier submitted.
- Japan office reviewed.
- Admin approved.
- Locked for departure.
- Change request / revision.
- Cancelled.

## Suggested implementation order

1. Supplier data model and admin supplier CRUD.
2. Supplier portal authentication and scoped dashboard.
3. Assignment model linking suppliers to trip departures/programme days.
4. Hotel rooming-list confirmation.
5. Quote/cost engine V1.
6. Supplier comments/attachments.
7. Notifications.
8. Approval workflow and audit trail.

## Data model direction

- Prefer existing `organizations` / `organization_members` for supplier accounts if compatible.
- Add supplier-specific profile tables only where metadata becomes too large or operational queries need indexing.
- Keep supplier pricing/costing separate from public trip pricing.
- Keep agency reservations and Japan supplier costing linked but not merged until conversion rules are explicit.

## Safety notes

- Do not expose client passport, visa, payment, or internal margin data to suppliers by default.
- Keep admin/internal notes separate from supplier-visible notes.
- Keep Japan office costing out of public and agency portals unless explicitly approved.
