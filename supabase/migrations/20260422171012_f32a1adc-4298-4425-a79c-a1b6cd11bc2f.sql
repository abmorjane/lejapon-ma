-- 1. Fix search_path on set_updated_at
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin new.updated_at = now(); return new; end;
$$;

-- 2. Restrict listing on media bucket: keep direct read by URL but block list operations to staff
drop policy if exists "public read media bucket" on storage.objects;

create policy "staff list media bucket"
  on storage.objects for select
  using (bucket_id = 'media' and public.is_staff(auth.uid()));

-- Note: bucket remains public so files can be served by URL (e.g. <img src="https://.../media/xxx">),
-- but listing the contents requires staff role.