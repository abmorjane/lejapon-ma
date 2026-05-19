import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const LANG_LABELS: Record<string, string> = {
  en: "English",
  ar: "Modern Standard Arabic (العربية)",
};

type Item = {
  table: string;
  rowId: string;
  field: string;
  sourceText: string;
  targetLang: "en" | "ar";
  persist?: boolean; // if false, just return the translation without storing
};

async function md5(text: string): Promise<string> {
  // Web Crypto doesn't include md5; use SHA-1 truncated, sufficient for drift detection.
  const buf = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-1", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

async function translateOne(text: string, target: "en" | "ar", apiKey: string): Promise<string> {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        {
          role: "system",
          content:
            `You are a professional translator for a Moroccan travel agency specialized in Japan trips. ` +
            `Translate the user's text from French to ${LANG_LABELS[target]}. ` +
            `Preserve tone, brand names (lejapon.ma, Tokyo, Kyoto, etc.), inline HTML and markdown. ` +
            `For Arabic, use clear Modern Standard Arabic suitable for marketing. ` +
            `Return ONLY the translation, with no quotes, no preamble, no explanation.`,
        },
        { role: "user", content: text },
      ],
    }),
  });

  if (res.status === 429) throw new Error("RATE_LIMIT");
  if (res.status === 402) throw new Error("CREDITS_EXHAUSTED");
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`AI_ERROR:${res.status}:${t.slice(0, 200)}`);
  }
  const data = await res.json();
  const out = data?.choices?.[0]?.message?.content?.trim?.() ?? "";
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY not set" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const items: Item[] = Array.isArray(body?.items) ? body.items : [];
    if (!items.length) {
      return new Response(JSON.stringify({ error: "items required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (items.length > 30) {
      return new Response(JSON.stringify({ error: "max 30 items per call" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    const results = await Promise.all(
      items.map(async (it) => {
        try {
          if (!it.sourceText || !it.sourceText.trim()) {
            return { ok: true, ...it, value: "", skipped: true };
          }
          if (!["en", "ar"].includes(it.targetLang)) {
            return { ok: false, ...it, error: "bad lang" };
          }
          const translated = await translateOne(it.sourceText, it.targetLang, apiKey);
          if (it.persist !== false && it.table && it.rowId && it.field) {
            const hash = await md5(it.sourceText);
            const { error } = await admin
              .from("content_translations")
              .upsert(
                {
                  table_name: it.table,
                  row_id: it.rowId,
                  field: it.field,
                  language: it.targetLang,
                  value_text: translated,
                  status: "auto",
                  source_text_hash: hash,
                },
                { onConflict: "table_name,row_id,field,language" },
              );
            if (error) return { ok: false, ...it, error: error.message };
          }
          return { ok: true, ...it, value: translated };
        } catch (e: any) {
          return { ok: false, ...it, error: e?.message ?? "unknown" };
        }
      }),
    );

    const failures = results.filter((r) => !r.ok);
    const rateLimited = failures.some((r: any) => r.error === "RATE_LIMIT");
    const noCredits = failures.some((r: any) => r.error === "CREDITS_EXHAUSTED");

    return new Response(
      JSON.stringify({
        results,
        ok: failures.length === 0,
        rateLimited,
        noCredits,
      }),
      {
        status: noCredits ? 402 : rateLimited ? 429 : 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message ?? "unknown" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});