alter table public.supplier_trip_quotes
  add column if not exists validation_status text not null default 'draft',
  add column if not exists validation_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists validation_completion_percentage numeric not null default 0,
  add column if not exists validation_updated_by uuid,
  add column if not exists validation_updated_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'supplier_trip_quotes_validation_status_check'
      and conrelid = 'public.supplier_trip_quotes'::regclass
  ) then
    alter table public.supplier_trip_quotes
      add constraint supplier_trip_quotes_validation_status_check
      check (validation_status in ('draft','in_progress','ready_for_japan_office','japan_office_confirmed','ready_to_travel'));
  end if;
end $$;

create index if not exists idx_supplier_trip_quotes_validation_status
  on public.supplier_trip_quotes(validation_status);

create index if not exists idx_supplier_trip_quotes_validation_updated_at
  on public.supplier_trip_quotes(validation_updated_at desc);

notify pgrst, 'reload schema';
