# Clarity UX Fixes Checkpoint

Date: 2026-06-06

## Issues Found In Clarity

- Mobile users on `/reserver` selected a trip, then had to scroll to find the next action.
- The booking funnel had weak mobile progression cues and too much reliance on in-page navigation.
- `/reserver` needed lower interaction cost after trip selection and fewer unnecessary renders.
- `/programme` had CLS risk from image loading and variable programme day media/card heights.

## Fixes Applied

### `/programme`

- Reserved hero image space before loading with stable responsive min-heights.
- Added explicit image `width` and `height` values on programme hero, day images, and gallery images.
- Added default intrinsic dimensions in the shared `Img` component for `thumb`, `card`, `hero`, and `full` presets.
- Stabilized programme day sections with reserved media/card heights.
- Added a stable loading/content shell to reduce load-time jumps.

### `/reserver`

- Added auto-advance after trip selection with a 275ms delay.
- Preserved Back navigation so users can return and change the selected trip.
- Added a mobile sticky footer with always-visible Back and Next/Confirm actions.
- Added safe-area bottom padding so the footer does not cover fields.
- Kept the progress indicator visible in the mobile footer.
- Added selected trip summary on later steps with a “Modifier le voyage” action.
- Memoized trip selection cards, counters, fields, summary items, and selected-trip lookup.
- Added no-op state guards for contact fields and extras quantities.

## Analytics Added

Events added without personal data:

- `booking_trip_selected`
- `booking_step_advanced`
- `booking_form_started`
- `booking_form_submitted`

Payloads use non-personal fields such as source, step numbers, trip id/slug, trip index, traveler count, and extras count.

## Pages Affected

- `/programme`
- `/reserver`

## Next Metrics To Monitor

- `/programme` CLS, target: `< 0.1`
- `/reserver` INP on mobile, target: good Core Web Vitals range
- Mobile booking step drop-off after trip selection
- Time from trip selection to step 2 interaction
- Booking form completion rate on mobile
- Sticky footer tap usage and Back/Modify trip usage

## Build Verification

- Run `npm run build` before deployment.
- Existing non-blocking warnings may appear for outdated Browserslist data and large Vite chunks.
