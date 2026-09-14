import { z } from "zod";
import { guardedQuery } from "../../core/datapolicy.js";
import { tsv } from "../../core/output.js";
import { defineTool } from "../../core/tool.js";

export default defineTool({
  name: "sql_query",
  title: "Consulta ABAP SQL",
  description:
    "Ejecuta un SELECT de ABAP SQL (con WHERE, JOIN, ORDER BY, subconsultas) vía la vista previa de datos de ADT. " +
    "Solo lectura. Sintaxis ABAP SQL: literales entre comillas simples, sin «;», sin UP TO (usa max_rows). " +
    "Útil para E070/E071/TADIR/TLOCK/DD03L y datos de negocio. En sistemas con datos productivos las columnas " +
    "personales salen enmascaradas y hay un tope de filas por sistema.",
  access: "read",
  input: {
    query: z.string().min(1).describe("SELECT ... FROM ... WHERE ..."),
    max_rows: z.number().int().min(1).max(5000).default(100),
  },
  async run({ query, max_rows }, { sap, system }) {
    const r = await guardedQuery(sap, system, query, max_rows);
    if (!r.values.length) return `La consulta se ejecutó y no devolvió filas.`;
    const table = tsv(r.columns, r.values.map((v) => r.columns.map((c) => v[c])));
    return `${r.values.length} filas\n\n${table}${r.notes.length ? `\n\n${r.notes.join("\n")}` : ""}`;
  },
});
