
-- Use security_invoker so RLS of the calling user applies
ALTER VIEW public.marketing_contacts_view SET (security_invoker = true);

-- Restrict segment resolution to authenticated users only
REVOKE EXECUTE ON FUNCTION public.resolve_marketing_segment(uuid) FROM anon;
