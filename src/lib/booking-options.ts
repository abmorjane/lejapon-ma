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
