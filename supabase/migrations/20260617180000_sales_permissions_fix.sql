-- Sales / Sales Manager permission correction.
-- Sales roles can create partner-style FIT quotes, but cannot access international payments.

create or replace function public.can_access_international_payments(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    where ur.user_id = _user_id
      and ur.role::text in ('super_admin', 'admin')
  );
$$;

create or replace function public.can_create_partner_fit_quotes(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    where ur.user_id = _user_id
      and ur.role::text in (
        'super_admin',
        'admin',
        'manager',
        'sales',
        'sales_user',
        'sales_manager',
        'partner_agency_admin',
        'partner_agent'
      )
  )
  or exists (
    select 1
    from public.organization_members om
    join public.organizations o on o.id = om.organization_id
    where om.user_id = _user_id
      and om.status = 'active'
      and o.type = 'agency'
      and o.status = 'active'
  );
$$;

drop policy if exists "staff read japan partner settings" on public.japan_partner_settings;
create policy "staff read japan partner settings" on public.japan_partner_settings
for select using (public.can_access_international_payments(auth.uid()));

drop policy if exists "admin manage japan partner settings" on public.japan_partner_settings;
create policy "admin manage japan partner settings" on public.japan_partner_settings
for all using (public.can_access_international_payments(auth.uid()))
with check (public.can_access_international_payments(auth.uid()));

drop policy if exists "staff read japan suppliers" on public.japan_suppliers;
create policy "staff read japan suppliers" on public.japan_suppliers
for select using (public.can_access_international_payments(auth.uid()));

drop policy if exists "admin manage japan suppliers" on public.japan_suppliers;
create policy "admin manage japan suppliers" on public.japan_suppliers
for all using (public.can_access_international_payments(auth.uid()))
with check (public.can_access_international_payments(auth.uid()));

drop policy if exists "staff read international payment files" on public.international_payment_files;
create policy "staff read international payment files" on public.international_payment_files
for select using (public.can_access_international_payments(auth.uid()));

drop policy if exists "admin manage international payment files" on public.international_payment_files;
create policy "admin manage international payment files" on public.international_payment_files
for all using (public.can_access_international_payments(auth.uid()))
with check (public.can_access_international_payments(auth.uid()));

drop policy if exists "staff read international payment documents" on public.international_payment_file_documents;
create policy "staff read international payment documents" on public.international_payment_file_documents
for select using (public.can_access_international_payments(auth.uid()));

drop policy if exists "admin manage international payment documents" on public.international_payment_file_documents;
create policy "admin manage international payment documents" on public.international_payment_file_documents
for all using (public.can_access_international_payments(auth.uid()))
with check (public.can_access_international_payments(auth.uid()));

drop policy if exists "staff read international payment subrogations" on public.international_payment_subrogations;
create policy "staff read international payment subrogations" on public.international_payment_subrogations
for select using (public.can_access_international_payments(auth.uid()));

drop policy if exists "admin manage international payment subrogations" on public.international_payment_subrogations;
create policy "admin manage international payment subrogations" on public.international_payment_subrogations
for all using (public.can_access_international_payments(auth.uid()))
with check (public.can_access_international_payments(auth.uid()));

drop policy if exists "staff read international payment history" on public.international_payment_history;
create policy "staff read international payment history" on public.international_payment_history
for select using (public.can_access_international_payments(auth.uid()));

drop policy if exists "admin insert international payment history" on public.international_payment_history;
create policy "admin insert international payment history" on public.international_payment_history
for insert with check (public.can_access_international_payments(auth.uid()));

drop policy if exists "staff read international payment participants" on public.international_payment_participants;
create policy "staff read international payment participants" on public.international_payment_participants
for select using (public.can_access_international_payments(auth.uid()));

drop policy if exists "admin manage international payment participants" on public.international_payment_participants;
create policy "admin manage international payment participants" on public.international_payment_participants
for all using (public.can_access_international_payments(auth.uid()))
with check (public.can_access_international_payments(auth.uid()));

drop policy if exists "staff read international payment files storage" on storage.objects;
create policy "staff read international payment files storage" on storage.objects
for select using (
  bucket_id = 'international-payments'
  and public.can_access_international_payments(auth.uid())
);

drop policy if exists "admin upload international payment files storage" on storage.objects;
create policy "admin upload international payment files storage" on storage.objects
for insert with check (
  bucket_id = 'international-payments'
  and public.can_access_international_payments(auth.uid())
);

drop policy if exists "admin update international payment files storage" on storage.objects;
create policy "admin update international payment files storage" on storage.objects
for update using (
  bucket_id = 'international-payments'
  and public.can_access_international_payments(auth.uid())
)
with check (
  bucket_id = 'international-payments'
  and public.can_access_international_payments(auth.uid())
);

drop policy if exists "admin delete international payment files storage" on storage.objects;
create policy "admin delete international payment files storage" on storage.objects
for delete using (
  bucket_id = 'international-payments'
  and public.can_access_international_payments(auth.uid())
);

notify pgrst, 'reload schema';
