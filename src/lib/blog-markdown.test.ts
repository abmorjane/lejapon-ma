import { describe, expect, it } from "vitest";
import { blogMarkdownToHtml, renderBlogBodyToHtml, sanitizeBlogHtml } from "./blog-markdown";

describe("blogMarkdownToHtml", () => {
  it("renders headings, bold text, paragraphs and bullet lists", () => {
    const html = blogMarkdownToHtml(`# Titre principal

## Section
Un paragraphe avec **du gras**.

* Premier point
- Deuxième point

### Sous-section`);

    expect(html).toContain("<h1>Titre principal</h1>");
    expect(html).toContain("<h2>Section</h2>");
    expect(html).toContain("<strong>du gras</strong>");
    expect(html).toContain("<ul><li>Premier point</li><li>Deuxième point</li></ul>");
    expect(html).toContain("<h3>Sous-section</h3>");
  });

  it("escapes raw html before rendering markdown", () => {
    const html = blogMarkdownToHtml(`## Japon
<script>alert("x")</script>
**Important**`);

    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("<strong>Important</strong>");
  });

  it("does not expose supported markdown markers in rendered html text", () => {
    const html = blogMarkdownToHtml(`## Kyoto
**Temple**
- Jardin`);

    expect(html).not.toContain("## Kyoto");
    expect(html).not.toContain("**Temple**");
    expect(html).not.toContain("- Jardin");
  });

  it("renders ordered lists, italic text and quotes", () => {
    const html = blogMarkdownToHtml(`> Conseil
1. Premier
2. Deuxième
Texte avec *italique*`);

    expect(html).toContain("<blockquote>Conseil</blockquote>");
    expect(html).toContain("<ol><li>Premier</li><li>Deuxième</li></ol>");
    expect(html).toContain("<em>italique</em>");
  });

  it("keeps allowed editor html and escapes unsafe html", () => {
    const html = sanitizeBlogHtml(`<h2>Section</h2><p>Texte <strong>important</strong></p><script>alert(1)</script>`);

    expect(html).toContain("<h2>Section</h2>");
    expect(html).toContain("<strong>important</strong>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("renders stored html or legacy markdown depending on body content", () => {
    expect(renderBlogBodyToHtml("<h2>HTML propre</h2>")).toContain("<h2>HTML propre</h2>");
    expect(renderBlogBodyToHtml("## Markdown propre")).toContain("<h2>Markdown propre</h2>");
  });
});
