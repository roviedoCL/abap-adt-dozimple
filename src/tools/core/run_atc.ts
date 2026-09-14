import { z } from "zod";
import { defaultVariant, recallRun, rememberRun, runAtc } from "../../core/atc.js";
import { normalizeError, ToolError } from "../../core/errors.js";
import { decodeEntities, htmlToText } from "../../core/feeds.js";
import { sourceObjectsOf } from "../../core/revisions.js";
import { budget } from "../../core/output.js";
import { resolveByTypePrefix, resolveObject, sqlLiteral, TYPE_HELP } from "../../core/objects.js";
import { assertTrkorr } from "../../core/policy.js";
import { defineTool } from "../../core/tool.js";

const decode = decodeEntities;
const strip = htmlToText;

export default defineTool({
  name: "run_atc",
  title: "Ejecutar ATC",
  description:
    "Ejecuta el ATC sobre un objeto o una orden de transporte y lista los hallazgos numerados (prioridad, línea, " +
    "check, mensaje), con los totales P1/P2/P3 que da SAP. El resultado queda recordado: atc_quickfix(finding=N) " +
    "trabaja sobre el hallazgo N y explain=N trae la documentación del check (nota SAP, supresión) sin re-ejecutar.",
  access: "read",
  requires: { adt: ["/sap/bc/adt/atc/runs"] },
  input: {
    object_name: z.string().optional(),
    object_type: z.string().optional().describe(TYPE_HELP),
    transport: z.string().optional().describe("En vez de un objeto: todos los objetos de esta orden"),
    variant: z.string().optional().describe("Variante ATC; por defecto la del sistema"),
    priorities: z.array(z.number().int().min(1).max(4)).optional().describe("Filtrar la lista, p. ej. [1,2]"),
    max_findings: z.number().int().min(1).max(1000).default(200),
    include_exempted: z.boolean().default(false),
    explain: z.number().int().min(1).optional().describe("Documentación del hallazgo N del último ATC (no re-ejecuta)"),
  },
  async run(a, { sap, system }) {
    const c = await sap.adt();

    if (a.explain) {
      const last = recallRun(system.id);
      const f = last?.findings.find((x) => x.n === a.explain);
      if (!f) throw new ToolError("INPUT", last ? `El último ATC tiene ${last.findings.length} hallazgos.` : "No hay un ATC previo en esta sesión: ejecuta run_atc primero.");
      if (!f.docUri) return `El hallazgo ${f.n} no trae documentación.`;
      const r = await c.atcDocumentation(f.docUri);
      return budget(`Hallazgo ${f.n}: ${f.checkTitle} — ${decode(f.messageTitle)}\n${f.objectName} L${f.line}\n\n${strip(String(r.body))}`);
    }

    let uri: string;
    let scope: string;
    if (a.transport) {
      const tr = assertTrkorr(a.transport);
      uri = `/sap/bc/adt/cts/transportrequests/${tr}`;
      scope = `orden ${tr}`;
    } else if (a.object_name) {
      const obj = await resolveObject(c, a.object_name, a.object_type);
      uri = obj.uri;
      scope = `${obj.name} (${obj.type})`;
    } else {
      throw new ToolError("INPUT", "Indica object_name o transport.");
    }

    const variant = a.variant ?? (await defaultVariant(c));
    let res;
    try {
      res = await runAtc(c, uri, variant, a.max_findings, a.include_exempted);
    } catch (e) {
      // NW 7.50 no acepta una orden como conjunto ATC («No URI-Mapping defined for URI»):
      // se ejecuta sobre los objetos de la orden, en una sola corrida.
      const te = normalizeError(e);
      if (!a.transport || te.kind !== "SAP" || !/URI-Mapping|500/i.test(te.message)) throw te;
      const tr = assertTrkorr(a.transport);
      const tasks = await sap.query(`SELECT trkorr FROM e070 WHERE strkorr = ${sqlLiteral(tr)}`, 500);
      const ids = [tr, ...tasks.values.map((v) => v.TRKORR as string)];
      const rows = await sap.query(`SELECT pgmid, object, obj_name FROM e071 WHERE trkorr IN ( ${ids.map(sqlLiteral).join(", ")} )`, 5000);
      const { source, ddic } = sourceObjectsOf(rows.values as any);
      const refs = [
        ...source.map((s) => ({ name: s.name, types: s.types })),
        ...ddic.map((d) => ({ name: d.split(" ").slice(1).join(" "), types: [d.split(" ")[0].slice(0, 4) + "/"] })),
      ];
      const uris = (await Promise.all(refs.map((r) => resolveByTypePrefix(c, r.name, r.types)))).filter(Boolean).map((r) => r!.uri);
      if (!uris.length) throw new ToolError("NOT_FOUND", `La orden ${tr} no contiene objetos que el ATC pueda revisar.`);
      res = await runAtc(c, uris, variant, a.max_findings, a.include_exempted);
      scope = `orden ${tr} (sus ${uris.length} objetos: este release no admite la orden como conjunto ATC)`;
    }
    rememberRun(system.id, res);

    const shown = res.findings.filter((f) => !a.priorities || a.priorities.includes(f.priority));
    const byPrio = [1, 2, 3, 4].map((p) => res.findings.filter((f) => f.priority === p).length);
    const stats = res.stats ? `SAP: P1 ${res.stats.p1} · P2 ${res.stats.p2} · P3 ${res.stats.p3}` : `P1 ${byPrio[0]} · P2 ${byPrio[1]} · P3 ${byPrio[2]}`;
    const capped = res.stats && res.stats.p1 + res.stats.p2 + res.stats.p3 > res.findings.length
      ? `\nSe recibieron ${res.findings.length} de ${res.stats.p1 + res.stats.p2 + res.stats.p3}: sube max_findings para verlos todos.`
      : "";
    if (!res.findings.length) return `ATC de ${scope} (variante ${variant}): se ejecutó y no hay hallazgos${a.include_exempted ? "" : " sin excepción"}.`;

    const lines = shown.map(
      (f) => `${String(f.n).padStart(3)}. P${f.priority} ${f.objectName} L${f.line}  [${f.checkTitle}] ${decode(f.messageTitle)}${f.exempted ? " (con excepción)" : ""}`,
    );
    return (
      `ATC de ${scope} · variante ${variant} · ${stats}${capped}\n` +
      `${a.priorities ? `Filtrado a P${a.priorities.join("/P")}: ${shown.length}\n` : ""}\n${lines.join("\n")}\n\n` +
      `Siguiente: run_atc(explain=N) para la documentación del check; atc_quickfix(finding=N) para ver correcciones.`
    );
  },
});
