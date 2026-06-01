import { slugify } from "@/lib/format";

export type HotelCatalogItem = {
  id: string;
  slug: string | null;
  name: string;
  city: string;
  category: string | null;
  main_image_url: string | null;
  gallery_urls: string[] | null;
  short_description_fr: string | null;
  short_description_en: string | null;
  short_description_ar: string | null;
  full_description_fr: string | null;
  full_description_en: string | null;
  full_description_ar: string | null;
  address: string | null;
  website_url: string | null;
  google_maps_url: string | null;
  phone: string | null;
  amenities: string[] | null;
  advantages: string[] | null;
  internal_notes: string | null;
  brochure_pdf_url: string | null;
  is_active: boolean;
  sort_order: number | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export const hotelCatalogColumns = [
  "id",
  "slug",
  "name",
  "city",
  "category",
  "main_image_url",
  "gallery_urls",
  "short_description_fr",
  "short_description_en",
  "short_description_ar",
  "full_description_fr",
  "full_description_en",
  "full_description_ar",
  "address",
  "website_url",
  "google_maps_url",
  "phone",
  "amenities",
  "advantages",
  "internal_notes",
  "brochure_pdf_url",
  "is_active",
  "sort_order",
  "created_at",
  "updated_at",
].join(",");

export const makeHotelSlug = (hotel: Pick<HotelCatalogItem, "city" | "name">) =>
  slugify([hotel.city, hotel.name].filter(Boolean).join(" "));

export const listFromTextarea = (value: string) =>
  value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

export const textareaFromList = (value: string[] | null | undefined) =>
  Array.isArray(value) ? value.filter(Boolean).join("\n") : "";

export const getLocalizedHotelText = (
  hotel: HotelCatalogItem,
  field: "short_description" | "full_description",
  language: string
) => {
  const lang = language.startsWith("ar") ? "ar" : language.startsWith("en") ? "en" : "fr";
  const key = `${field}_${lang}` as keyof HotelCatalogItem;
  const fallbackKey = `${field}_fr` as keyof HotelCatalogItem;
  return String(hotel[key] || hotel[fallbackKey] || "");
};

export const groupHotelsByCity = (hotels: HotelCatalogItem[]) =>
  hotels.reduce<Record<string, HotelCatalogItem[]>>((acc, hotel) => {
    const city = hotel.city || "Autres villes";
    acc[city] = acc[city] ? [...acc[city], hotel] : [hotel];
    return acc;
  }, {});
