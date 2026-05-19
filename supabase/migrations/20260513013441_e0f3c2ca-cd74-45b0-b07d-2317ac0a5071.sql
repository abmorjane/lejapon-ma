CREATE OR REPLACE FUNCTION public.claim_marketing_batch(_campaign_id uuid, _limit integer)
RETURNS TABLE (
  id uuid,
  email text,
  full_name text,
  client_id uuid,
  tracking_token text,
  unsubscribe_token uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT r.id
    FROM public.email_campaign_recipients r
    WHERE r.campaign_id = _campaign_id
      AND r.status = 'pending'
    ORDER BY r.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT _limit
  ),
  upd AS (
    UPDATE public.email_campaign_recipients r
       SET status = 'sending'
      FROM picked p
     WHERE r.id = p.id
    RETURNING r.id, r.email, r.full_name, r.client_id, r.tracking_token
  )
  SELECT u.id, u.email, u.full_name, u.client_id, u.tracking_token, c.unsubscribe_token
    FROM upd u
    LEFT JOIN public.clients c ON c.id = u.client_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.claim_marketing_batch(uuid, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_marketing_batch(uuid, integer) TO service_role;
