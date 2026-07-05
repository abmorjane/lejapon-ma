-- The visa landing page is public, but document requirements are managed in
-- backoffice. Expose only active checklist configurations, never applications
-- or uploaded traveler documents.

drop policy if exists "public read active visa checklists" on public.visa_document_checklists;

create policy "public read active visa checklists"
  on public.visa_document_checklists
  for select
  using (is_active = true);
