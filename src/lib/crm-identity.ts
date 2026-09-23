export type CrmIdentityInput = {
  full_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  passport_number?: string | null;
  passport_no?: string | null;
  city?: string | null;
  country?: string | null;
  nationality?: string | null;
  birthdate?: string | null;
  date_of_birth?: string | null;
  sex?: string | null;
  address?: string | null;
  profession?: string | null;
  source?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type CrmIdentityCandidate = {
  id: string;
  email?: string | null;
  phone?: string | null;
  passport_number?: string | null;
  passport_no?: string | null;
};

export type CrmIdentityResolution =
  | { kind: "none"; candidateIds: []; matchedBy: null }
  | { kind: "match"; clientId: string; candidateIds: string[]; matchedBy: "passport" | "email" | "phone" }
  | { kind: "ambiguous"; candidateIds: string[]; matchedBy: "passport" | "email" | "phone" | "conflicting_fields" };

const cleanText = (value?: string | null) => String(value ?? "").trim();

export const normalizeCrmEmail = (value?: string | null) => cleanText(value).toLowerCase();

export const normalizeCrmPassport = (value?: string | null) =>
  cleanText(value).replace(/[^a-zA-Z0-9]/g, "").toUpperCase();

export const normalizeCrmPhone = (value?: string | null) => {
  let digits = cleanText(value).replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("2120")) digits = `212${digits.slice(4)}`;
  if (digits.startsWith("0") && digits.length === 10) digits = `212${digits.slice(1)}`;
  if (digits.length === 9 && /^[5-8]/.test(digits)) digits = `212${digits}`;
  return `+${digits}`;
};

export const crmFullName = (input: CrmIdentityInput) =>
  cleanText(input.full_name) || [input.first_name, input.last_name].map(cleanText).filter(Boolean).join(" ");

export const normalizeCrmName = (value?: string | null) =>
  cleanText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");

export function resolveCrmIdentity(
  input: CrmIdentityInput,
  candidates: CrmIdentityCandidate[],
): CrmIdentityResolution {
  const passport = normalizeCrmPassport(input.passport_number || input.passport_no);
  const email = normalizeCrmEmail(input.email);
  const phone = normalizeCrmPhone(input.phone);
  const byKey = {
    passport: passport
      ? candidates.filter((candidate) =>
          [candidate.passport_number, candidate.passport_no]
            .map(normalizeCrmPassport)
            .filter(Boolean)
            .includes(passport),
        )
      : [],
    email: email ? candidates.filter((candidate) => normalizeCrmEmail(candidate.email) === email) : [],
    phone: phone ? candidates.filter((candidate) => normalizeCrmPhone(candidate.phone) === phone) : [],
  };

  // Identity keys are authoritative in order. A valid passport isolates a person
  // even when several family members share the same email address or telephone.
  const selectedKey = passport ? "passport" : email ? "email" : phone ? "phone" : null;
  if (!selectedKey) return { kind: "none", candidateIds: [], matchedBy: null };

  const candidateIds = [...new Set(byKey[selectedKey].map((candidate) => candidate.id))];
  if (candidateIds.length > 1) return { kind: "ambiguous", candidateIds, matchedBy: selectedKey };
  if (candidateIds.length === 0) return { kind: "none", candidateIds: [], matchedBy: null };

  return { kind: "match", clientId: candidateIds[0], candidateIds, matchedBy: selectedKey };
}

const isMissing = (value: unknown) => value == null || (typeof value === "string" && value.trim() === "");

export function missingCrmFieldsPatch(existing: Record<string, unknown>, input: CrmIdentityInput) {
  const patch: Record<string, unknown> = {};
  const values: Record<string, unknown> = {
    full_name: crmFullName(input),
    email: normalizeCrmEmail(input.email),
    phone: normalizeCrmPhone(input.phone),
    city: cleanText(input.city),
    country: cleanText(input.country),
    passport_number: normalizeCrmPassport(input.passport_number || input.passport_no),
    passport_no: normalizeCrmPassport(input.passport_no || input.passport_number),
    nationality: cleanText(input.nationality),
    birthdate: input.birthdate || input.date_of_birth || null,
    date_of_birth: input.date_of_birth || input.birthdate || null,
    sex: cleanText(input.sex),
    address: cleanText(input.address),
    profession: cleanText(input.profession),
    source: cleanText(input.source),
  };

  Object.entries(values).forEach(([key, value]) => {
    if (isMissing(existing[key]) && !isMissing(value)) patch[key] = value;
  });

  const incomingMetadata = input.metadata ?? {};
  if (Object.keys(incomingMetadata).length) {
    patch.metadata = { ...incomingMetadata, ...((existing.metadata as Record<string, unknown> | null) ?? {}) };
  }
  return patch;
}

export function crmIdentityKey(input: CrmIdentityInput) {
  return {
    passport: normalizeCrmPassport(input.passport_number || input.passport_no),
    email: normalizeCrmEmail(input.email),
    phone: normalizeCrmPhone(input.phone),
    name: normalizeCrmName(crmFullName(input)),
  };
}
