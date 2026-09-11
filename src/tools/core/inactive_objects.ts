import { z } from "zod";
import { defineTool } from "../../core/tool.js";

export default defineTool({
  name: "inactive_objects",
  title: "Objetos sin activar",
  description:
    "Objetos con versión inactiva (guardados sin activar) del usuario de la conexión, con su orden. Revísalo antes de " +
    "liberar: lo inactivo NO viaja en la orden. Con all_users=true incluye los de otros usuarios.",
  access: "read",
  requires: { adt: ["/sap/bc/adt/activation/inactiveobjects"] },
  input: { all_users: z.boolean().default(false) },
  async run({ all_users }, { sap, system }) {
    const c = await sap.adt();
    const recs = await c.inactiveObjects();
    const rows = recs
      .filter((r) => r.object)
      .filter((r) => all_users || r.object!.user?.toUpperCase() === system.user.toUpperCase());
    if (!rows.length) return `No hay objetos inactivos${all_users ? "" : ` de ${system.user}`}.`;
    const byOrder = new Map<string, string[]>();
    for (const r of rows) {
      const o = r.object!;
      const key = r.transport?.["adtcore:name"] ?? "(sin orden: local o sin registrar)";
      byOrder.set(key, [...(byOrder.get(key) ?? []), `${o["adtcore:name"]} (${o["adtcore:type"]})${all_users ? ` · ${o.user}` : ""}${o.deleted ? " · BORRADO pendiente" : ""}`]);
    }
    return (
      `${rows.length} objetos inactivos${all_users ? "" : ` de ${system.user}`}:\n` +
      [...byOrder].map(([t, list]) => `\n${t}\n  ${list.join("\n  ")}`).join("\n")
    );
  },
});
