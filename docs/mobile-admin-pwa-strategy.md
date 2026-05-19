# LeJapon.ma Mobile Admin PWA Strategy

## Objective

Make the existing LeJapon.ma admin platform feel usable as a mobile app before investing in native Android or iOS builds. The first release should be a Progressive Web App (PWA) that reuses the current React admin dashboard, Supabase database, Supabase auth, and role-based permissions.

## Recommended first step

Ship a PWA version of `/admin`:

- Installable from Android Chrome and iOS Safari.
- Opens directly into the admin dashboard through `start_url: /admin`.
- Uses the same website data and Supabase row-level security.
- Keeps admin permissions enforced by the existing role model in `src/admin/lib/permissions.ts`.
- Provides offline-friendly loading for the app shell, icons, login route, and an offline fallback page.

The repo now includes the baseline installability layer:

- `public/manifest.webmanifest`
- `public/sw.js`
- `public/offline.html`
- `public/icon-192.png`
- `public/icon-512.png`
- `src/pwa.ts`
- PWA metadata in `index.html`

## Product scope

### Phase 1: Mobile admin PWA

Focus on fast daily operations for admins, managers, and agents.

Core mobile destinations:

- Reservations: list, filter, search, open detail, update status.
- Clients CRM: search, call, WhatsApp, email, view bookings.
- Visa applications: list, filter by missing documents or status, open detail.
- Payments: payment status, received amount, outstanding balance.
- Documents PDF: view/download booking and visa PDFs.
- Blog/articles: edit or publish lightweight content updates.
- Programs: view and adjust itinerary/program content.

Mobile dashboard:

- Show priority counts first: new bookings, pending visa requests, unpaid payments, missing documents, upcoming departures.
- Use large tap targets and compact cards instead of dense desktop tables.
- Keep the first screen operational, not decorative.

Quick actions:

- `tel:` link for calling the client.
- `https://wa.me/` link for WhatsApp.
- `mailto:` link for email.
- Inline reservation status update with permission checks.
- PDF download/open action from booking and visa details.

### Phase 2: Mobile workflow polish

- Add saved filters for reservations, clients, visa, and payments.
- Add optimistic updates for low-risk status changes.
- Add skeleton loading states for mobile routes.
- Add mobile-specific detail summaries above long forms.
- Add "recently opened" and "assigned to me" views.

### Phase 3: Push notification readiness

Prepare the database and backend event model before enabling browser push:

- New booking.
- New visa request.
- Payment update.
- Missing document.
- Upcoming departure.

Recommended architecture:

- Create a `notification_events` table for canonical event records.
- Create a `user_notification_preferences` table per staff user.
- Create a `device_subscriptions` table for future Web Push subscriptions.
- Generate events from Supabase triggers or edge functions.
- Deliver initially inside the admin dashboard, then add Web Push after the event model is stable.

## Technical requirements

### Data

- Reuse the same Supabase database.
- Do not create a separate mobile database.
- Do not duplicate reservation, client, payment, visa, article, document, or program records.
- Add only mobile-specific metadata when needed, such as notification preferences or saved filters.

### Security

- Keep Supabase Auth as the login source.
- Keep module-level permissions in `src/admin/lib/permissions.ts`.
- Keep route-level checks through `RequireRole`.
- Verify that Supabase RLS policies match the same role assumptions as the UI.
- Never cache private API responses or Supabase data in the service worker.
- Cache only the app shell and static assets until an explicit offline data policy exists.

### Performance

- Prefer route-level code splitting for heavy admin screens.
- Paginate large lists and use server-side filters.
- Keep search debounced on mobile.
- Avoid loading PDF generation libraries until the user requests a PDF.
- Use React Query cache times intentionally for dashboard counts and list views.

## PWA behavior

Installability:

- Android: Chrome should offer install when served over HTTPS.
- iOS: users install through Safari's "Add to Home Screen".
- App opens in standalone mode.
- The app icon is based on existing public favicon assets and exported at standard PWA sizes.

Splash screen:

- Controlled through manifest colors, icon, and iOS web app meta tags.
- Replace the current favicon-derived icons with final maskable brand artwork when app branding is approved.

Offline-friendly loading:

- Service worker caches the app shell and static assets.
- Navigations fall back to `offline.html` if the network is unavailable.
- Sensitive admin data remains online-only for now.

## Native app decision gate

Build native Android/iOS only after the PWA proves one of these limits is blocking operations:

- Push notifications are mission critical and browser push is insufficient for the team.
- Offline data entry is required in the field.
- Device integrations become important, such as camera scanning, local file storage, or contact sync.
- App store distribution is required for brand or compliance reasons.

Until then, the PWA should remain the primary mobile admin product.
