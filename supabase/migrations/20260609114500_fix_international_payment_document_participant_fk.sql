update public.international_payment_file_documents d
set participant_id = p.id
from public.international_payment_participants p
where d.participant_id is not null
  and d.payment_file_id = p.payment_file_id
  and d.participant_id = p.source_participant_id;

update public.international_payment_subrogations s
set participant_id = p.id
from public.international_payment_participants p
where s.participant_id is not null
  and s.payment_file_id = p.payment_file_id
  and s.participant_id = p.source_participant_id;

update public.international_payment_file_documents d
set participant_id = null
where d.participant_id is not null
  and not exists (
    select 1
    from public.international_payment_participants p
    where p.id = d.participant_id
  );

update public.international_payment_subrogations s
set participant_id = null
where s.participant_id is not null
  and not exists (
    select 1
    from public.international_payment_participants p
    where p.id = s.participant_id
  );

alter table public.international_payment_file_documents
  drop constraint if exists international_payment_file_documents_participant_id_fkey;

alter table public.international_payment_subrogations
  drop constraint if exists international_payment_subrogations_participant_id_fkey;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'international_payment_file_documents_participant_id_fkey'
      and conrelid = 'public.international_payment_file_documents'::regclass
  ) then
    alter table public.international_payment_file_documents
      add constraint international_payment_file_documents_participant_id_fkey
      foreign key (participant_id)
      references public.international_payment_participants(id)
      on delete set null;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'international_payment_subrogations_participant_id_fkey'
      and conrelid = 'public.international_payment_subrogations'::regclass
  ) then
    alter table public.international_payment_subrogations
      add constraint international_payment_subrogations_participant_id_fkey
      foreign key (participant_id)
      references public.international_payment_participants(id)
      on delete set null;
  end if;
end $$;

create index if not exists idx_ipfd_payment_participant
  on public.international_payment_file_documents(participant_id)
  where participant_id is not null;

create index if not exists idx_ip_subrogations_payment_participant
  on public.international_payment_subrogations(participant_id)
  where participant_id is not null;

notify pgrst, 'reload schema';
