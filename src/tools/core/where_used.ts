import { z } from "zod";
import { resolveObject, TYPE_HELP } from "../../core/objects.js";
import { tsv } from "../../core/output.js";
import { defineTool } from "../../core/tool.js";

export default defineTool({
  name: "where_used",
  title: "Dónde se usa",
  description:
    "Lista de uso (where-used) de un objeto: quién lo referencia, con paquete y responsable. Con snippets=true añade " +
    "las líneas de código de cada uso (más lento). Ojo: no ve usos dinámicos ni exits que no declaran tipos.",
  access: "read",
  requires: { adt: ["/sap/bc/adt/repository/informationsystem/usageReferences"] },
  input: {
    object_name: z.string().min(1),
    object_type: z.string().optional().describe(TYPE_HELP),
    max_results: z.number().int().min(1).max(1000).default(100),
    snippets: z.boolean().default(false),
  },
  async run({ object_name, object_type, max_results, snippets }, { sap }) {
    const c = await sap.adt();
    const obj = await resolveObject(c, object_name, object_type);
    const refs = (await c.usageReferences(obj.uri)).filter((r) => r.isResult);
    if (!refs.length) return `${obj.name} (${obj.type}): el where-used se ejecutó y no encontró usos estáticos.`;

    const shown = refs.slice(0, max_results);
    let out =
      `${obj.name} (${obj.type}): ${refs.length} usos` +
      (refs.length > shown.length ? ` (se muestran ${shown.length})` : "") +
      "\n\n" +
      tsv(
        ["nombre", "tipo", "paquete", "responsable", "uso"],
        shown.map((r) => [r["adtcore:name"], r["adtcore:type"], r.packageRef?.["adtcore:name"], r["adtcore:responsible"], r.usageInformation]),
      );

    if (snippets) {
      const sn = await c.usageReferenceSnippets(shown.slice(0, 30));
      const lines = sn.flatMap((s) =>
        s.snippets.map((x) => `${s.objectIdentifier}  L${x.uri?.start?.line ?? "?"}: ${x.content.trim()}`),
      );
      out += `\n\nFragmentos (hasta 30 objetos):\n${lines.join("\n")}`;
    }
    return out;
  },
});
