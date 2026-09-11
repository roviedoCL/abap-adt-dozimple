import { z } from "zod";
import { readJsonl, recordGap, stateDir, type GapRecord, type UsageRecord } from "../../core/telemetry.js";
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
    const gaps = readJsonl<GapRecord>("gaps.jsonl").filter((g) => Date.parse(g.ts) >= since);
    const out: string[] = [`Últimos ${days} días: ${usage.length} llamadas, ${gaps.length} huecos anotados.`];

    const byTool = new Map<string, UsageRecord[]>();
    for (const u of usage) byTool.set(u.tool, [...(byTool.get(u.tool) ?? []), u]);
    if (byTool.size) {
      out.push("", "tool\tllamadas\tfallos\tms medio\tfallos por tipo");
      for (const [tool, rs] of [...byTool].sort((a, b) => b[1].length - a[1].length)) {
        const fails = rs.filter((r) => !r.ok);
        const kinds = new Map<string, number>();
        for (const f of fails) kinds.set(f.kind ?? "?", (kinds.get(f.kind ?? "?") ?? 0) + 1);
        const avg = Math.round(rs.reduce((a, r) => a + r.ms, 0) / rs.length);
        out.push(`${tool}\t${rs.length}\t${fails.length}\t${avg}\t${[...kinds].map(([k, n]) => `${k}:${n}`).join(" ")}`);
      }
    }
    if (gaps.length) {
      out.push("", "Huecos (más recientes primero):");
      for (const g of gaps.slice().reverse()) {
        out.push(`  • ${g.ts.slice(0, 10)}${g.system ? ` [${g.system}]` : ""} ${g.need}${g.workaround ? ` — rodeo: ${g.workaround}` : ""}`);
      }
    }
    return out.join("\n");
  },
});

export default [reportGap, usageStats];
