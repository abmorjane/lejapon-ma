alter table public.international_payment_participants
  add column if not exists source_participant_id uuid references public.booking_participants(id) on delete set null;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'international_payment_participants'
      and column_name = 'participant_id'
  ) then
    execute 'update public.international_payment_participants set source_participant_id = participant_id where source_participant_id is null and participant_id is not null';
  end if;
end $$;

create unique index if not exists idx_ipp_unique_source
  on public.international_payment_participants(payment_file_id, source_participant_id)
  where source_participant_id is not null;

create index if not exists idx_ipp_payment_file_passport
  on public.international_payment_participants(payment_file_id, passport_no)
  where passport_no is not null and passport_no <> '';

notify pgrst, 'reload schema';
