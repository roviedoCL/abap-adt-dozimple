/** Lectura mínima de un feed Atom de ADT (errores de Gateway, mensajes…). */
export interface AtomEntry {
  id: string;
  title: string;
  updated: string;
  author: string;
  summary: string;
  categories: Array<{ term: string; label: string }>;
  links: Array<{ href: string; rel: string; type: string }>;
}

const attr = (tag: string, name: string) => new RegExp(`${name}="([^"]*)"`).exec(tag)?.[1] ?? "";
const decode = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const inner = (xml: string, tag: string) =>
  decode(new RegExp(`<(?:atom:)?${tag}[^>]*>([\\s\\S]*?)</(?:atom:)?${tag}>`).exec(xml)?.[1] ?? "").trim();

export function parseAtom(xml: string): AtomEntry[] {
  return [...xml.matchAll(/<(?:atom:)?entry[\s>][\s\S]*?<\/(?:atom:)?entry>/g)].map((m) => {
    const e = m[0];
    return {
      id: inner(e, "id"),
      title: inner(e, "title"),
      updated: inner(e, "updated"),
      author: inner(inner(e, "author") ? e.replace(/[\s\S]*?<(?:atom:)?author>/, "<x>") : "", "name") || inner(e, "name"),
      summary: inner(e, "summary").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
      categories: [...e.matchAll(/<(?:atom:)?category [^>]*>/g)].map((c) => ({ term: attr(c[0], "term"), label: attr(c[0], "label") })),
      links: [...e.matchAll(/<(?:atom:)?link [^>]*>/g)].map((l) => ({ href: attr(l[0], "href"), rel: attr(l[0], "rel"), type: attr(l[0], "type") })),
    };
  });
}

export function htmlToText(html: string): string {
  return decode(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|h\d|li|tr|table)>/gi, "\n")
      .replace(/<\/t[dh]>/gi, "\t")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " "),
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
