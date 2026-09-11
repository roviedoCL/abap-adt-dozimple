import { z } from "zod";
import { ToolError } from "../../core/errors.js";
import { sqlLiteral } from "../../core/objects.js";
import { defineTool } from "../../core/tool.js";

const LANG: Record<string, string> = { EN: "E", ES: "S", DE: "D", PT: "P", FR: "F", IT: "I" };

export default defineTool({
  name: "transaction_info",
  title: "Qué ejecuta una transacción",
  description:
    "Programa, dynpro y parámetros de una transacción (TSTC/TSTCP), con su texto. Resuelve transacciones de " +
    "parámetro y orientadas a objetos (clase/método). Úsala para ir de «la ZMM_01 falla» al código.",
  access: "read",
  input: { tcode: z.string().min(1) },
  async run({ tcode }, { sap, system }) {
    const t = tcode.trim().toUpperCase();
    const r = await sap.query(`SELECT tcode, pgmna, dypno FROM tstc WHERE tcode = ${sqlLiteral(t)}`, 1);
    const row = r.values[0];
    if (!row) throw new ToolError("NOT_FOUND", `La transacción ${t} no existe en este sistema.`);
    const texts = await sap.query(`SELECT sprsl, ttext FROM tstct WHERE tcode = ${sqlLiteral(t)}`, 20);
    const lang = LANG[system.language.toUpperCase()] ?? "E";
    const text = (texts.values.find((v) => v.SPRSL === lang) ?? texts.values[0])?.TTEXT ?? "";
    const par = await sap.query(`SELECT param FROM tstcp WHERE tcode = ${sqlLiteral(t)}`, 1);
    const param: string = par.values[0]?.PARAM ?? "";

    const lines = [`${t} «${text}»`];
    if (row.PGMNA) lines.push(`  programa ${row.PGMNA}${row.DYPNO && row.DYPNO !== "0000" ? ` · dynpro ${row.DYPNO}` : ""}`);
    if (param) {
      // OO: \PROGRAM=…\CLASS=…\METHOD=… · parámetro: /*TCODE_BASE campo=valor;…
      const oo = /\\CLASS=([^\\]+)/.exec(param);
      const meth = /\\METHOD=([^\\]+)/.exec(param);
      const base = /^\/\*?([A-Z0-9_/]+)/.exec(param);
      if (oo) lines.push(`  transacción OO: clase ${oo[1]}${meth ? `, método ${meth[1]}` : ""}`);
      else if (base) lines.push(`  transacción de parámetro sobre ${base[1]}`);
      lines.push(`  parámetros: ${param.trim()}`);
    }
    if (!row.PGMNA && !param) lines.push("  sin programa ni parámetros registrados (¿transacción de área de menú?)");
    return lines.join("\n");
  },
});
