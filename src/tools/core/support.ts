import { z } from "zod";
import { sqlLiteral } from "../../core/objects.js";
import { tsv } from "../../core/output.js";
import { defineTool } from "../../core/tool.js";

/**
 * Diagnóstico de tickets sin SM37 ni SLG1: jobs y log de aplicación por SQL de
 * solo lectura. Idea de vsp (MIT), reimplementada con tablas estándar.
 */
const JOB_STATUS: Record<string, string> = { A: "cancelado", F: "finalizado", R: "en ejecución", S: "liberado", P: "planificado", Y: "listo", Z: "liberado/suspendido", X: "desconocido" };

const like = (p: string) => sqlLiteral(p.toUpperCase().replace(/\*/g, "%"));
const ymd = (d: string) => d.replace(/-/g, "");

const jobs = defineTool({
  name: "jobs",
  title: "Jobs de fondo (SM37)",
  description:
    "Jobs de fondo por nombre (admite *), usuario, estado y fecha, con sus pasos (programa y variante). Responde " +
    "«¿corrió anoche el job de X?, ¿por qué se canceló?». El log detallado del job sigue en SM37.",
  access: "read",
  input: {
    job_name: z.string().default("*"),
    user: z.string().optional(),
    status: z.enum(["A", "F", "R", "S", "P", "Y"]).optional().describe("A cancelado, F finalizado, R en ejecución, S liberado, P planificado"),
    from_date: z.string().optional().describe("AAAA-MM-DD; por defecto los últimos 3 días"),
    max: z.number().int().min(1).max(500).default(50),
  },
  async run({ job_name, user, status, from_date, max }, { sap }) {
    const from = ymd(from_date ?? new Date(Date.now() - 3 * 86400_000).toISOString().slice(0, 10));
    const where = [`jobname LIKE ${like(job_name)}`, `( strtdate >= ${sqlLiteral(from)} OR sdlstrtdt >= ${sqlLiteral(from)} )`];
    if (user) where.push(`sdluname = ${sqlLiteral(user.toUpperCase())}`);
    if (status) where.push(`status = ${sqlLiteral(status)}`);
    const r = await sap.query(
      `SELECT jobname, jobcount, status, sdluname, sdlstrtdt, sdlstrttm, strtdate, strttime, enddate, endtime FROM tbtco ` +
        `WHERE ${where.join(" AND ")} ORDER BY strtdate DESCENDING, strttime DESCENDING, sdlstrtdt DESCENDING`,
      max,
    );
    if (!r.values.length) return `No hay jobs que casen desde ${from}.`;
    const keys = r.values.map((v) => `( jobname = ${sqlLiteral(v.JOBNAME)} AND jobcount = ${sqlLiteral(v.JOBCOUNT)} )`);
    const steps = await sap.query(`SELECT jobname, jobcount, stepcount, progname, variant FROM tbtcp WHERE ${keys.slice(0, 40).join(" OR ")}`, 400);
    const stepOf = (v: any) =>
      steps.values
        .filter((s) => s.JOBNAME === v.JOBNAME && s.JOBCOUNT === v.JOBCOUNT)
        .map((s) => `${String(s.PROGNAME).trim()}${String(s.VARIANT).trim() ? `/${String(s.VARIANT).trim()}` : ""}`)
        .join(" + ");
    return (
      `${r.values.length} jobs desde ${from}${r.values.length >= max ? ` (tope ${max})` : ""}\n\n` +
      tsv(
        ["job", "estado", "usuario", "planificado", "inicio", "fin", "pasos"],
        r.values.map((v) => [
          v.JOBNAME,
          JOB_STATUS[v.STATUS] ?? v.STATUS,
          v.SDLUNAME,
          `${v.SDLSTRTDT} ${v.SDLSTRTTM}`,
          v.STRTDATE && v.STRTDATE !== "00000000" ? `${v.STRTDATE} ${v.STRTTIME}` : "",
          v.ENDDATE && v.ENDDATE !== "00000000" ? `${v.ENDDATE} ${v.ENDTIME}` : "",
          stepOf(v),
        ]),
      )
    );
  },
});

const appLog = defineTool({
  name: "application_log",
  title: "Log de aplicación (SLG1), cabeceras",
  description:
    "Cabeceras del log de aplicación (BALHDR) por objeto/subobjeto, nº externo, usuario y fecha, con el recuento de " +
    "errores y avisos. Los TEXTOS de los mensajes están comprimidos (BALDAT) y no se leen por SQL: para eso, SLG1 con " +
    "el nº de log que devuelve esta tool.",
  access: "read",
  input: {
    object: z.string().optional().describe("Objeto de log (SLG0), admite *"),
    subobject: z.string().optional(),
    external_number: z.string().optional().describe("Nº externo, admite * (p. ej. el número de pedido)"),
    user: z.string().optional(),
    from_date: z.string().optional().describe("AAAA-MM-DD; por defecto los últimos 3 días"),
    only_errors: z.boolean().default(false),
    max: z.number().int().min(1).max(500).default(50),
  },
  async run(a, { sap }) {
    const from = ymd(a.from_date ?? new Date(Date.now() - 3 * 86400_000).toISOString().slice(0, 10));
    const where = [`aldate >= ${sqlLiteral(from)}`];
    if (a.object) where.push(`object LIKE ${like(a.object)}`);
    if (a.subobject) where.push(`subobject LIKE ${like(a.subobject)}`);
    if (a.external_number) where.push(`extnumber LIKE ${like(a.external_number)}`);
    if (a.user) where.push(`aluser = ${sqlLiteral(a.user.toUpperCase())}`);
    if (a.only_errors) where.push(`( msg_cnt_e > 0 OR msg_cnt_a > 0 )`);
    const r = await sap.query(
      `SELECT lognumber, object, subobject, extnumber, aldate, altime, aluser, altcode, alprog, msg_cnt_al, msg_cnt_a, msg_cnt_e, msg_cnt_w ` +
        `FROM balhdr WHERE ${where.join(" AND ")} ORDER BY aldate DESCENDING, altime DESCENDING`,
      a.max,
    );
    if (!r.values.length) return `No hay logs que casen desde ${from}.`;
    return (
      `${r.values.length} logs desde ${from}${r.values.length >= a.max ? ` (tope ${a.max})` : ""}\n\n` +
      tsv(
        ["log", "objeto/sub", "nº externo", "fecha", "usuario", "tx/programa", "msgs", "cancel.", "errores", "avisos"],
        r.values.map((v) => [
          v.LOGNUMBER, `${v.OBJECT}/${v.SUBOBJECT}`, v.EXTNUMBER, `${v.ALDATE} ${v.ALTIME}`, v.ALUSER,
          String(v.ALTCODE).trim() || v.ALPROG, v.MSG_CNT_AL, v.MSG_CNT_A, v.MSG_CNT_E, v.MSG_CNT_W,
        ]),
      )
    );
  },
});

export default [jobs, appLog];
