import { z } from "zod";
import { ToolError } from "../../core/errors.js";
import { sqlLiteral } from "../../core/objects.js";
import { assertTrkorr } from "../../core/policy.js";
import { defineTool } from "../../core/tool.js";

/** Entradas que transportan datos o son de gestión: no dicen nada de acoplamiento de código. */
const NOISE = new Set(["TABU", "CDAT", "TDAT", "VDAT", "ACGR", "RELE", "COMM", "MERG", "ADIR", "DEVC", "NOTE"]);

export default defineTool({
  name: "co_change",
  title: "¿Con qué suele viajar este objeto?",
  description:
    "Mira las órdenes que tocaron un objeto y cuenta qué otros objetos viajaron con él, de más a menos frecuente. " +
    "Con transport, marca los compañeros habituales que NO van en esa orden: la pista de «te falta X en el pase». " +
    "Es estadística de E071, no dependencia técnica: confírmalo con where_used.",
  access: "read",
  input: {
    object_name: z.string().min(1).describe("Nombre como aparece en E071 (programa, clase, tabla…)"),
    transport: z.string().optional().describe("Orden a revisar contra los compañeros habituales"),
    last_orders: z.number().int().min(2).max(200).default(40),
    top: z.number().int().min(1).max(100).default(20),
  },
  async run({ object_name, transport, last_orders, top }, { sap }) {
    const name = object_name.trim().toUpperCase();
    // Órdenes (padre) que contienen el objeto, más recientes primero.
    const hits = await sap.query(
      `SELECT DISTINCT e071~trkorr, e070~strkorr, e070~as4date FROM e071 INNER JOIN e070 ON e070~trkorr = e071~trkorr ` +
        `WHERE e071~obj_name = ${sqlLiteral(name)} ORDER BY e070~as4date DESCENDING`,
      2000,
    );
    const orders = [...new Set(hits.values.map((v) => (v.STRKORR as string)?.trim() || (v.TRKORR as string)))]
      .filter((t) => /^[A-Z0-9]{3}K\d{6}$/.test(t))
      .slice(0, last_orders);
    if (!orders.length) throw new ToolError("NOT_FOUND", `${name} no aparece en ninguna orden de este sistema.`);

    const tasks = await sap.query(`SELECT trkorr, strkorr FROM e070 WHERE strkorr IN ( ${orders.map(sqlLiteral).join(", ")} )`, 5000);
    const parentOf = new Map<string, string>(orders.map((o) => [o, o]));
    for (const t of tasks.values) parentOf.set(t.TRKORR, t.STRKORR);
    const all = [...parentOf.keys()];
    const rows = await sap.query(
      `SELECT trkorr, object, obj_name FROM e071 WHERE trkorr IN ( ${all.map(sqlLiteral).join(", ")} ) AND pgmid <> 'CORR'`,
      5000,
    );

    const count = new Map<string, Set<string>>();
    for (const r of rows.values) {
      const obj = String(r.OBJECT).trim();
      const n = String(r.OBJ_NAME).trim();
      if (NOISE.has(obj) || n === name || n.startsWith(name + " ")) continue;
      const key = `${obj} ${obj === "METH" ? n.replace(/\s+/g, "->") : n}`;
      const order = parentOf.get(r.TRKORR) ?? r.TRKORR;
      if (!count.has(key)) count.set(key, new Set());
      count.get(key)!.add(order);
    }
    const ranked = [...count].map(([k, s]) => ({ k, n: s.size })).sort((a, b) => b.n - a.n).slice(0, top);

    let missing: string[] = [];
    let trInfo = "";
    if (transport) {
      const tr = assertTrkorr(transport);
      const trTasks = await sap.query(`SELECT trkorr FROM e070 WHERE strkorr = ${sqlLiteral(tr)}`, 500);
      const ids = [tr, ...trTasks.values.map((v) => v.TRKORR as string)];
      const inTr = await sap.query(`SELECT object, obj_name FROM e071 WHERE trkorr IN ( ${ids.map(sqlLiteral).join(", ")} )`, 5000);
      const present = new Set(inTr.values.map((v) => `${String(v.OBJECT).trim()} ${String(v.OBJ_NAME).trim()}`));
      const presentNames = new Set(inTr.values.map((v) => String(v.OBJ_NAME).trim()));
      // Frecuente = aparece en al menos la mitad de las órdenes del objeto.
      missing = ranked
        .filter((r) => r.n >= Math.max(2, Math.ceil(orders.length / 2)))
        .filter((r) => !present.has(r.k) && !presentNames.has(r.k.split(" ").slice(1).join(" ")))
        .map((r) => `${r.k} (${r.n}/${orders.length})`);
      trInfo = `\n\nContra ${tr}: ` + (missing.length ? `faltan compañeros habituales → ${missing.join(", ")}` : "no falta ninguno de los compañeros frecuentes.");
    }

    return (
      `${name} aparece en ${orders.length} órdenes (analizadas las ${Math.min(orders.length, last_orders)} más recientes).\n` +
      `Viajaron con él (objeto · nº de órdenes compartidas):\n` +
      ranked.map((r) => `  ${r.k} · ${r.n}`).join("\n") +
      (rows.values.length >= 5000 ? "\n(tope de 5000 filas de E071 alcanzado: reduce last_orders para un recuento completo)" : "") +
      trInfo
    );
  },
});
