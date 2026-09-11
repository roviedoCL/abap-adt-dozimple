import { z } from "zod";
import { activateObject } from "../../core/activation.js";
import { resolveObject, TYPE_HELP } from "../../core/objects.js";
import { defineTool } from "../../core/tool.js";

export default defineTool({
  name: "activate",
  title: "Activar objeto",
  description:
    "Activa un objeto y devuelve los mensajes de SAP tal cual (errores con línea, avisos, objetos que quedan inactivos).",
  access: "write",
  requires: { adt: ["/sap/bc/adt/activation"] },
  input: {
    object_name: z.string().min(1),
    object_type: z.string().optional().describe(TYPE_HELP),
  },
  async run({ object_name, object_type }, { sap }) {
    const c = await sap.adt();
    const obj = await resolveObject(c, object_name, object_type);
    const r = await activateObject(c, obj);
    return { text: r.text, isError: !r.ok };
  },
});
