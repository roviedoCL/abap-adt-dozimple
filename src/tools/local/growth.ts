import { z } from "zod";
import { ToolError } from "../../core/errors.js";
import { readJsonl, recordGap, recordGapClosure, stateDir, type GapClosure, type GapRecord, type UsageRecord } from "../../core/telemetry.js";
import { defineTool } from "../../core/tool.js";

/**
 * El ciclo de crecimiento: cada vez que falta una tool se anota el hueco, y
 * usage_stats cruza huecos y fallos para decidir qué construir después.
 */
const reportGap = defineTool({
  name: "report_gap",
  title: "Anotar una tool que falta",
  description:
    "Anota una necesidad que ninguna tool cubre (p. ej. «crear una tabla en 7.50», «liberar una tarea», «leer un " +
    "SmartForm»), con el rodeo que se usó. Llámala cada vez que tengas que decir al usuario «esto hazlo a mano en SExx». " +
    "No toca SAP: escribe en un registro local.",
  access: "local",
  input: {
    need: z.string().min(5).describe("Qué hacía falta, en una frase"),
    workaround: z.string().optional().describe("Cómo se resolvió (transacción manual, SQL, otra tool…)"),
    system: z.string().optional(),
  },
  async run({ need, workaround, system }) {
    recordGap({ ts: new Date().toISOString(), need, workaround, system });
    return `Anotado en ${stateDir()}/gaps.jsonl.`;
  },
});

const closeGap = defineTool({
  name: "close_gap",
  title: "Cerrar un hueco anotado",
  description:
    "Marca como resuelto un hueco anotado con report_gap (porque ya hay una tool, o porque se comprobó que la anotación " +
    "era errónea), con una nota del porqué. No borra nada: el hueco sigue en el historial y usage_stats deja de " +
    "mostrarlo como pendiente. Se identifica por un fragmento de su texto.",
  access: "local",
  input: {
    match: z.string().min(5).describe("Fragmento del texto del hueco (sin distinguir mayúsculas)"),
    note: z.string().min(5).describe("Por qué queda resuelto: tool que lo cubre o qué se comprobó"),
    all: z.boolean().default(false).describe("Cerrar todos los que coincidan, si son varios"),
  },
  async run({ match, note, all }) {
    const closed = new Set(readJsonl<GapClosure>("gaps-closed.jsonl").map((c) => c.closes));
    const open = readJsonl<GapRecord>("gaps.jsonl").filter((g) => !closed.has(g.ts));
    const hits = open.filter((g) => g.need.toLowerCase().includes(match.toLowerCase()));
    if (!hits.length) throw new ToolError("NOT_FOUND", `Ningún hueco pendiente contiene «${match}».`);
    if (hits.length > 1 && !all) {
      throw new ToolError("INPUT", `«${match}» coincide con ${hits.length} huecos pendientes; afina el texto o usa all=true:\n` + hits.map((g) => `  • ${g.ts.slice(0, 10)} ${g.need.slice(0, 100)}`).join("\n"));
    }
    const ts = new Date().toISOString();
    for (const g of hits) recordGapClosure({ ts, closes: g.ts, note });
    return `Cerrados ${hits.length}:\n` + hits.map((g) => `  ✓ ${g.ts.slice(0, 10)} ${g.need.slice(0, 100)}`).join("\n");
  },
});

const usageStats = defineTool({
  name: "usage_stats",
  title: "Uso de las tools y huecos",
  description:
    "Resumen del registro local: llamadas por tool, tasa de fallo y tipo de fallo, sistemas, y los huecos anotados con " +
    "report_gap agrupados. Úsala para decidir cuál es la siguiente tool que merece la pena construir.",
  access: "local",
  input: {
    days: z.number().int().min(1).max(365).default(30),
  },
  async run({ days }) {
    const since = Date.now() - days * 86400_000;
    const usage = readJsonl<UsageRecord>("usage.jsonl").filter((u) => Date.parse(u.ts) >= since);
    const closures = new Map(readJsonl<GapClosure>("gaps-closed.jsonl").map((c) => [c.closes, c]));
    const allGaps = readJsonl<GapRecord>("gaps.jsonl").filter((g) => Date.parse(g.ts) >= since);
    const gaps = allGaps.filter((g) => !closures.has(g.ts));
    const closedGaps = allGaps.filter((g) => closures.has(g.ts));
    const out: string[] = [`Últimos ${days} días: ${usage.length} llamadas, ${gaps.length} huecos pendientes${closedGaps.length ? ` (${closedGaps.length} cerrados)` : ""}.`];

    const byTool = new Map<string, UsageRecord[]>();
    for (const u of usage) byTool.set(u.tool, [...(byTool.get(u.tool) ?? []), u]);
    if (byTool.size) {
      // Resultado negativo (RESULT) ≠ fallo: «la sintaxis tiene errores» es la tool funcionando. Los registros antiguos
      // sin tipo y con isError son, por construcción del registro, resultados negativos.
      const negative = (r: UsageRecord) => !r.ok && (r.kind === "RESULT" || r.kind === undefined);
      out.push("", "tool\tllamadas\tfallos\tresultados negativos\tms medio\tfallos por tipo");
      for (const [tool, rs] of [...byTool].sort((a, b) => b[1].length - a[1].length)) {
        const fails = rs.filter((r) => !r.ok && !negative(r));
        const neg = rs.filter(negative).length;
        const kinds = new Map<string, number>();
        for (const f of fails) kinds.set(f.kind!, (kinds.get(f.kind!) ?? 0) + 1);
        const avg = Math.round(rs.reduce((a, r) => a + r.ms, 0) / rs.length);
        out.push(`${tool}\t${rs.length}\t${fails.length}\t${neg}\t${avg}\t${[...kinds].map(([k, n]) => `${k}:${n}`).join(" ")}`);
      }
      out.push("", "Resultados negativos = la tool funcionó y el resultado fue «no» (sintaxis con errores, tests en rojo, activación rechazada).");
    }
    if (gaps.length) {
      out.push("", "Huecos pendientes (más recientes primero):");
      for (const g of gaps.slice().reverse()) {
        out.push(`  • ${g.ts.slice(0, 10)}${g.system ? ` [${g.system}]` : ""} ${g.need}${g.workaround ? ` — rodeo: ${g.workaround}` : ""}`);
      }
    }
    if (closedGaps.length) {
      out.push("", "Huecos cerrados:");
      for (const g of closedGaps.slice().reverse()) out.push(`  ✓ ${g.ts.slice(0, 10)} ${g.need.slice(0, 90)} — ${closures.get(g.ts)!.note}`);
    }
    return out.join("\n");
  },
});

export default [reportGap, closeGap, usageStats];
