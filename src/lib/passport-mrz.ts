export type PassportMRZFields = {
  first_name?: string;
  last_name?: string;
  full_name?: string;
  nationality?: string;
  sex?: string;
  date_of_birth?: string;
  passport_no?: string;
  passport_expiry?: string;
  mrz?: string;
  confidence?: number;
};

export type PassportExpiryCheck = {
  isValidDate: boolean;
  isExpired: boolean;
  expiresWithin12Months: boolean;
  warning?: string;
};

const cleanText = (value: string) => value.replace(/\s+/g, " ").trim();

const normalizeMrzText = (text: string) =>
  text
    .toUpperCase()
    .replace(/[^A-Z0-9<\n]/g, "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

function parseMrzDate(value: string, expiry = false) {
  if (!/^\d{6}$/.test(value)) return undefined;
  const yy = Number(value.slice(0, 2));
  const mm = Number(value.slice(2, 4));
  const dd = Number(value.slice(4, 6));
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return undefined;

  const currentYY = Number(new Date().getFullYear().toString().slice(2));
  const century = expiry || yy <= currentYY + 15 ? 2000 : 1900;
  const date = new Date(Date.UTC(century + yy, mm - 1, dd));
  if (date.getUTCMonth() !== mm - 1 || date.getUTCDate() !== dd) return undefined;
  return `${century + yy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

export function parsePassportMRZ(text: string): PassportMRZFields | null {
  const lines = normalizeMrzText(text);
  const firstIndex = lines.findIndex((line) => line.startsWith("P<") && line.length >= 40);
  if (firstIndex < 0) return null;

  const first = lines[firstIndex].padEnd(44, "<").slice(0, 44);
  const second = (lines[firstIndex + 1] ?? "").padEnd(44, "<").slice(0, 44);
  if (second.replace(/</g, "").length < 20) return null;

  const names = first.slice(5).split("<<");
  const lastName = cleanText((names[0] ?? "").replace(/</g, " "));
  const firstName = cleanText((names[1] ?? "").replace(/</g, " "));
  const passportNo = second.slice(0, 9).replace(/</g, "");
  const nationality = second.slice(10, 13).replace(/</g, "");
  const birth = parseMrzDate(second.slice(13, 19));
  const sex = second.slice(20, 21).replace("<", "");
  const expiry = parseMrzDate(second.slice(21, 27), true);

  return {
    first_name: firstName || undefined,
    last_name: lastName || undefined,
    full_name: cleanText(`${firstName} ${lastName}`) || undefined,
    nationality: nationality || undefined,
    sex: sex || undefined,
    date_of_birth: birth,
    passport_no: passportNo || undefined,
    passport_expiry: expiry,
    mrz: `${first}\n${second}`,
    confidence: 0.9,
  };
}

export function checkPassportExpiry(expiryDate?: string | null): PassportExpiryCheck {
  if (!expiryDate) {
    return { isValidDate: false, isExpired: false, expiresWithin12Months: false };
  }

  const expiry = new Date(`${expiryDate}T00:00:00`);
  if (Number.isNaN(expiry.getTime())) {
    return { isValidDate: false, isExpired: false, expiresWithin12Months: false };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const threshold = new Date(today);
  threshold.setFullYear(threshold.getFullYear() + 1);

  const isExpired = expiry < today;
  const expiresWithin12Months = !isExpired && expiry <= threshold;
  const warning = isExpired
    ? `Attention : ce passeport est expiré depuis le ${expiryDate}.`
    : expiresWithin12Months
      ? `Attention : ce passeport expire dans moins d'un an (${expiryDate}).`
      : undefined;

  return {
    isValidDate: true,
    isExpired,
    expiresWithin12Months,
    warning,
  };
}
