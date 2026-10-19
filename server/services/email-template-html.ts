import createDOMPurify from "dompurify";
import { JSDOM } from "jsdom";
import { renderTemplate } from "@shared/email-template-core";

const window = new JSDOM("").window;
const purifier = createDOMPurify(window);

export function sanitizeEmailHtml(html: string): string {
  return purifier.sanitize(html, {
    ALLOWED_TAGS: ["a", "p", "br", "div", "span", "strong", "b", "em", "i", "u", "h1", "h2", "h3", "ul", "ol", "li", "blockquote", "hr"],
    ALLOWED_ATTR: ["href", "title"],
  });
}

export function renderEmailHtml(html: string, values: Record<string, string | null | undefined>, options: { allowBlankOptionalVariables?: boolean; requiredVariables?: string[] } = {}): { output: string; missing: string[] } {
  const tokens: Array<{ marker: string; html: string }> = [];
  const prepared = Object.fromEntries(Object.entries(values).map(([key, value]) => {
    if (typeof value === "string" && /<\/(?:p|div|span|strong|em|ul|ol|li|a)>/i.test(value)) {
      const marker = `BFM_HTML_FRAGMENT_${tokens.length}_END`;
      tokens.push({ marker, html: sanitizeEmailHtml(value) });
      return [key, marker];
    }
    return [key, value];
  }));
  const rendered = renderTemplate(sanitizeEmailHtml(html), prepared, true, options);
  let output = rendered.output;
  for (const token of tokens) output = output.split(token.marker).join(token.html);
  return { output: sanitizeEmailHtml(output), missing: rendered.missing };
}
