# Post Email Stabilization Checkpoint

Date: 2026-06-06

## Scope

This checkpoint captures the codebase after the email template stabilization and cleanup pass.

## Confirmations

- Temporary visa email source markers were removed from Edge Functions and admin UI.
- `SOURCE_DEBUG` markers are not present in `src` or `supabase/functions`.
- `FRONTEND_DEBUG` markers are not present in `src` or `supabase/functions`.
- `FRONTEND_BUILD` / `ADMIN_BUILD_VERSION` visa debug markers are not present in `src` or `supabase/functions`.
- Literal legacy branding strings `Tapis Volant`, `L'équipe Tapis Volant`, `L’équipe Tapis Volant`, `Tapis Volant — Le Japon`, and `Trips app` are not present in Edge Functions.

## Email Infrastructure Preserved

- Runtime email template lookup remains active.
- Email template fallback rendering remains active.
- Legacy-brand sanitizer guardrails remain active in Edge Functions to rewrite old stored template content if encountered.
- Test template sending remains available through `send-admin-notification`.

## Edge Functions To Redeploy

- `send-visa-email`
- `send-visa-reminders`
- `visa-client-signup`
- `send-admin-notification`

## Verification

- `deno check` previously passed for all four changed Edge Functions during cleanup.
- `npm run build` must pass for this checkpoint before commit.

## Notes

- This checkpoint does not change Supabase dashboard configuration.
- This checkpoint does not add SQL.
