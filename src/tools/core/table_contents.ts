import { z } from "zod";
import { guardedQuery } from "../../core/datapolicy.js";
import { ToolError } from "../../core/errors.js";
import { tsv } from "../../core/output.js";
import { defineTool } from "../../core/tool.js";

const NAME_RE = /^[A-Z0-9_/]+$/;

/**
 * WHERE y ORDER BY se concatenan al SELECT: no pueden abrir otra consulta,
 * comentar el resto ni cambiar de sentencia. Lo que haga falta más allá, con sql_query.
 */
export function assertSafeFragment(frag: string, label: string): void {
  const outside = frag.replace(/'(?:[^']|'')*'/g, "''");
  if ((frag.match(/'/g)?.length ?? 0) % 2) throw new ToolError("INPUT", `${label}: comilla sin cerrar.`);
  if (/[;"*]|--/.test(outside) || /\b(select|union|intersect|except|into|from|join|delete|update|insert|modify)\b/i.test(outside)) {
    throw new ToolError("INPUT", `${label}: solo condiciones sobre columnas (sin subconsultas, comentarios ni «;»). Para eso usa sql_query.`);
  }
}

export default defineTool({
  name: "table_contents",
  title: "Contenido de una tabla",
  description:
    "Filas de una tabla, vista o CDS, con columnas y filtro opcionales. Atajo de sql_query para el caso típico " +
    "«enséñame lo que hay en ZTABLA donde …». Para JOIN, subconsultas o agregados usa sql_query.",
  access: "read",
  input: {
    table: z.string().min(1),
    columns: z.array(z.string()).optional().describe("Columnas; por defecto todas"),
    where: z.string().optional().describe("Condición ABAP SQL sin la palabra WHERE, p. ej. werks = '1000' AND lvorm = ''"),
    order_by: z.string().optional(),
    max_rows: z.number().int().min(1).max(5000).default(100),
  },
  async run({ table, columns, where, order_by, max_rows }, { sap, system }) {
    const t = table.trim().toUpperCase();
    if (!NAME_RE.test(t)) throw new ToolError("INPUT", `Nombre de tabla inválido: ${table}`);
    const cols = columns?.map((c) => c.trim().toUpperCase()) ?? [];
    for (const c of cols) if (!NAME_RE.test(c)) throw new ToolError("INPUT", `Columna inválida: ${c}`);
    if (where) assertSafeFragment(where, "where");
    if (order_by) {
      assertSafeFragment(order_by, "order_by");
      if (!/^[A-Za-z0-9_/~]+(\s+(asc|desc))?(\s*,\s*[A-Za-z0-9_/~]+(\s+(asc|desc))?)*$/i.test(order_by.trim())) {
        throw new ToolError("INPUT", "order_by: columnas separadas por coma, con ASC/DESC opcional.");
      }
    }
    const sql =
      `SELECT ${cols.length ? cols.join(", ") : "*"} FROM ${t}` +
      (where ? ` WHERE ${where}` : "") +
      (order_by ? ` ORDER BY ${order_by}` : "");
    const r = await guardedQuery(sap, system, sql, max_rows);
    if (!r.values.length) return `${t}: la consulta se ejecutó y no devolvió filas${where ? " con ese filtro" : ""}.`;
    return `${t}: ${r.values.length} filas\n\n${tsv(r.columns, r.values.map((v) => r.columns.map((n) => v[n])))}${r.notes.length ? `\n\n${r.notes.join("\n")}` : ""}`;
  },
});
