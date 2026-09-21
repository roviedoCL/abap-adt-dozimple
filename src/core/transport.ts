import type { SapConnection } from "./connection.js";
import { sqlLiteral } from "./objects.js";

export const TRFUNCTION: Record<string, string> = {
  K: "orden workbench",
  W: "orden customizing",
  T: "transporte de copias",
  S: "tarea de desarrollo/corrección",
  R: "tarea de reparación",
  Q: "tarea de customizing",
  X: "tarea no clasificada",
  C: "reubicación",
};

export const TRSTATUS: Record<string, string> = {
  D: "modificable",
  L: "modificable, protegida",
  O: "liberación iniciada",
  R: "liberada",
  N: "liberada (protección de importación)",
};

export const isOpen = (trstatus: string) => trstatus === "D" || trstatus === "L";

export interface OrderHeader {
  trkorr: string;
  trfunction: string;
  trstatus: string;
  tarsystem: string;
  owner: string;
  date: string;
  parent: string;
  text: string;
}

const chunks = <T>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

/** Cabeceras E070 + texto E07T de un conjunto de órdenes/tareas. */
export async function orderHeaders(sap: SapConnection, trkorrs: string[]): Promise<Map<string, OrderHeader>> {
  const out = new Map<string, OrderHeader>();
  const uniq = [...new Set(trkorrs.filter(Boolean))];
  for (const part of chunks(uniq, 40)) {
    const inList = part.map(sqlLiteral).join(", ");
    const h = await sap.query(
      `SELECT trkorr, trfunction, trstatus, tarsystem, as4user, as4date, strkorr FROM e070 WHERE trkorr IN ( ${inList} )`,
      part.length,
    );
    const t = await sap.query(`SELECT trkorr, as4text FROM e07t WHERE trkorr IN ( ${inList} )`, part.length * 4);
    const texts = new Map<string, string>();
    for (const r of t.values) if (!texts.has(r.TRKORR)) texts.set(r.TRKORR, r.AS4TEXT);
    for (const r of h.values) {
      out.set(r.TRKORR, {
        trkorr: r.TRKORR,
        trfunction: r.TRFUNCTION,
        trstatus: r.TRSTATUS,
        tarsystem: r.TARSYSTEM,
        owner: r.AS4USER,
        date: r.AS4DATE,
        parent: r.STRKORR,
        text: texts.get(r.TRKORR) ?? "",
      });
    }
  }
  return out;
}

export function describeOrder(h: OrderHeader): string {
  return (
    `${h.trkorr} «${h.text}» · ${TRFUNCTION[h.trfunction] ?? h.trfunction} · ${TRSTATUS[h.trstatus] ?? h.trstatus} · ` +
    `${h.owner}` + (h.tarsystem ? ` · destino ${h.tarsystem}` : "")
  );
}

export interface LockInfo {
  CORRNR: string;
  CORRUSER: string;
  IS_LOCAL: string;
}

export type TransportDecision =
  | { ok: true; corrNr: string; note: string }
  | { ok: false; reason: string };

/**
 * Qué orden usar al guardar, a partir de lo que devuelve el bloqueo ADT.
 * Regla: nunca se elige una orden por el usuario. Si el objeto ya está
 * bloqueado en otra orden, SAP obliga a usar esa: se para y se explica.
 */
export function decideTransport(lock: LockInfo, requested: string | undefined, lockParent?: string): TransportDecision {
  const req = requested?.trim().toUpperCase() || undefined;
  if (lock.IS_LOCAL === "X" || lock.IS_LOCAL === "true") {
    return { ok: true, corrNr: "", note: "Objeto local: no se registra en ninguna orden." };
  }
  const held = lock.CORRNR?.trim();
  if (held) {
    const heldDesc = `${held}${lockParent && lockParent !== held ? ` (orden ${lockParent})` : ""}${lock.CORRUSER ? ` de ${lock.CORRUSER}` : ""}`;
    if (!req) {
      return {
        ok: false,
        reason: `El objeto ya está bloqueado en ${heldDesc}. Si es la orden correcta, repite con transport=${lockParent || held}.`,
      };
    }
    if (req === held || req === lockParent) {
      return { ok: true, corrNr: held, note: `Se guarda en ${heldDesc}.` };
    }
    return {
      ok: false,
      reason: `Pediste ${req}, pero el objeto está bloqueado en ${heldDesc}: SAP obliga a guardar ahí. No se escribió nada.`,
    };
  }
  if (!req) return { ok: false, reason: "El objeto no es local: indica transport (la orden donde debe ir el cambio)." };
  return { ok: true, corrNr: req, note: `Se guarda en ${req}.` };
}

/**
 * Lo que conviene saber de una orden ANTES de escribir en ella. Cada aviso corresponde a un daño real: una orden
 * sin sistema destino no viaja (lo guardado se queda en desarrollo) y una orden ajena mezcla el cambio con el
 * trabajo de otra persona. Si se da una tarea, se mira también su orden.
 */
export async function transportWarnings(sap: SapConnection, trkorr: string, myUser: string): Promise<string[]> {
  const heads = await orderHeaders(sap, [trkorr]);
  const h = heads.get(trkorr);
  if (!h) return [`${trkorr} no existe en este sistema.`];
  const order = h.parent ? (await orderHeaders(sap, [h.parent])).get(h.parent) ?? h : h;
  const out: string[] = [];
  const me = myUser.trim().toUpperCase();
  if (!isOpen(h.trstatus)) out.push(`${trkorr} no está modificable (${TRSTATUS[h.trstatus] ?? h.trstatus}).`);
  if (order !== h && !isOpen(order.trstatus)) out.push(`Su orden ${order.trkorr} no está modificable (${TRSTATUS[order.trstatus] ?? order.trstatus}).`);
  if (!order.tarsystem?.trim() && order.trfunction !== "T") {
    out.push(`SIN SISTEMA DESTINO: ${order.trkorr} no tiene destino de transporte; lo que se guarde en ella no viajará a calidad ni a productivo.`);
  }
  for (const x of order === h ? [h] : [h, order]) {
    if (x.owner && x.owner.trim().toUpperCase() !== me) out.push(`${x.trkorr} es de ${x.owner}, no del usuario de esta conexión: el cambio se mezclaría con su trabajo.`);
  }
  return out;
}
