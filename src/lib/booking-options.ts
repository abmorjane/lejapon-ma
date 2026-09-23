export type PublicHotelKey = "modern" | "ryokan";
export type PublicRoomKey = "single" | "double" | "triple";

export const HOTEL_SUPPLEMENT: Record<PublicHotelKey, number> = { modern: 0, ryokan: 2500 };
export const SINGLE_SUPPLEMENT_MAD = 15000;
export const TRIPLE_DISCOUNT_PER_PERSON_MAD = 1000;
export const CHILD_DISCOUNT_MAD = 3000;

export const PUBLIC_HOTEL_OPTIONS: Record<PublicHotelKey, { name: string; desc: string; supplement: number }> = {
  modern: { name: "Hôtel moderne (avec le groupe)", desc: "Confort international, sans supplément.", supplement: 0 },
  ryokan: { name: "Ryokan traditionnel", desc: "Auberge japonaise, futon & onsen. Supplément 2 500 MAD/pers.", supplement: 2500 },
};

export const PUBLIC_ROOM_LABELS: Record<PublicRoomKey, string> = {
  single: "Single",
  double: "Double",
  triple: "Triple",
};

export const getRoomAdjustmentPerPerson = (roomType: PublicRoomKey) => {
  if (roomType === "single") return SINGLE_SUPPLEMENT_MAD;
  if (roomType === "triple") return -TRIPLE_DISCOUNT_PER_PERSON_MAD;
  return 0;
};

const normalizeOption = (value: unknown) => String(value ?? "").trim().toLowerCase();

export const publicHotelKeyOrNull = (value: unknown): PublicHotelKey | null => {
  const normalized = normalizeOption(value);
  if (normalized === "ryokan" || normalized.includes("tradition")) return "ryokan";
  if (normalized === "modern" || normalized.includes("moderne")) return "modern";
  return null;
};

export const publicRoomKeyOrNull = (value: unknown): PublicRoomKey | null => {
  const normalized = normalizeOption(value);
  if (normalized === "single" || normalized.includes("individ")) return "single";
  if (normalized === "triple") return "triple";
  if (normalized === "double" || normalized === "twin" || normalized.includes("double")) return "double";
  return null;
};

export const normalizePublicHotelKey = (value: unknown): PublicHotelKey => publicHotelKeyOrNull(value) ?? "modern";
export const normalizePublicRoomKey = (value: unknown): PublicRoomKey => publicRoomKeyOrNull(value) ?? "double";

export const publicHotelLabel = (value: unknown) => {
  if (!String(value ?? "").trim()) return "Non renseigné";
  return PUBLIC_HOTEL_OPTIONS[normalizePublicHotelKey(value)].name;
};

export const publicRoomLabel = (value: unknown) => {
  if (!String(value ?? "").trim()) return "Non renseignée";
  return PUBLIC_ROOM_LABELS[normalizePublicRoomKey(value)];
};

export type BookingOptionSelection = {
  hotel: PublicHotelKey;
  room: PublicRoomKey;
};

export const bookingOptionPricePerPerson = ({ hotel, room }: BookingOptionSelection) =>
  HOTEL_SUPPLEMENT[hotel] + getRoomAdjustmentPerPerson(room);

/** Returns only the difference between the options already priced and the new selection. */
export const bookingOptionChangeImpact = (
  previous: BookingOptionSelection,
  next: BookingOptionSelection,
  travelers: number,
) => {
  const perPerson = bookingOptionPricePerPerson(next) - bookingOptionPricePerPerson(previous);
  const safeTravelers = Number.isFinite(travelers) ? Math.max(0, Math.floor(travelers)) : 0;
  return { perPerson, total: perPerson * safeTravelers };
};
