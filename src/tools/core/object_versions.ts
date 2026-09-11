import { z } from "zod";
import { ToolError } from "../../core/errors.js";
import { CLASS_INCLUDES, resolveObject, TYPE_HELP } from "../../core/objects.js";
import { budget } from "../../core/output.js";
import { defineTool } from "../../core/tool.js";

export default defineTool({
  name: "object_versions",
  title: "Versiones de un objeto",
  description:
    "Historial de versiones de un objeto (fecha, autor, orden). Con show=N devuelve la fuente de la versión N de la " +
    "lista (1 = la más reciente), para comparar con la actual.",
  access: "read",
  input: {
    object_name: z.string().min(1),
    object_type: z.string().optional().describe(TYPE_HELP),
    include: z.enum(CLASS_INCLUDES).default("main"),
    show: z.number().int().min(1).optional(),
  },
  async run({ object_name, object_type, include, show }, { sap }) {
    const c = await sap.adt();
    const obj = await resolveObject(c, object_name, object_type);
    const revs = await c.revisions(obj.uri, obj.type.startsWith("CLAS") ? include : undefined);
    if (!revs.length) return `${obj.name}: SAP no devuelve versiones para este objeto.`;
    if (show) {
      const r = revs[show - 1];
      if (!r) throw new ToolError("INPUT", `Solo hay ${revs.length} versiones.`);
      const src = await c.getObjectSource(r.uri);
      return budget(`${obj.name} · versión ${r.version} · ${r.date} · ${r.author} · ${r.versionTitle}\n\n${src}`);
    }
    return (
      `${obj.name}: ${revs.length} versiones\n\n` +
      revs.map((r, i) => `  ${i + 1}. ${r.date}  ${r.author}  ${r.version}  ${r.versionTitle}`).join("\n")
    );
  },
});
