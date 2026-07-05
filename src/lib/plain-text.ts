const HTML_ENTITY_MAP: Record<string, string> = {
  amp: "&",
  apos: "'",
  copy: "(c)",
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

function decodeHtmlEntities(value: string) {
  if (typeof document !== "undefined") {
    const textarea = document.createElement("textarea");
    textarea.innerHTML = value;
    return textarea.value;
  }

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
    return HTML_ENTITY_MAP[key] ?? match;
  });
}

function stripMarkdown(value: string) {
  return value
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^[\s>]*#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+[.)]\s+/gm, "")
    .replace(/[*_`~]+/g, "");
}

function limitAtWord(value: string, maxLength?: number) {
  if (!maxLength || value.length <= maxLength) return value;
  const slice = value.slice(0, maxLength).trim();
  const lastBreak = Math.max(slice.lastIndexOf(" "), slice.lastIndexOf("."), slice.lastIndexOf("!"), slice.lastIndexOf("?"));
  if (lastBreak > Math.floor(maxLength * 0.65)) return slice.slice(0, lastBreak).trim();
  return slice;
}

export function plainText(value: unknown, options: { maxLength?: number } = {}) {
  if (value === null || value === undefined) return "";

  const withoutTags = String(value)
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");

  const decoded = decodeHtmlEntities(withoutTags);
  const cleaned = stripMarkdown(decoded)
    .replace(/\s+/g, " ")
    .trim();

  return limitAtWord(cleaned, options.maxLength);
}
