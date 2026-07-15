-- Track whether admin/staff has seen a client review request on a travel agreement.
-- The original acceptance/review rows stay immutable; reading a remark only fills
-- this timestamp for admin workflow purposes.

alter table public.travel_agreement_acceptances
  add column if not exists admin_seen_at timestamptz;

create index if not exists idx_travel_agreement_acceptances_unseen_reviews
  on public.travel_agreement_acceptances (agreement_id, created_at desc)
  where status = 'needs_review' and admin_seen_at is null;

notify pgrst, 'reload schema';
