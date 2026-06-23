alter table public.fit_quotes
  add column if not exists version_number integer not null default 1;

create index if not exists fit_quotes_version_number_idx on public.fit_quotes(version_number);

notify pgrst, 'reload schema';
