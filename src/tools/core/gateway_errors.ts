import { z } from "zod";
import { htmlToText, parseAtom } from "../../core/feeds.js";
import { ToolError } from "../../core/errors.js";
import { budget } from "../../core/output.js";
import { defineTool } from "../../core/tool.js";

export default defineTool({
  name: "gateway_errors",
  title: "Errores de SAP Gateway (/IWFND/ERROR_LOG)",
  description:
    "Lista los errores del log de SAP Gateway (servicios OData): servicio, error, usuario, fecha. Con detail=N trae el " +
    "detalle (contexto, excepción, dónde saltó). Útil para fallos de DPC_EXT y apps Fiori. Solo existe en el sistema " +
    "que hospeda Gateway (en landscapes con Fiori separado, el servidor Fiori).",
  access: "read",
  requires: { adt: ["/sap/bc/adt/gw/errorlog"] },
  input: {
    user: z.string().optional(),
    max: z.number().int().min(1).max(200).default(20),
    detail: z.number().int().min(1).optional().describe("Número de la lista para ver el detalle"),
  },
  async run({ user, max, detail }, { sap }) {
    const c = await sap.adt();
    const qs: Record<string, string> = { $top: String(Math.max(max, detail ?? 0)) };
    if (user) qs.$query = `and( equals( username, ${user.toUpperCase()} ) )`;
    const r = await c.httpClient.request("/sap/bc/adt/gw/errorlog", { headers: { Accept: "application/atom+xml;type=feed" }, qs });
    const entries = parseAtom(String(r.body));
    if (!entries.length) return `El log de errores de Gateway se leyó y no tiene entradas${user ? ` de ${user}` : ""}.`;
    if (detail) {
      const e = entries[detail - 1];
      if (!e) throw new ToolError("INPUT", `Solo hay ${entries.length} entradas.`);
      const href = e.links.find((l) => /errorlog\//.test(l.href))?.href.replace(/^adt:\/\/[^/]+/, "");
      if (!href) return `${e.title}\n${e.summary}`;
      const d = await c.httpClient.request(href, { headers: { Accept: "text/html, application/xhtml+xml, application/xml;q=0.5" } });
      return budget(`${e.title} · ${e.updated} · ${e.author}\n\n${htmlToText(String(d.body))}`);
    }
    return (
      `${entries.length} errores (los más recientes)\n\n` +
      entries
        .slice(0, max)
        .map((e, i) => `${i + 1}. ${e.updated.replace("T", " ").slice(0, 19)} · ${e.author || "?"} · ${e.categories.map((x) => x.label || x.term).join(", ")}\n   ${e.title}`)
        .join("\n")
    );
  },
});
