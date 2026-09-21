import { z } from "zod";
import { ToolError } from "../../core/errors.js";
import { sqlLiteral } from "../../core/objects.js";
import { tsv } from "../../core/output.js";
import { defineTool } from "../../core/tool.js";
import type { SapConnection } from "../../core/connection.js";

/** Código de idioma interno de SAP (DDLANGUAGE es LANG de 1 carácter). */
const LANG: Record<string, string> = { EN: "E", ES: "S", DE: "D", PT: "P", FR: "F", IT: "I" };

/** Solo tablas de texto del DDIC y sus campos, como literales: el compilador impide pasar un valor de usuario. */
type TextTable = "dd04t" | "dd01t" | "dd07t" | "dd40t" | "dd02t";
type TextKey = "rollname" | "domname" | "typename" | "tabname";

async function text(sap: SapConnection, table: TextTable, keyField: TextKey, key: string, lang: string, fields: string) {
  if (!/^[a-z0-9_]+(\s*,\s*[a-z0-9_]+)*$/i.test(fields)) throw new Error(`Lista de campos inválida: ${fields}`);
  const r = await sap.query(`SELECT ddlanguage, ${fields} FROM ${table} WHERE ${keyField} = ${sqlLiteral(key)} AND as4local = 'A'`, 20);
  return r.values.find((v) => v.DDLANGUAGE === lang) ?? r.values.find((v) => v.DDLANGUAGE === "E") ?? r.values[0];
}

const pick = (row: Record<string, any>, fields: string[]) =>
  fields.filter((f) => row[f] !== undefined && String(row[f]).trim() !== "" && String(row[f]) !== "0")
    .map((f) => `${f.toLowerCase()}=${String(row[f]).trim()}`)
    .join(" · ");

export default defineTool({
  name: "ddic_type_info",
  title: "Elemento de datos, dominio o tipo tabla",
  description:
    "Definición de un tipo DDIC: elemento de datos (dominio, tipo, longitud, textos), dominio (tipo, longitud, " +
    "valores fijos, tabla de valores) o tipo tabla (tipo de línea, clave). Lee DD04L/DD01L/DD07L/DD40L: funciona " +
    "igual en ECC 7.50 y en S/4. Detecta el tipo si no se indica.",
  access: "read",
  input: {
    name: z.string().min(1),
    kind: z.enum(["DTEL", "DOMA", "TTYP"]).optional(),
  },
  async run({ name, kind }, { sap, system }) {
    const n = name.trim().toUpperCase();
    const lang = LANG[system.language.toUpperCase()] ?? "E";
    const out: string[] = [];

    if (!kind || kind === "DTEL") {
      const r = await sap.query(`SELECT * FROM dd04l WHERE rollname = ${sqlLiteral(n)} AND as4local = 'A'`, 1);
      const d = r.values[0];
      if (d) {
        const t = await text(sap, "dd04t", "rollname", n, lang, "ddtext, reptext, scrtext_m");
        out.push(`Elemento de datos ${n}${t ? ` «${t.DDTEXT}»` : ""}`);
        out.push("  " + pick(d, ["DOMNAME", "DATATYPE", "LENG", "DECIMALS", "OUTPUTLEN", "REFKIND", "REFTYPE", "CONVEXIT", "ENTITYTAB", "MEMORYID", "LOWERCASE"]));
        if (t) out.push(`  cabecera «${String(t.REPTEXT ?? "").trim()}» · texto medio «${String(t.SCRTEXT_M ?? "").trim()}»`);
        if (d.DOMNAME && !kind) out.push("", ...(await domain(sap, String(d.DOMNAME).trim(), lang)));
        return out.join("\n");
      }
      if (kind) throw new ToolError("NOT_FOUND", `No hay elemento de datos activo ${n}.`);
    }
    if (!kind || kind === "DOMA") {
      const lines = await domain(sap, n, lang);
      if (lines.length) return lines.join("\n");
      if (kind) throw new ToolError("NOT_FOUND", `No hay dominio activo ${n}.`);
    }
    const r = await sap.query(`SELECT * FROM dd40l WHERE typename = ${sqlLiteral(n)} AND as4local = 'A'`, 1);
    const tt = r.values[0];
    if (tt) {
      const t = await text(sap, "dd40t", "typename", n, lang, "ddtext");
      return [`Tipo tabla ${n}${t ? ` «${t.DDTEXT}»` : ""}`, "  " + pick(tt, ["ROWTYPE", "ROWKIND", "DATATYPE", "LENG", "ACCESSMODE", "KEYDEF", "KEYKIND", "GENERIC"])].join("\n");
    }
    throw new ToolError("NOT_FOUND", `${n} no es un elemento de datos, dominio ni tipo tabla activo.`);
  },
});

async function domain(sap: SapConnection, n: string, lang: string): Promise<string[]> {
  const r = await sap.query(`SELECT * FROM dd01l WHERE domname = ${sqlLiteral(n)} AND as4local = 'A'`, 1);
  const d = r.values[0];
  if (!d) return [];
  const t = await text(sap, "dd01t", "domname", n, lang, "ddtext");
  const out = [`Dominio ${n}${t ? ` «${t.DDTEXT}»` : ""}`, "  " + pick(d, ["DATATYPE", "LENG", "DECIMALS", "OUTPUTLEN", "LOWERCASE", "SIGNFLAG", "CONVEXIT", "ENTITYTAB", "VALEXI"])];
  const fv = await sap.query(`SELECT domvalue_l, domvalue_h, valpos FROM dd07l WHERE domname = ${sqlLiteral(n)} AND as4local = 'A' ORDER BY valpos`, 500);
  if (fv.values.length) {
    const tx = await sap.query(`SELECT ddlanguage, valpos, ddtext FROM dd07t WHERE domname = ${sqlLiteral(n)} AND as4local = 'A'`, 2000);
    const label = (pos: string) =>
      (tx.values.find((v) => v.VALPOS === pos && v.DDLANGUAGE === lang) ?? tx.values.find((v) => v.VALPOS === pos))?.DDTEXT ?? "";
    out.push(`  valores fijos (${fv.values.length}):`);
    out.push(
      tsv(["valor", "hasta", "texto"], fv.values.map((v) => [v.DOMVALUE_L, v.DOMVALUE_H, label(v.VALPOS)]))
        .split("\n")
        .map((l) => "    " + l)
        .join("\n"),
    );
  }
  return out;
}
