export type VisaTripDateSource = {
  start_date?: string | null;
  end_date?: string | null;
  japan_stay_days?: number | string | null;
  total_trip_days?: number | string | null;
  duration_days?: number | string | null;
  visa_japan_arrival_date?: string | null;
  visa_japan_departure_date?: string | null;
};

const isoDateOnly = (value?: string | null) => {
  const match = String(value ?? "").trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
};

export const addCalendarDays = (value: string | null | undefined, offset: number) => {
  const iso = isoDateOnly(value);
  if (!iso) return null;
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + offset);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

export const inclusiveCalendarDaysBetween = (start?: string | null, end?: string | null) => {
  const startIso = isoDateOnly(start);
  const endIso = isoDateOnly(end);
  if (!startIso || !endIso) return null;
  const [startYear, startMonth, startDay] = startIso.split("-").map(Number);
  const [endYear, endMonth, endDay] = endIso.split("-").map(Number);
  const startTime = Date.UTC(startYear, startMonth - 1, startDay);
  const endTime = Date.UTC(endYear, endMonth - 1, endDay);
  if (endTime < startTime) return null;
  return Math.floor((endTime - startTime) / 86400000) + 1;
};

export const visaTripDatesFromTrip = (trip: VisaTripDateSource | null | undefined) => {
  if (!trip) {
    return {
      japanArrivalDate: null,
      japanDepartureDate: null,
      japanStayDays: null,
      totalTripDays: null,
      usesStayFallback: false,
    };
  }

  const japanArrivalDate = addCalendarDays(trip.start_date, 1) || isoDateOnly(trip.visa_japan_arrival_date);
  const japanDepartureDate = addCalendarDays(trip.end_date, -1) || isoDateOnly(trip.visa_japan_departure_date);
  const configuredJapanDays = Number(trip.japan_stay_days || 0);
  const japanStayDays = configuredJapanDays > 0
    ? configuredJapanDays
    : inclusiveCalendarDaysBetween(japanArrivalDate, japanDepartureDate);
  const totalTripDays = Number(trip.total_trip_days || 0) > 0
    ? Number(trip.total_trip_days)
    : Number(trip.duration_days || 0) > 0
      ? Number(trip.duration_days)
      : inclusiveCalendarDaysBetween(trip.start_date, trip.end_date);

  return {
    japanArrivalDate,
    japanDepartureDate,
    japanStayDays,
    totalTripDays,
    usesStayFallback: !(configuredJapanDays > 0),
  };
};

export const visaTripPatchFromTrip = (trip: VisaTripDateSource | null | undefined) => {
  const dates = visaTripDatesFromTrip(trip);
  return {
    intended_length_of_stay: dates.japanStayDays ? `${dates.japanStayDays} jours` : null,
    date_of_arrival: dates.japanArrivalDate,
  };
};
