create table if not exists public.trip_messages (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  quote_id uuid references public.supplier_trip_quotes(id) on delete set null,
  message_type text not null default 'general' check (message_type in ('general','hotel','transport','activities','guides','urgent')),
  body text not null,
  sender_id uuid not null default auth.uid(),
  sender_name text,
  sender_role text,
  sender_source text not null default 'admin' check (sender_source in ('morocco_office','japan_office','admin','supplier')),
  metadata jsonb not null default '{}'::jsonb,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.trip_message_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.trip_messages(id) on delete cascade,
  file_name text not null,
  file_path text,
  file_url text,
  mime_type text,
  size_bytes bigint,
  uploaded_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.trip_message_reads (
  message_id uuid not null references public.trip_messages(id) on delete cascade,
  user_id uuid not null default auth.uid(),
  read_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

create index if not exists idx_trip_messages_trip_created on public.trip_messages(trip_id, created_at desc);
create index if not exists idx_trip_messages_trip_type on public.trip_messages(trip_id, message_type);
create index if not exists idx_trip_messages_quote on public.trip_messages(quote_id);
create index if not exists idx_trip_message_attachments_message on public.trip_message_attachments(message_id);
create index if not exists idx_trip_message_reads_user on public.trip_message_reads(user_id, read_at desc);

create or replace function public.trip_messages_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trip_messages_updated_at on public.trip_messages;
create trigger trip_messages_updated_at
before update on public.trip_messages
for each row
execute function public.trip_messages_set_updated_at();

alter table public.trip_messages enable row level security;
alter table public.trip_message_attachments enable row level security;
alter table public.trip_message_reads enable row level security;

drop policy if exists "staff manage trip messages" on public.trip_messages;
create policy "staff manage trip messages"
on public.trip_messages for all
using (public.is_staff(auth.uid()))
with check (public.is_staff(auth.uid()));

drop policy if exists "supplier read accessible trip messages" on public.trip_messages;
create policy "supplier read accessible trip messages"
on public.trip_messages for select
using (
  deleted_at is null
  and public.supplier_can_access_trip(auth.uid(), trip_id)
);

drop policy if exists "supplier insert accessible trip messages" on public.trip_messages;
create policy "supplier insert accessible trip messages"
on public.trip_messages for insert
with check (
  sender_id = auth.uid()
  and sender_source in ('japan_office','supplier')
  and public.supplier_can_access_trip(auth.uid(), trip_id)
);

drop policy if exists "supplier update own trip messages" on public.trip_messages;
create policy "supplier update own trip messages"
on public.trip_messages for update
using (
  sender_id = auth.uid()
  and public.supplier_can_access_trip(auth.uid(), trip_id)
)
with check (
  sender_id = auth.uid()
  and public.supplier_can_access_trip(auth.uid(), trip_id)
);

drop policy if exists "staff manage trip message attachments" on public.trip_message_attachments;
create policy "staff manage trip message attachments"
on public.trip_message_attachments for all
using (public.is_staff(auth.uid()))
with check (public.is_staff(auth.uid()));

drop policy if exists "supplier read accessible trip message attachments" on public.trip_message_attachments;
create policy "supplier read accessible trip message attachments"
on public.trip_message_attachments for select
using (
  exists (
    select 1
    from public.trip_messages m
    where m.id = message_id
      and m.deleted_at is null
      and public.supplier_can_access_trip(auth.uid(), m.trip_id)
  )
);

drop policy if exists "supplier insert own trip message attachments" on public.trip_message_attachments;
create policy "supplier insert own trip message attachments"
on public.trip_message_attachments for insert
with check (
  uploaded_by = auth.uid()
  and exists (
    select 1
    from public.trip_messages m
    where m.id = message_id
      and m.sender_id = auth.uid()
      and public.supplier_can_access_trip(auth.uid(), m.trip_id)
  )
);

drop policy if exists "staff manage trip message reads" on public.trip_message_reads;
create policy "staff manage trip message reads"
on public.trip_message_reads for all
using (public.is_staff(auth.uid()))
with check (public.is_staff(auth.uid()));

drop policy if exists "users manage own trip message reads" on public.trip_message_reads;
create policy "users manage own trip message reads"
on public.trip_message_reads for all
using (
  user_id = auth.uid()
  and exists (
    select 1
    from public.trip_messages m
    where m.id = message_id
      and (
        public.is_staff(auth.uid())
        or public.supplier_can_access_trip(auth.uid(), m.trip_id)
      )
  )
)
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.trip_messages m
    where m.id = message_id
      and (
        public.is_staff(auth.uid())
        or public.supplier_can_access_trip(auth.uid(), m.trip_id)
      )
  )
);

insert into storage.buckets (id, name, public, file_size_limit)
values ('trip-message-attachments', 'trip-message-attachments', false, 10485760)
on conflict (id) do update
set file_size_limit = excluded.file_size_limit;

drop policy if exists "staff manage trip message attachment files" on storage.objects;
create policy "staff manage trip message attachment files"
on storage.objects for all
using (
  bucket_id = 'trip-message-attachments'
  and public.is_staff(auth.uid())
)
with check (
  bucket_id = 'trip-message-attachments'
  and public.is_staff(auth.uid())
);

drop policy if exists "supplier read trip message attachment files" on storage.objects;
create policy "supplier read trip message attachment files"
on storage.objects for select
using (
  bucket_id = 'trip-message-attachments'
  and case
    when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then public.supplier_can_access_trip(auth.uid(), ((storage.foldername(name))[1])::uuid)
    else false
  end
);

drop policy if exists "supplier upload trip message attachment files" on storage.objects;
create policy "supplier upload trip message attachment files"
on storage.objects for insert
with check (
  bucket_id = 'trip-message-attachments'
  and owner = auth.uid()
  and case
    when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then public.supplier_can_access_trip(auth.uid(), ((storage.foldername(name))[1])::uuid)
    else false
  end
);

drop policy if exists "supplier delete own trip message attachment files" on storage.objects;
create policy "supplier delete own trip message attachment files"
on storage.objects for delete
using (
  bucket_id = 'trip-message-attachments'
  and owner = auth.uid()
  and case
    when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then public.supplier_can_access_trip(auth.uid(), ((storage.foldername(name))[1])::uuid)
    else false
  end
);

notify pgrst, 'reload schema';
