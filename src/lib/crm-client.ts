import { supabase } from "@/integrations/supabase/client";

type ClientLookupInput = {
  full_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  city?: string | null;
  country?: string | null;
  passport_number?: string | null;
  passport_no?: string | null;
  nationality?: string | null;
  birthdate?: string | null;
  date_of_birth?: string | null;
  sex?: string | null;
  address?: string | null;
  profession?: string | null;
  source?: string | null;
  metadata?: Record<string, unknown> | null;
};

const cleanText = (value?: string | null) => String(value ?? "").trim();
const cleanEmail = (value?: string | null) => cleanText(value).toLowerCase();
const cleanPhone = (value?: string | null) => cleanText(value).replace(/[^\d+]/g, "");
const cleanPassport = (value?: string | null) => cleanText(value).replace(/[\s-]+/g, "").toUpperCase();
const normalizeName = (value?: string | null) => cleanText(value).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");

const fullNameFromInput = (input: ClientLookupInput) =>
  cleanText(input.full_name) || [input.first_name, input.last_name].map(cleanText).filter(Boolean).join(" ");

const safeMaybeSingle = async (query: any) => {
  const { data, error } = await query.limit(1).maybeSingle();
  if (error) throw error;
  return data ?? null;
};

export async function findOrCreateClientForBooking(input: ClientLookupInput) {
  const fullName = fullNameFromInput(input);
  const email = cleanEmail(input.email);
  const phone = cleanPhone(input.phone);
  const passport = cleanPassport(input.passport_number || input.passport_no);

  try {
    const { data, error } = await (supabase as any).rpc("find_or_create_client_for_booking", {
      _full_name: fullName,
      _email: email || null,
      _phone: phone || null,
      _passport_no: passport || null,
      _city: cleanText(input.city) || null,
      _source: input.source || "booking",
      _metadata: input.metadata ?? {},
    });
    if (!error && data) {
      const row = Array.isArray(data) ? data[0] : data;
      return { clientId: row?.client_id ?? row, wasExisting: Boolean(row?.was_existing) };
    }
  } catch {
    // Fallback below keeps older deployments usable until the CRM V1 SQL is applied.
  }

  let existing: any = null;
  if (passport) existing = await safeMaybeSingle(supabase.from("clients").select("id").eq("passport_number", passport));
  if (!existing && email) existing = await safeMaybeSingle(supabase.from("clients").select("id").eq("email", email));
  if (!existing && phone) existing = await safeMaybeSingle(supabase.from("clients").select("id").eq("phone", phone));

  const payload: any = {
    full_name: fullName || email || phone || "Client",
    email: email || null,
    phone: phone || null,
    city: cleanText(input.city) || null,
    country: cleanText(input.country) || "Maroc",
    passport_number: passport || null,
    nationality: cleanText(input.nationality) || null,
    birthdate: input.birthdate || input.date_of_birth || null,
    sex: cleanText(input.sex) || null,
    address: cleanText(input.address) || null,
    profession: cleanText(input.profession) || null,
    source: input.source || "booking",
    metadata: input.metadata ?? {},
  };

  if (existing?.id) {
    const { error } = await (supabase as any).from("clients").update(payload).eq("id", existing.id);
    if (error) throw error;
    return { clientId: existing.id, wasExisting: true };
  }

  const { data, error } = await (supabase as any).from("clients").insert(payload).select("id").single();
  if (error) throw error;
  return { clientId: data.id, wasExisting: false };
}

export function clientSimilarityKey(input: ClientLookupInput) {
  return {
    passport: cleanPassport(input.passport_number || input.passport_no),
    email: cleanEmail(input.email),
    phone: cleanPhone(input.phone),
    name: normalizeName(fullNameFromInput(input)),
  };
}
