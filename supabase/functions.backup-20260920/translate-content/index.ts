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

const SHORT_TEXT_FIELDS = new Set(["title", "category", "meta_title"]);
const MEDIUM_TEXT_FIELDS = new Set(["excerpt", "meta_description", "cover_alt"]);
const RICH_TEXT_FIELDS = new Set(["body", "content", "description", "long_description", "html_body"]);

const PLAIN_FIELD_LIMITS: Record<string, number> = {
  title: 140,
  category: 50,
  meta_title: 120,
  excerpt: 400,
  meta_description: 300,
  cover_alt: 160,
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

function fieldMode(field: string) {
  if (SHORT_TEXT_FIELDS.has(field)) return "short_plain";
  if (MEDIUM_TEXT_FIELDS.has(field)) return "medium_plain";
  if (RICH_TEXT_FIELDS.has(field)) return "rich";
  return "plain";
}

function decodeHtmlEntities(value: string) {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    laquo: '"',
    ldquo: '"',
    lrm: "",
    lsquo: "'",
    lt: "<",
    nbsp: " ",
    quot: '"',
    raquo: '"',
    rdquo: '"',
    rlm: "",
    rsquo: "'",
  };

  return value.replace(/&(#x[\da-f]+|#\d+|[a-z][\w-]+);/gi, (match, entity) => {
    const key = String(entity).toLowerCase();
    if (key.startsWith("#x")) {
      const code = Number.parseInt(key.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (key.startsWith("#")) {
      const code = Number.parseInt(key.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return named[key] ?? match;
  });
}

function stripPlainMarkup(value: string) {
  return decodeHtmlEntities(
    value
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/^[\s>]*#{1,6}\s+/gm, "")
      .replace(/^\s*[-*+]\s+/gm, "")
      .replace(/^\s*\d+[.)]\s+/gm, "")
      .replace(/[*_`~]+/g, ""),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function limitPlainText(value: string, field: string) {
  const limit = PLAIN_FIELD_LIMITS[field];
  if (!limit || value.length <= limit) return value;
  const slice = value.slice(0, limit).trim();
  const lastBreak = Math.max(slice.lastIndexOf(" "), slice.lastIndexOf("."), slice.lastIndexOf("!"), slice.lastIndexOf("?"));
  if (lastBreak > Math.floor(limit * 0.65)) return slice.slice(0, lastBreak).trim();
  return slice;
}

function cleanTranslatedValue(value: string, field: string) {
  const trimmed = value
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();

  if (fieldMode(field) === "rich") return trimmed;
  return limitPlainText(stripPlainMarkup(trimmed), field);
}

function systemPromptFor(item: Item) {
  const mode = fieldMode(item.field);
  const plainRules =
    `This database field is ${item.field}. Translate it independently from every other field. ` +
    `Return plain text only: no HTML tags, no Markdown, no <p>, no <b>, no <strong>, no div, no dir attribute, no inline style, no bullet syntax. ` +
    `Do not add content from another field. Do not include the article body. Keep the same purpose and a reasonable length. `;
  const richRules =
    `This database field is ${item.field}. Translate only this field independently. ` +
    `Preserve useful existing structure such as headings, paragraphs, lists, bold text and links when present. ` +
    `Do not mix the title, excerpt, meta description or category into the body. `;

  return (
    `You are a professional translator for a Moroccan travel agency specialized in Japan trips. ` +
    `Translate from French to ${LANG_LABELS[item.targetLang]}. ` +
    `Brand names and place names such as LeJapon.ma, Tokyo, Kyoto, Osaka and Kamakura must remain natural and recognizable. ` +
    (mode === "rich" ? richRules : plainRules) +
    `For Arabic, use clear Modern Standard Arabic suitable for marketing, but never wrap plain text fields in <p dir="rtl"> or <b>; RTL is handled by the frontend. ` +
    `Return ONLY the translation, with no quotes, no preamble and no explanation.`
  );
}

async function translateOne(item: Item, apiKey: string): Promise<string> {
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
          content: systemPromptFor(item),
        },
        {
          role: "user",
          content: `Table: ${item.table}\nField: ${item.field}\nTranslate this field only:\n${item.sourceText}`,
        },
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
  return cleanTranslatedValue(out, item.field);
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
          const translated = await translateOne(it, apiKey);
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
