import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PASSPORT_BUCKET = "passports";
const MISSING_BUCKET_ERROR = "Storage bucket ‘passports’ does not exist. Please create it in Supabase Storage.";
const MANUAL_ENTRY_MESSAGE = "Passeport uploadé avec succès, mais lecture automatique impossible. Merci de saisir les données manuellement.";

type PassportFields = {
  first_name?: string;
  last_name?: string;
  full_name?: string;
  nationality?: string;
  sex?: string;
  date_of_birth?: string;
  passport_no?: string;
  national_id_number?: string;
  place_of_birth?: string;
  passport_issue_date?: string;
  passport_expiry?: string;
  passport_authority?: string;
  address?: string;
  city?: string;
  residence_address?: string;
  residence_city?: string;
  residence_country?: string;
  mrz?: string;
  mrz_raw?: string;
  confidence?: number;
};

const compact = (value: string) => value.replace(/\s+/g, " ").trim();
const onlyMrz = (value: string) => value.toUpperCase().replace(/[«‹<]/g, "<").replace(/[^A-Z0-9<\n]/g, "");
const logPreview = (value: string) => {
  if (Deno.env.get("OCR_DEBUG_RAW_TEXT") === "true") return value;
  return value.slice(0, 300);
};

type OcrDebugAttempt = {
  path: string;
  mode: "mrz" | "full";
  signed_url_ok?: boolean;
  signed_url_error?: string;
  download_ok?: boolean;
  download_error?: string;
  file_size?: number;
  engine_called?: boolean;
  engine_error?: string;
  text_length?: number;
};

type OcrDebug = {
  bucket?: string;
  storage_path?: string;
  ocr_storage_path?: string | null;
  engine: "external";
  ocr_api_configured: boolean;
  attempts: OcrDebugAttempt[];
  raw_text_length?: number;
  raw_text_preview?: string;
  mrz_detected?: boolean;
  mrz_detection_source?: string;
  mrz_lines?: string[];
  parsed_fields?: PassportFields;
  failure_stage?: string;
  failure_reason?: string;
};

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

function normalizeDate(value?: string) {
  if (!value) return undefined;
  const cleaned = compact(value).replace(/[|]/g, "1");
  const parts = cleaned.match(/(\d{1,2})\D+(\d{1,2})\D+(\d{2,4})/);
  if (!parts) return undefined;
  const dd = Number(parts[1]);
  const mm = Number(parts[2]);
  let yyyy = Number(parts[3]);
  if (yyyy < 100) yyyy += yyyy > 40 ? 1900 : 2000;
  const date = new Date(Date.UTC(yyyy, mm - 1, dd));
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31 || date.getUTCMonth() !== mm - 1 || date.getUTCDate() !== dd) return undefined;
  return `${yyyy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

function detectMrzLines(text: string) {
  const lines = onlyMrz(text)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 30);

  const firstIndex = lines.findIndex((line) => line.startsWith("P<") && line.length >= 40);
  if (firstIndex >= 0 && lines[firstIndex + 1]) {
    return {
      lines: [
        lines[firstIndex].padEnd(44, "<").slice(0, 44),
        lines[firstIndex + 1].padEnd(44, "<").slice(0, 44),
      ],
      source: "line",
    };
  }

  const continuous = onlyMrz(text).replace(/\n/g, "");
  const compactIndex = continuous.indexOf("P<");
  if (compactIndex >= 0 && continuous.length >= compactIndex + 76) {
    const mrz = continuous.slice(compactIndex, compactIndex + 88).padEnd(88, "<");
    return {
      lines: [mrz.slice(0, 44), mrz.slice(44, 88)],
      source: "continuous",
    };
  }

  return null;
}

const MOROCCAN_CITIES = [
  "CASABLANCA", "RABAT", "SALE", "SALÉ", "FES", "FEZ", "MARRAKECH", "TANGER", "TETOUAN",
  "AGADIR", "MEKNES", "OUJDA", "KENITRA", "MOHAMMEDIA", "TEMARA", "SAFI", "EL JADIDA",
  "NADOR", "BENI MELLAL", "KHOURIBGA", "LAAYOUNE", "DAKHLA", "SETTAT", "BERRECHID",
];

function parseMoroccanResidence(value?: string) {
  const raw = compact(String(value ?? "").replace(/\b\/?\s*MAR\b/gi, "").replace(/\bMAROC\b/gi, ""));
  if (!raw) return {};
  const upper = raw.toUpperCase();
  const city = MOROCCAN_CITIES.find((candidate) => new RegExp(`(?:^|\\s)${candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i").test(upper));
  if (!city) return { address: raw };
  const address = compact(raw.slice(0, Math.max(0, upper.lastIndexOf(city))).replace(/[,\-/]+$/g, ""));
  return {
    address: address || raw,
    city: city === "FEZ" ? "FES" : city,
    country: "Maroc",
  };
}

function readLooseLabel(text: string, labels: string[]) {
  const normalizeLabel = (value: string) =>
    value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const normalizedLabels = labels.map(normalizeLabel).filter(Boolean);
  const lines = text.split(/\n+/).map(compact).filter(Boolean);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const normalizedLine = normalizeLabel(line);
    const matched = normalizedLabels.find((label) => normalizedLine.includes(label));
    if (!matched) continue;
    const stripped = compact(line.replace(new RegExp(labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "i"), "").replace(/^[/:：\-\s]+/, ""));
    const looksLikeOnlyLabels = !stripped || /^(\/|and|et|residence|domicile|address|adresse)$/i.test(stripped);
    if (!looksLikeOnlyLabels) return stripped;
    const next = lines.slice(index + 1).find((candidate) => candidate && !normalizedLabels.some((label) => normalizeLabel(candidate) === label));
    if (next) return next;
  }
  const escaped = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const pattern = new RegExp(`(?:^|\\n|\\s)(?:${escaped})\\s*(?:[:：\\-])?\\s*([^\\n]+)`, "i");
  const match = text.match(pattern);
  return match?.[1] ? compact(match[1].replace(/^[/:：\-\s]+/, "")) : undefined;
}

function parseTextFields(text: string): PassportFields | null {
  if (!text.trim()) return null;
  const residence = readLooseLabel(text, ["Domicile", "Residence", "Résidence", "Adresse", "Address"]);
  const parsedResidence = parseMoroccanResidence(residence);
  const passportNo = readLooseLabel(text, ["Passport No", "Passport N[o°]", "No Passeport", "N° Passeport", "Numéro de passeport"]);
  const nationalId = readLooseLabel(text, ["CIN", "ID Card No", "N° CIN", "Carte d'identité", "National ID"]);
  const issueDate = normalizeDate(readLooseLabel(text, ["Date of issue", "Date d'émission", "Délivré le", "Issue date"]));
  const expiryDate = normalizeDate(readLooseLabel(text, ["Date of expiry", "Date d'expiration", "Expire le", "Expiry date"]));
  const birthDate = normalizeDate(readLooseLabel(text, ["Date of birth", "Date de naissance", "Né le", "Birth date"]));

  return {
    first_name: readLooseLabel(text, ["First names", "First name", "Given names", "Prénoms", "Prenoms"]),
    last_name: readLooseLabel(text, ["Last name", "Surname", "Nom"]),
    nationality: readLooseLabel(text, ["Nationality", "Nationalité", "Nationalite"]),
    sex: readLooseLabel(text, ["Sex", "Sexe"]),
    date_of_birth: birthDate,
    passport_no: passportNo,
    national_id_number: nationalId,
    place_of_birth: readLooseLabel(text, ["Place of birth", "Lieu de naissance", "Né à", "Nee a", "Née à"]),
    passport_issue_date: issueDate,
    passport_expiry: expiryDate,
    passport_authority: readLooseLabel(text, ["Authority", "Autorité", "Autorite", "Délivré par", "Delivre par"]),
    address: parsedResidence.address,
    city: parsedResidence.city,
    residence_address: parsedResidence.address,
    residence_city: parsedResidence.city,
    residence_country: parsedResidence.country,
  };
}

function mergePassportFields(...sources: Array<PassportFields | null | undefined>): PassportFields {
  const merged: PassportFields = {};
  for (const source of sources) {
    if (!source) continue;
    for (const [key, value] of Object.entries(source) as Array<[keyof PassportFields, PassportFields[keyof PassportFields]]>) {
      if (value !== undefined && value !== null && String(value).trim() && !merged[key]) {
        (merged as Record<string, unknown>)[key] = value;
      }
    }
  }
  if (!merged.full_name && (merged.first_name || merged.last_name)) {
    merged.full_name = compact(`${merged.first_name ?? ""} ${merged.last_name ?? ""}`);
  }
  if (!merged.address && merged.residence_address) merged.address = merged.residence_address;
  if (!merged.city && merged.residence_city) merged.city = merged.residence_city;
  if (!merged.mrz_raw && merged.mrz) merged.mrz_raw = merged.mrz;
  return merged;
}

function parseMrz(text: string): PassportFields | null {
  const detected = detectMrzLines(text);
  if (!detected) return null;
  const [first, second] = detected.lines;
  if (second.replace(/</g, "").length < 20) return null;

  const names = first.slice(5).split("<<");
  const lastName = compact((names[0] ?? "").replace(/</g, " "));
  const firstName = compact((names[1] ?? "").replace(/</g, " "));
  const passportNo = second.slice(0, 9).replace(/</g, "");
  const nationality = second.slice(10, 13).replace(/</g, "");
  const birth = parseMrzDate(second.slice(13, 19));
  const sex = second.slice(20, 21).replace("<", "");
  const expiry = parseMrzDate(second.slice(21, 27), true);

  return {
    first_name: firstName || undefined,
    last_name: lastName || undefined,
    full_name: compact(`${firstName} ${lastName}`),
    nationality: nationality || undefined,
    sex: sex || undefined,
    date_of_birth: birth,
    passport_no: passportNo || undefined,
    passport_expiry: expiry,
    mrz: `${first}\n${second}`,
    confidence: 0.9,
  };
}

function parseJsonFields(value: unknown): PassportFields | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  const nested = (data.fields && typeof data.fields === "object" ? data.fields : data.data && typeof data.data === "object" ? data.data : {}) as Record<string, unknown>;
  const read = (...keys: string[]) => {
    for (const key of keys) {
      const value = data[key] ?? nested[key];
      if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
    }
    return undefined;
  };
  const residence = read("address", "adresse", "residential_address", "adresse_residence", "adresse_résidence", "domicile", "residence", "résidence");
  const parsedResidence = parseMoroccanResidence(residence);
  return {
    first_name: read("first_name", "given_names", "givenNames", "prenom", "prénom"),
    last_name: read("last_name", "surname", "nom"),
    full_name: read("full_name", "name", "nom_complet"),
    nationality: read("nationality", "nationalite", "nationalité"),
    sex: read("sex", "gender", "sexe"),
    date_of_birth: read("date_of_birth", "birthdate", "birth_date", "date_naissance"),
    passport_no: read("passport_no", "passport_number", "document_number", "numero_passeport", "numéro_passeport"),
    national_id_number: read("national_id_number", "national_id_no", "cin", "id_card_no", "numero_cin", "numéro_cin"),
    place_of_birth: read("place_of_birth", "birth_place", "lieu_naissance", "lieu_de_naissance"),
    passport_issue_date: read("passport_issue_date", "issue_date", "date_issue", "date_emission", "date_émission"),
    passport_expiry: read("passport_expiry", "expiry_date", "expiration_date", "date_expiration"),
    passport_authority: read("passport_authority", "issuing_authority", "authority", "autorite", "autorité"),
    address: parsedResidence.address ?? residence,
    city: read("city", "ville", "place_of_residence", "residence_city", "ville_residence", "ville_résidence") ?? parsedResidence.city,
    residence_address: parsedResidence.address ?? read("residence_address", "residential_address", "domicile", "residence", "résidence"),
    residence_city: read("residence_city", "ville_residence", "ville_résidence") ?? parsedResidence.city,
    residence_country: read("residence_country", "country", "pays") ?? parsedResidence.country,
    mrz: read("mrz", "mrz_text"),
    mrz_raw: read("mrz_raw", "mrz", "mrz_text"),
    confidence: Number(data.confidence || nested.confidence || 0) || undefined,
  };
}

async function runExternalOcr(file: Blob, fileName: string, mode: "mrz" | "full"): Promise<string> {
  const url = Deno.env.get("OCR_API_URL");
  const key = Deno.env.get("OCR_API_KEY");
  if (!url) throw new Error("OCR_API_URL is not configured");

  const form = new FormData();
  form.append("file", file, fileName);
  form.append("language", "eng,fra,ara");
  form.append("detect_mrz", "true");
  form.append("document_type", "passport");
  form.append("country_hint", "MAR");
  form.append("preprocess", mode === "mrz" ? "contrast,grayscale,threshold,mrz_crop" : "contrast,grayscale");
  form.append("region", mode);

  const response = await fetch(url, {
    method: "POST",
    headers: key ? { Authorization: `Bearer ${key}` } : undefined,
    body: form,
  });
  if (!response.ok) throw new Error(`OCR provider failed (${response.status})`);

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const json = await response.json();
    const fields = parseJsonFields(json);
    if (fields?.mrz) return fields.mrz;
    if (typeof json.text === "string") return json.text;
    if (typeof json.ocr_text === "string") return json.ocr_text;
    return JSON.stringify(json);
  }
  return await response.text();
}

async function downloadPassportFile(admin: any, bucket: string, path: string) {
  console.info("[passport-ocr] downloading file", { bucket, path });
  const { data: file, error } = await admin.storage.from(bucket).download(path);
  if (error || !file) {
    console.error("[passport-ocr] download failed", { bucket, path, error });
    const message = String(error?.message ?? "Passport image not found");
    if (/bucket not found|not found/i.test(message) && /bucket|storage/i.test(message)) {
      throw new Error(MISSING_BUCKET_ERROR);
    }
    throw new Error(message);
  }
  return file;
}

async function logSignedUrl(admin: any, bucket: string, path: string, attempt: OcrDebugAttempt) {
  const { data, error } = await admin.storage.from(bucket).createSignedUrl(path, 300);
  if (error || !data?.signedUrl) {
    attempt.signed_url_ok = false;
    attempt.signed_url_error = error?.message ?? "Signed URL missing";
    console.warn("[passport-ocr] signed URL generation failed", { bucket, path, error });
    return;
  }
  attempt.signed_url_ok = true;
  console.info("[passport-ocr] signed URL generated", { bucket, path, expiresInSeconds: 300 });
}

function failureResponse(debug: OcrDebug, reason: string, stage: string) {
  debug.failure_stage = stage;
  debug.failure_reason = reason;
  console.warn("[passport-ocr] returning manual-entry fallback", debug);
  return new Response(JSON.stringify({
    ok: false,
    error: MANUAL_ENTRY_MESSAGE,
    debug,
  }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRole);

    const { data: userData, error: userError } = await admin.auth.getUser(jwt);
    if (userError || !userData.user) throw new Error("Unauthorized");

    const { data: roles } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", userData.user.id);
    const isStaff = (roles ?? []).some((r: any) =>
      ["super_admin", "admin", "manager", "sales", "sales_user", "sales_manager", "agent"].includes(r.role)
    );

    const body = await req.json();
    const { storage_path, path, ocr_storage_path } = body;
    const requestedBucket = typeof body.bucket === "string" && body.bucket ? body.bucket : PASSPORT_BUCKET;
    if (!["passports", "visa-docs"].includes(requestedBucket)) throw new Error("forbidden_bucket");
    const sourcePath = typeof storage_path === "string" && storage_path ? storage_path : path;
    if (!sourcePath || typeof sourcePath !== "string") throw new Error("Missing storage_path");
    const pathsToAuthorize = [sourcePath, typeof ocr_storage_path === "string" ? ocr_storage_path : null].filter(Boolean) as string[];
    const ownsEveryRequestedPath = requestedBucket === "visa-docs" && pathsToAuthorize.every((item) => item.startsWith(`${userData.user.id}/`));
    if (requestedBucket === "passports" && !isStaff) throw new Error("not_staff");
    if (requestedBucket === "visa-docs" && !isStaff && !ownsEveryRequestedPath) throw new Error("forbidden_path");

    let ocrText = "";
    const debug: OcrDebug = {
      bucket: requestedBucket,
      storage_path: sourcePath,
      ocr_storage_path: typeof ocr_storage_path === "string" ? ocr_storage_path : null,
      engine: "external",
      ocr_api_configured: !!Deno.env.get("OCR_API_URL"),
      attempts: [],
    };
    console.info("[passport-ocr] request received", debug);

    const attemptPaths = [
      typeof ocr_storage_path === "string" && ocr_storage_path ? { path: ocr_storage_path, mode: "mrz" as const } : null,
      { path: sourcePath, mode: "full" as const },
    ].filter(Boolean) as Array<{ path: string; mode: "mrz" | "full" }>;

    const texts: string[] = [];
    for (const attemptPath of attemptPaths) {
      const attempt: OcrDebugAttempt = { path: attemptPath.path, mode: attemptPath.mode };
      debug.attempts.push(attempt);
      await logSignedUrl(admin, requestedBucket, attemptPath.path, attempt);

      let file: Blob;
      try {
        file = await downloadPassportFile(admin, requestedBucket, attemptPath.path);
        attempt.download_ok = true;
        attempt.file_size = file.size;
      } catch (downloadError) {
        attempt.download_ok = false;
        attempt.download_error = downloadError instanceof Error ? downloadError.message : String(downloadError);
        console.warn("[passport-ocr] download failed for attempt", attempt);
        continue;
      }

      try {
        if (!debug.ocr_api_configured) {
          attempt.engine_called = false;
          attempt.engine_error = "OCR_API_URL is not configured";
          console.warn("[passport-ocr] OCR engine not called", { path: attempt.path, reason: attempt.engine_error });
          continue;
        }
        const fileName = attempt.path.split("/").pop() ?? "passport";
        console.info("[passport-ocr] OCR attempt started", { path: attempt.path, mode: attempt.mode, size: file.size });
        const text = await runExternalOcr(file, fileName, attempt.mode);
        attempt.engine_called = true;
        attempt.text_length = text.length;
        console.info("[passport-ocr] OCR attempt succeeded", { path: attempt.path, mode: attempt.mode, textLength: text.length });
        console.info("[passport-ocr] OCR raw text result", { path: attempt.path, mode: attempt.mode, text: logPreview(text), rawTextLoggingEnabled: Deno.env.get("OCR_DEBUG_RAW_TEXT") === "true" });
        texts.push(text);
      } catch (ocrError) {
        attempt.engine_called = true;
        attempt.engine_error = ocrError instanceof Error ? ocrError.message : String(ocrError);
        console.warn("[passport-ocr] OCR provider failed for attempt", attempt);
      }
    }

    ocrText = texts.join("\n");
    debug.raw_text_length = ocrText.length;
    debug.raw_text_preview = logPreview(ocrText);
    if (!ocrText.trim()) return failureResponse(debug, "OCR returned no text", "ocr_text");

    const jsonFields = (() => {
      try { return parseJsonFields(JSON.parse(ocrText)); } catch { return null; }
    })();
    const mrzDetection = detectMrzLines(jsonFields?.mrz ?? ocrText);
    debug.mrz_detected = !!mrzDetection;
    debug.mrz_detection_source = mrzDetection?.source;
    debug.mrz_lines = mrzDetection?.lines;
    console.info("[passport-ocr] MRZ detection result", {
      detected: debug.mrz_detected,
      source: debug.mrz_detection_source,
      lines: debug.mrz_lines,
    });

    const mrzFields = parseMrz(jsonFields?.mrz ?? ocrText);
    const textFields = parseTextFields(ocrText);
    const fields = mergePassportFields(mrzFields, jsonFields, textFields);
    debug.parsed_fields = fields;
    console.info("[passport-ocr] parsed fields", fields);

    if (!fields.passport_no && !fields.full_name && !fields.first_name && !fields.last_name) {
      console.warn("[passport-ocr] no usable fields parsed", { textLength: ocrText.length });
      return failureResponse(debug, "No usable passport fields parsed", "parse");
    }

    return new Response(JSON.stringify({ ok: true, fields, debug, bucket: requestedBucket, path: sourcePath }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = ["Forbidden", "not_staff", "forbidden_path", "forbidden_bucket"].includes(message) ? 403 : message === "Unauthorized" ? 401 : 500;
    return new Response(JSON.stringify({ ok: false, error: message, debug_echo: { received_keys: [] } }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
