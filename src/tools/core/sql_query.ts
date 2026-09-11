import { z } from "zod";
import { tsv } from "../../core/output.js";
import { assertNotSensitive, assertSelectOnly } from "../../core/policy.js";
import { defineTool } from "../../core/tool.js";

export default defineTool({
  name: "sql_query",
  title: "Consulta ABAP SQL",
  description:
    "Ejecuta un SELECT de ABAP SQL (con WHERE, JOIN, ORDER BY, subconsultas) vía la vista previa de datos de ADT. " +
    "Solo lectura. Sintaxis ABAP SQL: literales entre comillas simples, sin «;», sin UP TO (usa max_rows). " +
    "Útil para E070/E071/TADIR/TLOCK/DD03L y datos de negocio.",
  access: "read",
  input: {
    query: z.string().min(1).describe("SELECT ... FROM ... WHERE ..."),
    max_rows: z.number().int().min(1).max(5000).default(100),
  },
  async run({ query, max_rows }, { sap }) {
    const q = assertSelectOnly(query);
    assertNotSensitive(q);
    const r = await sap.query(q, max_rows);
    const cols = r.columns.map((c) => c.name);
    if (!r.values.length) return `La consulta se ejecutó y no devolvió filas.`;
    const table = tsv(cols, r.values.map((v) => cols.map((c) => v[c])));
    const capped = r.values.length >= max_rows ? `\n\nTope de ${max_rows} filas alcanzado: puede haber más.` : "";
    return `${r.values.length} filas\n\n${table}${capped}`;
  },
});
