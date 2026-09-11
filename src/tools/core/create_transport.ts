import { z } from "zod";
import { ToolError } from "../../core/errors.js";
import { resolveObject, TYPE_HELP } from "../../core/objects.js";
import { defineTool } from "../../core/tool.js";

export default defineTool({
  name: "create_transport",
  title: "Crear orden de transporte",
  description:
    "Crea una orden workbench para el paquete de un objeto, ANTES de la primera edición, para que el cambio caiga en " +
    "la orden del ticket y no en una tarea reutilizada. Sigue la convención de texto del cliente " +
    "(p. ej. «TICKET-123 - AAAAMMDD - tipo de cambio»). No libera nada.",
  access: "write",
  requires: { adt: ["/sap/bc/adt/cts/transports"] },
  input: {
    object_name: z.string().min(1).describe("Un objeto del paquete: define paquete y capa de transporte"),
    object_type: z.string().optional().describe(TYPE_HELP),
    text: z.string().min(5).max(60).describe("Texto de la orden (máx. 60, E07T-AS4TEXT)"),
    transport_layer: z.string().optional(),
  },
  async run({ object_name, object_type, text, transport_layer }, { sap }) {
    const c = await sap.adt();
    const obj = await resolveObject(c, object_name, object_type);
    if (!obj.packageName) throw new ToolError("INPUT", `No se pudo determinar el paquete de ${obj.name}.`);
    if (obj.packageName.startsWith("$")) throw new ToolError("INPUT", `${obj.name} es local (${obj.packageName}): no necesita orden.`);
    const tr = await c.createTransport(obj.uri, text, obj.packageName, transport_layer);
    return `Orden ${tr} creada («${text}») para el paquete ${obj.packageName}. Úsala en write_source(transport=${tr}).`;
  },
});
