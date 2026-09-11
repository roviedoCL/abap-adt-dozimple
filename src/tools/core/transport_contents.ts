import { z } from "zod";
import { ToolError } from "../../core/errors.js";
import { sqlLiteral } from "../../core/objects.js";
import { assertTrkorr } from "../../core/policy.js";
import { describeOrder, orderHeaders } from "../../core/transport.js";
import { defineTool } from "../../core/tool.js";

export default defineTool({
  name: "transport_contents",
  title: "Contenido de una orden",
  description:
    "Cabecera, tareas (con dueño y estado) y objetos de una orden de transporte, leídos de E070/E07T/E071. " +
    "Funciona igual en ECC y S/4. Para el análisis de riesgo de un pase usa la tool del módulo de riesgo si existe.",
  access: "read",
  input: {
    transport: z.string().describe("Orden o tarea, p. ej. DEVK900123"),
    max_objects: z.number().int().min(1).max(5000).default(500),
  },
  async run({ transport, max_objects }, { sap }) {
    const tr = assertTrkorr(transport);
    const children = await sap.query(`SELECT trkorr FROM e070 WHERE strkorr = ${sqlLiteral(tr)}`, 500);
    const ids = [tr, ...children.values.map((v) => v.TRKORR as string)];
    const heads = await orderHeaders(sap, ids);
    const head = heads.get(tr);
    if (!head) throw new ToolError("NOT_FOUND", `La orden ${tr} no existe en este sistema.`);

    const inList = ids.map(sqlLiteral).join(", ");
    const objs = await sap.query(
      `SELECT trkorr, pgmid, object, obj_name, lockflag FROM e071 WHERE trkorr IN ( ${inList} ) ORDER BY object, obj_name`,
      max_objects,
    );

    const lines: string[] = [describeOrder(head)];
    if (head.parent) lines.push(`Es una tarea de ${head.parent}.`);
    const tasks = ids.slice(1).map((id) => heads.get(id)).filter(Boolean);
    if (tasks.length) lines.push("", "Tareas:", ...tasks.map((t) => "  " + describeOrder(t!)));

    // Un mismo objeto suele estar en varias tareas: se agrupa.
    const byObj = new Map<string, Set<string>>();
    for (const o of objs.values) {
      const key = `${o.PGMID} ${o.OBJECT} ${o.OBJ_NAME}`;
      if (!byObj.has(key)) byObj.set(key, new Set());
      byObj.get(key)!.add(o.TRKORR);
    }
    lines.push("", `Objetos (${byObj.size}${objs.values.length >= max_objects ? `, tope de ${max_objects} filas alcanzado` : ""}):`);
    for (const [k, where] of byObj) lines.push(`  ${k}${ids.length > 1 ? `  [${[...where].join(", ")}]` : ""}`);
    if (!byObj.size) lines.push("  (la orden no tiene objetos)");
    return lines.join("\n");
  },
});
