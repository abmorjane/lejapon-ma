import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type PassportFields = {
  first_name?: string;
  last_name?: string;
  full_name?: string;
  nationality?: string;
  sex?: string;
  date_of_birth?: string;
  passport_no?: string;
  passport_issue_date?: string;
  passport_expiry?: string;
  mrz?: string;
  confidence?: number;
};

const compact = (value: string) => value.replace(/\s+/g, " ").trim();
const onlyMrz = (value: string) => value.toUpperCase().replace(/[^A-Z0-9<\n]/g, "");

function parseMrzDate(value: string, expiry = false) {
  if (!/^\d{6}$/.test(value)) return undefined;
  const yy = Number(value.slice(0, 2));
  const mm = value.slice(2, 4);
  const dd = value.slice(4, 6);
  const currentYY = Number(new Date().getFullYear().toString().slice(2));
  const century = expiry || yy <= currentYY + 15 ? 2000 : 1900;
  return `${century + yy}-${mm}-${dd}`;
}

function parseMrz(text: string): PassportFields | null {
  const lines = onlyMrz(text)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 30);

  const first = lines.find((line) => line.startsWith("P<") && line.length >= 40);
  if (!first) return null;
  const second = lines[lines.indexOf(first) + 1];
  if (!second || second.length < 40) return null;

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
  return {
    first_name: String(data.first_name ?? data.given_names ?? data.givenNames ?? "").trim() || undefined,
    last_name: String(data.last_name ?? data.surname ?? "").trim() || undefined,
    full_name: String(data.full_name ?? data.name ?? "").trim() || undefined,
    nationality: String(data.nationality ?? "").trim() || undefined,
    sex: String(data.sex ?? data.gender ?? "").trim() || undefined,
    date_of_birth: String(data.date_of_birth ?? data.birthdate ?? "").trim() || undefined,
    passport_no: String(data.passport_no ?? data.passport_number ?? "").trim() || undefined,
    passport_issue_date: String(data.passport_issue_date ?? data.issue_date ?? "").trim() || undefined,
    passport_expiry: String(data.passport_expiry ?? data.expiry_date ?? data.expiration_date ?? "").trim() || undefined,
    mrz: String(data.mrz ?? "").trim() || undefined,
    confidence: Number(data.confidence || 0) || undefined,
  };
}

async function runExternalOcr(file: Blob, fileName: string): Promise<string> {
  const url = Deno.env.get("OCR_API_URL");
  const key = Deno.env.get("OCR_API_KEY");
  if (!url) throw new Error("OCR_API_URL is not configured");

  const form = new FormData();
  form.append("file", file, fileName);
  form.append("language", "eng");
  form.append("detect_mrz", "true");

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
    const allowed = (roles ?? []).some((r: any) => ["super_admin", "admin"].includes(r.role));
    if (!allowed) throw new Error("Forbidden");

    const { storage_path } = await req.json();
    if (!storage_path || typeof storage_path !== "string") throw new Error("Missing storage_path");

    const { data: file, error: downloadError } = await admin.storage
      .from("passport-scans")
      .download(storage_path);
    if (downloadError || !file) throw new Error(downloadError?.message ?? "Passport image not found");

    let ocrText = "";
    try {
      ocrText = await runExternalOcr(file, storage_path.split("/").pop() ?? "passport");
    } catch (ocrError) {
      console.warn("passport OCR provider unavailable", ocrError);
      return new Response(JSON.stringify({
        ok: false,
        error: "Lecture automatique impossible. Merci de renseigner les informations manuellement.",
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const jsonFields = (() => {
      try { return parseJsonFields(JSON.parse(ocrText)); } catch { return null; }
    })();
    const mrzFields = parseMrz(jsonFields?.mrz ?? ocrText);
    const fields = { ...(jsonFields ?? {}), ...(mrzFields ?? {}) };

    if (!fields.passport_no && !fields.full_name && !fields.first_name && !fields.last_name) {
      return new Response(JSON.stringify({
        ok: false,
        error: "Lecture automatique impossible. Merci de renseigner les informations manuellement.",
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true, fields }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message === "Forbidden" ? 403 : message === "Unauthorized" ? 401 : 500;
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
