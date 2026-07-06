export const DEFAULT_HOTEL_ROOM_TYPES = ["double/twin", "single", "triple", "TL"] as const;

export const DEFAULT_GUIDE_ROWS = [
  { day_number: 2, guide_type: "French or English speaking assistant", daily_price_jpy: 30000 },
  { day_number: 3, guide_type: "French or English speaking guide (Shibuya)", daily_price_jpy: 50000 },
  { day_number: 4, guide_type: "French or English speaking guide (Odaiba)", daily_price_jpy: 50000 },
  { day_number: 5, guide_type: "French or English speaking guide (Kamakura)", daily_price_jpy: 60000 },
  { day_number: 6, guide_type: "French or English speaking guide (Hakone)", daily_price_jpy: 60000 },
  { day_number: 7, guide_type: "French speaking guide (Kyoto) - Monsieur Koenuma", daily_price_jpy: 65000 },
  { day_number: 9, guide_type: "French speaking guide (Kyoto - Nara - Osaka)", daily_price_jpy: 65000 },
  { day_number: 10, guide_type: "French speaking guide (Hiroshima - Miyajima) - Madame Sekimura", daily_price_jpy: 55000 },
  { day_number: 11, guide_type: "French or English speaking guide (Osaka) - Monsieur Koenuma", daily_price_jpy: 65000 },
  { day_number: 15, guide_type: "French or English speaking guide (Asakusa - Akihabara) - Monsieur Atsushi au Kanto", daily_price_jpy: 55000 },
  { day_number: 16, guide_type: "French or English speaking assistant", daily_price_jpy: 30000 },
] as const;

export const DEFAULT_REQUIRED_ACTIVITIES = [
  { day_number: 3, activity_name: "Team Lab Planet Tokyo", unit_price_jpy: 5600 },
  { day_number: 4, activity_name: "Kamakura Buddha", unit_price_jpy: 300 },
  { day_number: 5, activity_name: "Hakone Pirate Ship", unit_price_jpy: 2000 },
  { day_number: 6, activity_name: "Golden Pavilion", unit_price_jpy: 500 },
  { day_number: 6, activity_name: "Kiyomizudera Temple", unit_price_jpy: 500 },
  { day_number: 6, activity_name: "Ryoanji Temple", unit_price_jpy: 600 },
  { day_number: 6, activity_name: "Nijo-jo", unit_price_jpy: 1300 },
  { day_number: 9, activity_name: "Memorial Museum", unit_price_jpy: 200 },
  { day_number: 9, activity_name: "Ferry to Miyajima", unit_price_jpy: 200 },
  { day_number: 9, activity_name: "Hiroshima Tax", unit_price_jpy: 100 },
  { day_number: 10, activity_name: "Kaiyukan", unit_price_jpy: 3500 },
  { day_number: 10, activity_name: "Osaka Castle", unit_price_jpy: 1200 },
] as const;

export const DEFAULT_OPTIONAL_ACTIVITIES = [
  { day_number: 7, activity_name: "Morning Meditation in Kyoto at Kounji", unit_price_jpy: 1000, aliases: ["meditation", "morning meditation", "kounji"] },
  { day_number: 7, activity_name: "Tea Ceremony in Kyoto", unit_price_jpy: 3500, aliases: ["tea ceremony", "ceremonie du the", "cérémonie du thé"] },
  { day_number: 7, activity_name: "Geisha Make Up in Kyoto", unit_price_jpy: 12000, aliases: ["geisha makeup", "geisha make up", "maquillage geisha"] },
  { day_number: 7, activity_name: "Maiko Dinner Experience", unit_price_jpy: 23925, aliases: ["maiko dinner", "geisha dinner", "maiko dinner experience"] },
  { day_number: 11, activity_name: "Universal Studios", unit_price_jpy: 10900, aliases: ["universal studio", "universal studios", "usj"] },
  { day_number: 13, activity_name: "Disney Sea/Land", unit_price_jpy: 10900, aliases: ["disney", "disneyland", "disney sea", "disney land"] },
] as const;
