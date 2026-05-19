
-- 1. Add loyalty fields to clients
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS trips_completed integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rewards_used integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS loyalty_tier text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS is_returning boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS first_trip_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_trip_at timestamptz;

-- 2. Reward type enum
DO $$ BEGIN
  CREATE TYPE public.reward_type AS ENUM ('discount', 'free_activity', 'vip_upgrade');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.reward_status AS ENUM ('available', 'used', 'expired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3. Client rewards table
CREATE TABLE IF NOT EXISTS public.client_rewards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  type public.reward_type NOT NULL,
  status public.reward_status NOT NULL DEFAULT 'available',
  label text NOT NULL,
  value_mad numeric NOT NULL DEFAULT 0,
  percent integer,
  granted_reason text,
  used_booking_id uuid,
  used_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_rewards_client ON public.client_rewards(client_id);
CREATE INDEX IF NOT EXISTS idx_client_rewards_status ON public.client_rewards(status);

ALTER TABLE public.client_rewards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff manage client_rewards" ON public.client_rewards;
CREATE POLICY "staff manage client_rewards" ON public.client_rewards
  FOR ALL USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "staff read client_rewards" ON public.client_rewards;
CREATE POLICY "staff read client_rewards" ON public.client_rewards
  FOR SELECT USING (public.is_staff(auth.uid()));

CREATE TRIGGER trg_client_rewards_updated
  BEFORE UPDATE ON public.client_rewards
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4. Recalculate loyalty function
CREATE OR REPLACE FUNCTION public.recalculate_client_loyalty(_client_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _count integer;
  _first timestamptz;
  _last timestamptz;
  _tier text;
  _prev_tier text;
BEGIN
  SELECT count(*), min(created_at), max(updated_at)
    INTO _count, _first, _last
  FROM public.bookings
  WHERE client_id = _client_id AND status IN ('completed','paid');

  _tier := CASE
    WHEN _count >= 5 THEN 'gold'
    WHEN _count >= 3 THEN 'silver'
    WHEN _count >= 1 THEN 'bronze'
    ELSE 'none'
  END;

  SELECT loyalty_tier INTO _prev_tier FROM public.clients WHERE id = _client_id;

  UPDATE public.clients
    SET trips_completed = _count,
        is_returning = (_count >= 2),
        loyalty_tier = _tier,
        first_trip_at = COALESCE(first_trip_at, _first),
        last_trip_at = _last,
        updated_at = now()
    WHERE id = _client_id;

  -- Auto-grant a reward when newly eligible (returning client) and no available reward exists
  IF _count >= 2 AND _prev_tier IS DISTINCT FROM _tier THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.client_rewards
      WHERE client_id = _client_id AND status = 'available'
    ) THEN
      INSERT INTO public.client_rewards (client_id, type, label, percent, granted_reason)
      VALUES (
        _client_id,
        CASE WHEN _tier = 'gold' THEN 'vip_upgrade'
             WHEN _tier = 'silver' THEN 'free_activity'
             ELSE 'discount' END,
        CASE WHEN _tier = 'gold' THEN 'Surclassement VIP offert'
             WHEN _tier = 'silver' THEN 'Activité offerte'
             ELSE '10% sur le prochain voyage' END,
        CASE WHEN _tier = 'bronze' THEN 10 ELSE NULL END,
        'Atteinte du palier ' || _tier
      );
    END IF;
  END IF;
END;
$$;

-- 5. Trigger on bookings to auto-recalc
CREATE OR REPLACE FUNCTION public.bookings_loyalty_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.client_id IS NOT NULL AND NEW.status IN ('completed','paid') THEN
    PERFORM public.recalculate_client_loyalty(NEW.client_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bookings_loyalty ON public.bookings;
CREATE TRIGGER trg_bookings_loyalty
  AFTER INSERT OR UPDATE OF status, client_id ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.bookings_loyalty_trigger();
