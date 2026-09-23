import { supabase } from "@/integrations/supabase/client";
import {
  crmFullName,
  crmIdentityKey,
  missingCrmFieldsPatch,
  normalizeCrmEmail,
  normalizeCrmPassport,
  normalizeCrmPhone,
  resolveCrmIdentity,
  type CrmIdentityInput,
} from "@/lib/crm-identity";

type ClientLookupInput = CrmIdentityInput;

const cleanText = (value?: string | null) => String(value ?? "").trim();

export async function findOrCreateClientForBooking(input: ClientLookupInput) {
  const fullName = crmFullName(input);
  const email = normalizeCrmEmail(input.email);
  const phone = normalizeCrmPhone(input.phone);
  const passport = normalizeCrmPassport(input.passport_number || input.passport_no);

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
      const clientId = row && typeof row === "object" && "client_id" in row ? row.client_id : row;
      return { clientId: typeof clientId === "string" ? clientId : null, wasExisting: Boolean(row?.was_existing) };
    }
  } catch {
    // Fallback below keeps older deployments usable until the CRM V1 SQL is applied.
  }

  const { data: candidates, error: lookupError } = await (supabase as any)
    .from("clients")
    .select("id,full_name,email,phone,city,country,passport_number,passport_no,nationality,birthdate,date_of_birth,sex,address,profession,source,metadata")
    .limit(1000);
  if (lookupError) throw lookupError;

  const resolution = resolveCrmIdentity(input, candidates ?? []);
  if (resolution.kind === "ambiguous") {
    return { clientId: null, wasExisting: false, ambiguous: true, candidateIds: resolution.candidateIds };
  }

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

  if (resolution.kind === "match") {
    const existing = (candidates ?? []).find((candidate: any) => candidate.id === resolution.clientId) ?? {};
    const patch = missingCrmFieldsPatch(existing, input);
    if (Object.keys(patch).length) {
      const { error } = await (supabase as any).from("clients").update(patch).eq("id", resolution.clientId);
      if (error) throw error;
    }
    return { clientId: resolution.clientId, wasExisting: true, matchedBy: resolution.matchedBy };
  }

  const { data, error } = await (supabase as any).from("clients").insert(payload).select("id").single();
  if (error) throw error;
  return { clientId: data.id, wasExisting: false };
}

export function clientSimilarityKey(input: ClientLookupInput) {
  return crmIdentityKey(input);
}
