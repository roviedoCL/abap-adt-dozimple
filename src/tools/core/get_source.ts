import { z } from "zod";
import { normalizeError, ToolError } from "../../core/errors.js";
import { CLASS_INCLUDES, resolveObject, sourceUrl, sqlLiteral, TYPE_HELP } from "../../core/objects.js";
import { numbered, tsv } from "../../core/output.js";
import { defineTool } from "../../core/tool.js";
import type { SapConnection } from "../../core/connection.js";

const MAX_LINES = 2500;

/** Campos de una tabla/estructura desde DD03L: funciona en cualquier release. */
async function ddicFields(sap: SapConnection, name: string): Promise<string> {
  const r = await sap.query(
    `SELECT fieldname, position, keyflag, rollname, datatype, leng, decimals, comptype, precfield, checktable ` +
      `FROM dd03l WHERE tabname = ${sqlLiteral(name)} AND as4local = 'A' ORDER BY position`,
    2000,
  );
  if (!r.values.length) throw new ToolError("NOT_FOUND", `${name} no tiene campos activos en DD03L.`);
  const cols = ["FIELDNAME", "KEYFLAG", "ROLLNAME", "DATATYPE", "LENG", "DECIMALS", "COMPTYPE", "PRECFIELD", "CHECKTABLE"];
  return (
    `Este release no da fuente ADT para ${name}; campos leídos de DD03L (versión activa):\n\n` +
    tsv(cols.map((c) => c.toLowerCase()), r.values.map((v) => cols.map((c) => v[c])))
  );
}

export default defineTool({
  name: "get_source",
  title: "Leer fuente ABAP",
  description:
    "Lee la fuente de cualquier objeto: programa, include, clase (y sus includes), interfaz, módulo de función " +
    "(sin necesidad de saber el grupo), CDS, tabla/estructura, etc. Admite rango de líneas para objetos grandes. " +
    "Para tablas en releases sin fuente ADT (7.50) devuelve los campos desde DD03L.",
  access: "read",
  input: {
    object_name: z.string().min(1),
    object_type: z.string().optional().describe(TYPE_HELP + " Si se omite y el nombre es único, se deduce."),
    include: z.enum(CLASS_INCLUDES).default("main").describe("Solo clases: main (clase completa), definitions, implementations, macros, testclasses"),
    version: z.enum(["active", "inactive"]).default("active").describe("inactive = lo último guardado aunque no esté activado"),
    start_line: z.number().int().min(1).optional(),
    line_count: z.number().int().min(1).max(MAX_LINES).optional(),
  },
  async run({ object_name, object_type, include, version, start_line, line_count }, { sap }) {
    const c = await sap.adt();
    const obj = await resolveObject(c, object_name, object_type);
    let source: string;
    try {
      const url = await sourceUrl(c, obj, include);
      source = await c.getObjectSource(url, { version });
    } catch (e) {
      const te = normalizeError(e);
      if (te.kind !== "NOT_FOUND" && te.kind !== "SAP") throw te;
      if (!obj.type.startsWith("TABL")) throw te;
      // 7.50: las tablas no tienen fuente ADT; primero la vía de estructuras, luego DD03L.
      try {
        source = await c.getObjectSource(`/sap/bc/adt/ddic/structures/${encodeURIComponent(obj.name.toLowerCase())}/source/main`);
      } catch {
        return ddicFields(sap, obj.name);
      }
    }

    const all = source.replace(/\r\n/g, "\n").split("\n");
    const head = `${obj.name} (${obj.type})${obj.packageName ? ` · paquete ${obj.packageName}` : ""} · ${all.length} líneas · ${version}`;
    if (start_line || line_count) {
      const from = start_line ?? 1;
      const slice = all.slice(from - 1, from - 1 + (line_count ?? MAX_LINES));
      if (!slice.length) return `${head}\n\nEl objeto tiene ${all.length} líneas: no hay nada desde la ${from}.`;
      return `${head}\nLíneas ${from}-${from + slice.length - 1}:\n\n${numbered(slice, from)}`;
    }
    if (all.length > MAX_LINES) {
      return (
        `${head}\n\n${all.slice(0, MAX_LINES).join("\n")}\n\n` +
        `[… recortado: se muestran ${MAX_LINES} de ${all.length} líneas. Pide start_line=${MAX_LINES + 1} para seguir.]`
      );
    }
    return `${head}\n\n${all.join("\n")}`;
  },
});
