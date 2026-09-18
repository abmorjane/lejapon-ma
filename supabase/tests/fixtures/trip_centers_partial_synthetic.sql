-- LOCAL ONLY: synthetic nonempty partial historical deployment.
-- Run on the disposable centers_partial clone BEFORE the new migration.
create table public.trip_messages (
 id uuid primary key,trip_id uuid not null references public.trips(id),
 body text not null,sender_id uuid not null,sender_source text not null default 'supplier',
 metadata jsonb not null default '{}'
);
create table public.trip_documents (
 id uuid primary key,trip_id uuid not null references public.trips(id),
 category text not null default 'other',title text not null,file_name text not null,
 uploaded_by uuid not null,metadata jsonb not null default '{}'
);
insert into public.trip_messages values (
 '61000000-0000-0000-0000-000000000001','21000000-0000-0000-0000-000000000001',
 'Preserved historical message','00000000-0000-0000-0000-000000000001','supplier','{"audit":"preserve"}'
);
insert into public.trip_documents values (
 '71000000-0000-0000-0000-000000000001','21000000-0000-0000-0000-000000000001',
 'hotel_vouchers','Preserved historical voucher','legacy.pdf',
 '00000000-0000-0000-0000-000000000001','{"audit":"preserve"}'
);
alter table public.trip_messages enable row level security;
alter table public.trip_documents enable row level security;
create policy "supplier read accessible trip messages" on public.trip_messages for select
using(public.supplier_can_access_trip(auth.uid(),trip_id));
create policy "supplier update trip documents" on public.trip_documents for update
using(public.supplier_can_access_trip(auth.uid(),trip_id));
-- Simulate explicit legacy column grants as well as inherited default grants.
grant select(body) on public.trip_messages to anon;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
 ('trip-documents','custom historical documents',true,123456,array['application/pdf']);
create policy "supplier read trip document files" on storage.objects for select
using(bucket_id='trip-documents' and public.supplier_can_access_trip(auth.uid(),
 case when split_part(name,'/',1) ~* '^[0-9a-f-]{36}$' then split_part(name,'/',1)::uuid else null end));
