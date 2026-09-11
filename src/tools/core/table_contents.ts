import { z } from "zod";
import { ToolError } from "../../core/errors.js";
import { tsv } from "../../core/output.js";
import { assertNotSensitive } from "../../core/policy.js";
import { defineTool } from "../../core/tool.js";

const NAME_RE = /^[A-Z0-9_/]+$/;

export default defineTool({
  name: "table_contents",
  title: "Contenido de una tabla",
  description:
    "Filas de una tabla, vista o CDS, con columnas y filtro opcionales. Atajo de sql_query para el caso típico " +
    "«enséñame lo que hay en ZTABLA donde …». Para JOIN o agregados usa sql_query.",
  access: "read",
  input: {
    table: z.string().min(1),
    columns: z.array(z.string()).optional().describe("Columnas; por defecto todas"),
    where: z.string().optional().describe("Condición ABAP SQL sin la palabra WHERE, p. ej. werks = '1000' AND lvorm = ''"),
    order_by: z.string().optional(),
    max_rows: z.number().int().min(1).max(5000).default(100),
  },
  async run({ table, columns, where, order_by, max_rows }, { sap }) {
    const t = table.trim().toUpperCase();
    if (!NAME_RE.test(t)) throw new ToolError("INPUT", `Nombre de tabla inválido: ${table}`);
    const cols = columns?.map((c) => c.trim().toUpperCase()) ?? [];
    for (const c of cols) if (!NAME_RE.test(c)) throw new ToolError("INPUT", `Columna inválida: ${c}`);
    for (const frag of [where, order_by]) {
      if (frag && /;|\b(delete|update|insert|modify)\b/i.test(frag)) throw new ToolError("INPUT", "Filtro no permitido.");
    }
    const sql =
      `SELECT ${cols.length ? cols.join(", ") : "*"} FROM ${t}` +
      (where ? ` WHERE ${where}` : "") +
      (order_by ? ` ORDER BY ${order_by}` : "");
    assertNotSensitive(sql);
    const r = await sap.query(sql, max_rows);
    if (!r.values.length) return `${t}: la consulta se ejecutó y no devolvió filas${where ? " con ese filtro" : ""}.`;
    const names = r.columns.map((c) => c.name);
    const capped = r.values.length >= max_rows ? `\n\nTope de ${max_rows} filas alcanzado: puede haber más.` : "";
    return `${t}: ${r.values.length} filas\n\n${tsv(names, r.values.map((v) => names.map((n) => v[n])))}${capped}`;
  },
});
