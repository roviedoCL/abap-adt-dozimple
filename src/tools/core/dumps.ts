import { z } from "zod";
import type { Dump } from "abap-adt-api";
import { ToolError } from "../../core/errors.js";
import { decodeEntities, htmlToText } from "../../core/feeds.js";
import { budget } from "../../core/output.js";
import { defineTool } from "../../core/tool.js";

const decode = decodeEntities;
const stripHtml = htmlToText;

/** Campo de la tabla «Header Information» del resumen HTML del dump. */
function headerField(d: Dump, label: string): string | undefined {
  const m = d.text.match(new RegExp(`<b>${label}&nbsp;</b></td><td[^>]*>([\\s\\S]*?)</td>`));
  return m ? decode(m[1]).trim() : undefined;
}

function summary(d: Dump, i: number): string {
  const cat = (label: string) => d.categories.find((c) => c.label === label)?.term;
  return (
    `${i}. ${headerField(d, "Date/Time")?.replace(" (System)", "") ?? "?"} · ${cat("ABAP runtime error") ?? "?"} · ` +
    `${cat("Terminated ABAP program") ?? "?"} · ${d.author ?? "?"}\n   ${headerField(d, "Short Text") ?? ""}`
  );
}

export default defineTool({
  name: "dumps",
  title: "Dumps (ST22)",
  description:
    "Lista los dumps de ejecución (ST22): fecha, error, programa, usuario y texto corto. Filtra por usuario y por " +
    "texto (error o programa). Con detail=N devuelve el dump N completo (qué pasó, análisis, dónde terminó, fuente, pila).",
  access: "read",
  requires: { adt: ["/sap/bc/adt/runtime/dumps"] },
  input: {
    user: z.string().optional(),
    contains: z.string().optional().describe("Filtra por error o programa, p. ej. CALL_FUNCTION_NOT_FOUND o ZFI_REPORTE"),
    max: z.number().int().min(1).max(200).default(20),
    detail: z.number().int().min(1).optional().describe("Número de la lista para ver el dump completo"),
  },
  async run({ user, contains, max, detail }, { sap }) {
    const c = await sap.adt();
    const feed = await c.dumps(user ? `and( equals( user, ${user.toUpperCase()} ) )` : "");
    const needle = contains?.toUpperCase();
    const list = feed.dumps.filter((d) => !needle || d.categories.some((x) => x.term.toUpperCase().includes(needle)));
    if (!list.length) {
      return `El feed de dumps se leyó (${feed.dumps.length} en total) y ninguno casa${user ? ` con usuario ${user}` : ""}${contains ? ` y «${contains}»` : ""}.`;
    }
    if (detail) {
      const d = list[detail - 1];
      if (!d) throw new ToolError("INPUT", `Solo hay ${list.length} dumps en la lista.`);
      const self = d.links.find((l) => l.rel === "self")?.href.replace(/^adt:\/\/[^/]+/, "");
      if (!self) return budget(stripHtml(d.text));
      // El recurso ofrece HTML (dump completo) o un XML índice; text/plain da 406.
      const r = await c.httpClient.request(self, { headers: { Accept: "text/html" } });
      return budget(`${summary(d, detail)}\n\n${stripHtml(String(r.body))}`, undefined, "El dump completo está en ST22.");
    }
    const shown = list.slice(0, max);
    return (
      `${list.length} dumps${needle || user ? " que casan" : ""} (se muestran ${shown.length}; el feed trae los más recientes)\n\n` +
      shown.map((d, i) => summary(d, i + 1)).join("\n")
    );
  },
});
