CREATE OR REPLACE FUNCTION public.is_staff(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id
      and role in ('super_admin','admin','manager','agent','content_manager')
  )
$function$;

CREATE OR REPLACE FUNCTION public.has_any_role(_user_id uuid, _roles app_role[])
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role = ANY(_roles)
  )
$function$;

DROP POLICY IF EXISTS "admins manage roles" ON public.user_roles;
CREATE POLICY "super_admins manage roles"
ON public.user_roles FOR ALL
USING (public.has_role(auth.uid(), 'super_admin'))
WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

DROP POLICY IF EXISTS "users see own roles" ON public.user_roles;
CREATE POLICY "read own or staff-admin reads all"
ON public.user_roles FOR SELECT
USING (
  auth.uid() = user_id
  OR public.has_role(auth.uid(), 'super_admin')
  OR public.has_role(auth.uid(), 'admin')
);