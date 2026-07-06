-- Commercial documents / accounting stabilization.
-- Keep existing booking_documents as the document ledger and extend it safely.

alter table public.bookings
  add column if not exists deposit_type text not null default 'fixed',
  add column if not exists deposit_value numeric not null default 25000,
  add column if not exists deposit_is_per_person boolean not null default true,
  add column if not exists deposit_amount numeric;

alter table public.bookings
  drop constraint if exists bookings_deposit_type_check;

alter table public.bookings
  add constraint bookings_deposit_type_check
  check (deposit_type in ('fixed', 'percentage'));

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
