const ALLOWED_TAGS = new Set(["h1", "h2", "h3", "p", "strong", "em", "ul", "ol", "li", "a", "blockquote", "br"]);
const BLOCK_TAG_PATTERN = /<\/?(h1|h2|h3|p|strong|em|ul|ol|li|a|blockquote|br)\b/i;

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const safeHref = (value: string) => {
  const href = value.trim();
  return /^(https?:\/\/|mailto:|\/)/i.test(href) ? href : "";
};

const inlineMarkdownToHtml = (value: string) =>
  escapeHtml(value)
    .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (_match, label, href) => {
      const url = safeHref(href);
      return url ? `<a href="${escapeHtml(url)}">${label}</a>` : label;
    })
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");

const closeParagraph = (html: string[], paragraphLines: string[]) => {
  if (!paragraphLines.length) return;
  html.push(`<p>${inlineMarkdownToHtml(paragraphLines.join(" "))}</p>`);
  paragraphLines.length = 0;
};

const closeList = (html: string[], listItems: string[], tag: "ul" | "ol") => {
  if (!listItems.length) return;
  html.push(`<${tag}>${listItems.map((item) => `<li>${item}</li>`).join("")}</${tag}>`);
  listItems.length = 0;
};

const closeLists = (html: string[], bulletItems: string[], orderedItems: string[]) => {
  closeList(html, bulletItems, "ul");
  closeList(html, orderedItems, "ol");
};

const sanitizedOpeningTag = (tagName: string, rawTag: string) => {
  if (tagName === "a") {
    const hrefMatch = rawTag.match(/\shref=(["'])(.*?)\1/i);
    const href = hrefMatch ? safeHref(hrefMatch[2]) : "";
    return href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">` : "<a>";
  }
  if (tagName === "br") return "<br>";
  return `<${tagName}>`;
};

export const sanitizeBlogHtml = (html: string) => {
  const source = String(html ?? "");
  let rendered = "";
  let cursor = 0;
  const tagPattern = /<\/?([a-zA-Z0-9]+)(?:\s[^>]*)?>/g;
  let match: RegExpExecArray | null;

  while ((match = tagPattern.exec(source))) {
    rendered += escapeHtml(source.slice(cursor, match.index));
    const rawTag = match[0];
    const tagName = match[1].toLowerCase();
    const isClosing = rawTag.startsWith("</");

    if (!ALLOWED_TAGS.has(tagName)) {
      rendered += escapeHtml(rawTag);
    } else if (isClosing) {
      rendered += tagName === "br" ? "" : `</${tagName}>`;
    } else {
      rendered += sanitizedOpeningTag(tagName, rawTag);
    }
    cursor = match.index + rawTag.length;
  }

  rendered += escapeHtml(source.slice(cursor));
  return rendered;
};

export const blogMarkdownToHtml = (markdown: string) => {
  const html: string[] = [];
  const paragraphLines: string[] = [];
  const bulletItems: string[] = [];
  const orderedItems: string[] = [];
  const lines = String(markdown ?? "").replace(/\r\n/g, "\n").split("\n");

  lines.forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) {
      closeParagraph(html, paragraphLines);
      closeLists(html, bulletItems, orderedItems);
      return;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      closeParagraph(html, paragraphLines);
      closeLists(html, bulletItems, orderedItems);
      const level = heading[1].length;
      html.push(`<h${level}>${inlineMarkdownToHtml(heading[2].trim())}</h${level}>`);
      return;
    }

    const blockquote = line.match(/^>\s+(.+)$/);
    if (blockquote) {
      closeParagraph(html, paragraphLines);
      closeLists(html, bulletItems, orderedItems);
      html.push(`<blockquote>${inlineMarkdownToHtml(blockquote[1].trim())}</blockquote>`);
      return;
    }

    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      closeParagraph(html, paragraphLines);
      closeList(html, orderedItems, "ol");
      bulletItems.push(inlineMarkdownToHtml(bullet[1].trim()));
      return;
    }

    const ordered = line.match(/^\d+\.\s+(.+)$/);
    if (ordered) {
      closeParagraph(html, paragraphLines);
      closeList(html, bulletItems, "ul");
      orderedItems.push(inlineMarkdownToHtml(ordered[1].trim()));
      return;
    }

    closeLists(html, bulletItems, orderedItems);
    paragraphLines.push(line);
  });

  closeParagraph(html, paragraphLines);
  closeLists(html, bulletItems, orderedItems);

  return html.join("\n");
};

export const renderBlogBodyToHtml = (body: string) => {
  const content = String(body ?? "");
  return BLOCK_TAG_PATTERN.test(content) ? sanitizeBlogHtml(content) : blogMarkdownToHtml(content);
};
