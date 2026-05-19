
-- booking_participants
CREATE TABLE public.booking_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL,
  trip_id uuid,
  first_name text NOT NULL DEFAULT '',
  last_name text NOT NULL DEFAULT '',
  sex text,
  date_of_birth date,
  passport_no text,
  passport_issue_date date,
  passport_expiry date,
  client_type text,
  is_lead boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_booking_participants_booking ON public.booking_participants(booking_id);
CREATE INDEX idx_booking_participants_trip ON public.booking_participants(trip_id);
ALTER TABLE public.booking_participants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff manage booking_participants" ON public.booking_participants FOR ALL USING (is_staff(auth.uid())) WITH CHECK (is_staff(auth.uid()));
CREATE TRIGGER trg_bp_updated BEFORE UPDATE ON public.booking_participants FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- trip_hotels
CREATE TABLE public.trip_hotels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL,
  name text NOT NULL,
  city text,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_trip_hotels_trip ON public.trip_hotels(trip_id);
ALTER TABLE public.trip_hotels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff manage trip_hotels" ON public.trip_hotels FOR ALL USING (is_staff(auth.uid())) WITH CHECK (is_staff(auth.uid()));

-- trip_rooms
CREATE TABLE public.trip_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_hotel_id uuid NOT NULL REFERENCES public.trip_hotels(id) ON DELETE CASCADE,
  room_number text,
  room_type text NOT NULL DEFAULT 'twin',
  client_type text,
  capacity int NOT NULL DEFAULT 2,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_trip_rooms_hotel ON public.trip_rooms(trip_hotel_id);
ALTER TABLE public.trip_rooms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff manage trip_rooms" ON public.trip_rooms FOR ALL USING (is_staff(auth.uid())) WITH CHECK (is_staff(auth.uid()));

-- room_assignments
CREATE TABLE public.room_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.trip_rooms(id) ON DELETE CASCADE,
  participant_id uuid NOT NULL REFERENCES public.booking_participants(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(participant_id)
);
CREATE INDEX idx_room_assignments_room ON public.room_assignments(room_id);
ALTER TABLE public.room_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff manage room_assignments" ON public.room_assignments FOR ALL USING (is_staff(auth.uid())) WITH CHECK (is_staff(auth.uid()));

-- booking_participant_activities
CREATE TABLE public.booking_participant_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id uuid NOT NULL REFERENCES public.booking_participants(id) ON DELETE CASCADE,
  extra_id uuid NOT NULL,
  is_selected boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(participant_id, extra_id)
);
CREATE INDEX idx_bpa_participant ON public.booking_participant_activities(participant_id);
CREATE INDEX idx_bpa_extra ON public.booking_participant_activities(extra_id);
ALTER TABLE public.booking_participant_activities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff manage bpa" ON public.booking_participant_activities FOR ALL USING (is_staff(auth.uid())) WITH CHECK (is_staff(auth.uid()));

-- trip_japan_payments
CREATE TABLE public.trip_japan_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL,
  paid_on date NOT NULL DEFAULT current_date,
  amount numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'JPY',
  exchange_rate numeric NOT NULL DEFAULT 1,
  amount_mad numeric NOT NULL DEFAULT 0,
  method text,
  beneficiary text,
  comment text,
  receipt_url text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_japan_payments_trip ON public.trip_japan_payments(trip_id);
ALTER TABLE public.trip_japan_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff manage trip_japan_payments" ON public.trip_japan_payments FOR ALL USING (is_staff(auth.uid())) WITH CHECK (is_staff(auth.uid()));
CREATE TRIGGER trg_jp_updated BEFORE UPDATE ON public.trip_japan_payments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
