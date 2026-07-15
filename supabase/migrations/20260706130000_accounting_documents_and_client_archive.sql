-- Commercial documents / accounting stabilization.
-- Keep existing booking_documents as the document ledger and extend it safely.

alter table public.bookings
  add column if not exists deposit_type text not null default 'fixed',
  add column if not exists deposit_value numeric not null default 25000,
  add column if not exists deposit_is_per_person boolean not null default true,
  add column if not exists deposit_amount numeric,
  add column if not exists deposit_amount_mad numeric;

update public.bookings
set deposit_amount_mad = deposit_amount
where deposit_amount_mad is null
  and deposit_amount is not null;

update public.bookings
set deposit_amount = deposit_amount_mad
where deposit_amount is null
  and deposit_amount_mad is not null;

alter table public.bookings
  drop constraint if exists bookings_deposit_type_check;

alter table public.bookings
  add constraint bookings_deposit_type_check
  check (deposit_type in ('fixed', 'percentage'));

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'bookings'
      and column_name = 'metadata'
  ) then
    execute $sql$
      update public.bookings
      set
        deposit_type = case
          when metadata->>'deposit_type' = 'percentage' then 'percentage'
          else coalesce(nullif(metadata->>'deposit_type', ''), deposit_type, 'fixed')
        end,
        deposit_value = case
          when nullif(metadata->>'deposit_value', '') ~ '^[0-9]+(\.[0-9]+)?$' then (metadata->>'deposit_value')::numeric
          else coalesce(deposit_value, 25000)
        end,
        deposit_is_per_person = case
          when metadata->>'deposit_type' = 'percentage' then false
          when metadata ? 'deposit_is_per_person' then coalesce((metadata->>'deposit_is_per_person')::boolean, true)
          when metadata ? 'deposit_per_person' then coalesce((metadata->>'deposit_per_person')::boolean, true)
          else deposit_is_per_person
        end,
        deposit_amount = case
          when nullif(metadata->>'deposit_amount_calculated', '') ~ '^[0-9]+(\.[0-9]+)?$' then (metadata->>'deposit_amount_calculated')::numeric
          else deposit_amount
        end,
        deposit_amount_mad = case
          when nullif(metadata->>'deposit_amount_calculated', '') ~ '^[0-9]+(\.[0-9]+)?$' then (metadata->>'deposit_amount_calculated')::numeric
          when nullif(metadata->>'deposit_amount_mad', '') ~ '^[0-9]+(\.[0-9]+)?$' then (metadata->>'deposit_amount_mad')::numeric
          else deposit_amount_mad
        end
      where metadata ? 'deposit_type'
         or metadata ? 'deposit_value'
         or metadata ? 'deposit_is_per_person'
         or metadata ? 'deposit_per_person'
         or metadata ? 'deposit_amount_calculated'
         or metadata ? 'deposit_amount_mad';
    $sql$;
  end if;
end;
$$;

alter table public.booking_documents
  add column if not exists invoice_type text,
  add column if not exists remaining_mad numeric,
  add column if not exists issued_at timestamptz not null default now();

alter table public.booking_documents
  drop constraint if exists booking_documents_kind_check;

alter table public.booking_documents
  add constraint booking_documents_kind_check
  check (kind in ('quote','receipt','invoice','billet_avion','reservation_hotel_extra','reservation_activite_extra','assurance','visa','passeport','autre'));

alter table public.booking_documents
  drop constraint if exists booking_documents_invoice_type_check;

alter table public.booking_documents
  add constraint booking_documents_invoice_type_check
  check (invoice_type is null or invoice_type in ('proforma','deposit','final'));

create index if not exists idx_booking_documents_invoice_type on public.booking_documents(invoice_type);
create index if not exists idx_booking_documents_issued_at on public.booking_documents(issued_at);

alter table public.clients
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users(id) on delete set null,
  add column if not exists archive_reason text;

create index if not exists idx_clients_archived_at on public.clients(archived_at);

notify pgrst, 'reload schema';
