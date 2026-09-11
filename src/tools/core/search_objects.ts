import { z } from "zod";
import { adtType, TYPE_HELP } from "../../core/objects.js";
import { tsv } from "../../core/output.js";
import { defineTool } from "../../core/tool.js";

export default defineTool({
  name: "search_objects",
  title: "Buscar objetos ABAP",
  description:
    "Busca objetos del repositorio por nombre (admite * como comodín). Devuelve nombre, tipo, paquete y descripción. " +
    "Úsala para localizar un objeto antes de leerlo o cuando no sabes el nombre exacto.",
  access: "read",
  input: {
    query: z.string().min(1).describe("Patrón de nombre, p. ej. ZCL_SD_* o ZFI*"),
    object_type: z.string().optional().describe(TYPE_HELP),
    max_results: z.number().int().min(1).max(500).default(50),
  },
  async run({ query, object_type, max_results }, { sap }) {
    const c = await sap.adt();
    const hits = await c.searchObject(query.trim().toUpperCase(), adtType(object_type), max_results);
    if (!hits.length) return `La búsqueda se ejecutó y no hay objetos que casen con ${query}.`;
    const table = tsv(
      ["nombre", "tipo", "paquete", "descripción"],
      hits.map((h) => [h["adtcore:name"], h["adtcore:type"], h["adtcore:packageName"], h["adtcore:description"]]),
    );
    const more = hits.length >= max_results ? `\n\nTope de ${max_results} alcanzado: puede haber más.` : "";
    return `${hits.length} objetos\n\n${table}${more}`;
  },
});
