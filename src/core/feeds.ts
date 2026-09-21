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
/** Entidades HTML/XML a texto. `&amp;` va la última: si no, «&amp;lt;» acabaría en «<» (doble decodificación). */
export function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&(#39|apos);/g, "'")
    .replace(/&#(\d{1,5});/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&");
}

/**
 * Quita etiquetas hasta que no quede ninguna: una sola pasada deja restos como
 * «<scr<script>ipt>». Los «<» sueltos que queden se eliminan (en HTML válido el
 * texto los trae como &lt;, que se decodifica después).
 */
export function stripTags(html: string, sep = " "): string {
  let out = html;
  for (let prev = ""; prev !== out; ) {
    prev = out;
    out = out.replace(/<[^<>]*>/g, sep);
  }
  return out.replace(/</g, "");
}

const decode = decodeEntities;
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
      summary: stripTags(inner(e, "summary")).replace(/\s+/g, " ").trim(),
      categories: [...e.matchAll(/<(?:atom:)?category [^>]*>/g)].map((c) => ({ term: attr(c[0], "term"), label: attr(c[0], "label") })),
      links: [...e.matchAll(/<(?:atom:)?link [^>]*>/g)].map((l) => ({ href: attr(l[0], "href"), rel: attr(l[0], "rel"), type: attr(l[0], "type") })),
    };
  });
}

/** Tope de entrada antes de sanear: el saneado repite pasadas y el HTML de un dump puede ser enorme. */
export const MAX_HTML_INPUT = 2 * 1024 * 1024;

/**
 * Tras decodificar entidades, «&lt;script&gt;» vuelve a ser «<script>». Este servidor no renderiza HTML, pero un
 * cliente MCP podría, y el contenido de SAP podría imitar así el formato de las respuestas del servidor: se
 * neutraliza todo «<» que abra algo con forma de etiqueta. Un «a < b» del texto se conserva.
 */
export const neutralizeMarkup = (s: string) => s.replace(/<(?=[A-Za-z!/?])/g, "‹");

export function htmlToText(html: string): string {
  if (html.length > MAX_HTML_INPUT) html = html.slice(0, MAX_HTML_INPUT) + "\n[… contenido recortado]";
  let noScripts = html;
  for (let prev = ""; prev !== noScripts; ) {
    prev = noScripts;
    noScripts = noScripts.replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, "");
  }
  const withBreaks = noScripts
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h\d|li|tr|table)>/gi, "\n")
    .replace(/<\/t[dh]>/gi, "\t");
  return neutralizeMarkup(decodeEntities(stripTags(withBreaks)))
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
