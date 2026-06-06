create table if not exists public.trip_documents (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  quote_id uuid references public.supplier_trip_quotes(id) on delete set null,
  category text not null default 'other' check (category in ('hotel_vouchers','transport_vouchers','guide_confirmations','flight_tickets','rooming_lists','emergency_contacts','contracts','other')),
  title text not null default '',
  file_name text not null default '',
  file_path text,
  file_url text,
  mime_type text,
  size_bytes bigint,
  version int not null default 1,
  uploaded_by uuid not null default auth.uid(),
  uploaded_by_name text,
  uploaded_by_role text,
  uploaded_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.trip_documents
  add column if not exists quote_id uuid references public.supplier_trip_quotes(id) on delete set null,
  add column if not exists category text not null default 'other',
  add column if not exists title text not null default '',
  add column if not exists file_name text not null default '',
  add column if not exists file_path text,
  add column if not exists file_url text,
  add column if not exists mime_type text,
  add column if not exists size_bytes bigint,
  add column if not exists version int not null default 1,
  add column if not exists uploaded_by uuid not null default auth.uid(),
  add column if not exists uploaded_by_name text,
  add column if not exists uploaded_by_role text,
  add column if not exists uploaded_at timestamptz not null default now(),
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists deleted_at timestamptz,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'trip_documents_category_check'
      and conrelid = 'public.trip_documents'::regclass
  ) then
    alter table public.trip_documents
      add constraint trip_documents_category_check
      check (category in ('hotel_vouchers','transport_vouchers','guide_confirmations','flight_tickets','rooming_lists','emergency_contacts','contracts','other'));
  end if;
end $$;

create index if not exists idx_trip_documents_trip_category on public.trip_documents(trip_id, category, uploaded_at desc);
create index if not exists idx_trip_documents_quote on public.trip_documents(quote_id);
create index if not exists idx_trip_documents_uploaded_by on public.trip_documents(uploaded_by);

create or replace function public.trip_documents_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trip_documents_updated_at on public.trip_documents;
create trigger trip_documents_updated_at
before update on public.trip_documents
for each row
execute function public.trip_documents_set_updated_at();

alter table public.trip_documents enable row level security;

drop policy if exists "staff manage trip documents" on public.trip_documents;
create policy "staff manage trip documents"
on public.trip_documents for all
using (public.is_staff(auth.uid()))
with check (public.is_staff(auth.uid()));

drop policy if exists "supplier read accessible trip documents" on public.trip_documents;
create policy "supplier read accessible trip documents"
on public.trip_documents for select
using (
  deleted_at is null
  and public.supplier_can_access_trip(auth.uid(), trip_id)
);

drop policy if exists "supplier insert accessible trip documents" on public.trip_documents;
create policy "supplier insert accessible trip documents"
on public.trip_documents for insert
with check (
  uploaded_by = auth.uid()
  and public.supplier_can_access_trip(auth.uid(), trip_id)
);

drop policy if exists "supplier update accessible trip documents" on public.trip_documents;
create policy "supplier update accessible trip documents"
on public.trip_documents for update
using (public.supplier_can_access_trip(auth.uid(), trip_id))
with check (public.supplier_can_access_trip(auth.uid(), trip_id));

insert into storage.buckets (id, name, public, file_size_limit)
values ('trip-documents', 'trip-documents', false, 52428800)
on conflict (id) do update
set file_size_limit = excluded.file_size_limit;

drop policy if exists "staff manage trip document files" on storage.objects;
create policy "staff manage trip document files"
on storage.objects for all
using (
  bucket_id = 'trip-documents'
  and public.is_staff(auth.uid())
)
with check (
  bucket_id = 'trip-documents'
  and public.is_staff(auth.uid())
);

drop policy if exists "supplier read trip document files" on storage.objects;
create policy "supplier read trip document files"
on storage.objects for select
using (
  bucket_id = 'trip-documents'
  and case
    when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then public.supplier_can_access_trip(auth.uid(), ((storage.foldername(name))[1])::uuid)
    else false
  end
);

drop policy if exists "supplier upload trip document files" on storage.objects;
create policy "supplier upload trip document files"
on storage.objects for insert
with check (
  bucket_id = 'trip-documents'
  and owner = auth.uid()
  and case
    when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then public.supplier_can_access_trip(auth.uid(), ((storage.foldername(name))[1])::uuid)
    else false
  end
);

drop policy if exists "supplier update own trip document files" on storage.objects;
create policy "supplier update own trip document files"
on storage.objects for update
using (
  bucket_id = 'trip-documents'
  and owner = auth.uid()
  and case
    when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then public.supplier_can_access_trip(auth.uid(), ((storage.foldername(name))[1])::uuid)
    else false
  end
)
with check (
  bucket_id = 'trip-documents'
  and owner = auth.uid()
  and case
    when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then public.supplier_can_access_trip(auth.uid(), ((storage.foldername(name))[1])::uuid)
    else false
  end
);

drop policy if exists "supplier delete own trip document files" on storage.objects;
create policy "supplier delete own trip document files"
on storage.objects for delete
using (
  bucket_id = 'trip-documents'
  and owner = auth.uid()
  and case
    when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then public.supplier_can_access_trip(auth.uid(), ((storage.foldername(name))[1])::uuid)
    else false
  end
);

notify pgrst, 'reload schema';
