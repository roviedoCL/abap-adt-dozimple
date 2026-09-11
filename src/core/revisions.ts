import type { Revision } from "abap-adt-api";

/**
 * Selección de versiones para «qué cambió esta orden». Idea tomada de ARC-1
 * (MIT, src/adt/transport-diff.ts), reimplementada: el feed de versiones de
 * ADT trae, por versión, la orden o tarea que la grabó (Revision.version).
 */

/** 00000 = estado activo de trabajo, 99999 = borrador inactivo: nunca son línea base. */
const WORK_STATES = new Set(["00000", "99999"]);

export function versionNumber(r: Revision): string {
  return /\/versions\/[^/]*\/(\d{5})\//.exec(r.uri)?.[1] ?? "";
}

export type Evidence =
  | "exacta"             // hay versión grabada con esta orden (o una de sus tareas)
  | "aproximada"         // ninguna versión la nombra: se toma la última versión real
  | "sin_versiones";

export interface RevisionPair {
  current?: Revision;
  previous?: Revision;
  evidence: Evidence;
  /** true si current es un borrador inactivo (cambios guardados sin activar). */
  inactiveDraft: boolean;
}

/** En un empate de fecha, las versiones de trabajo son las más recientes: 99999 > 00000 > la mayor numerada. */
function rank(r: Revision): number {
  const v = versionNumber(r);
  if (v === "99999") return 2e6;
  if (v === "00000") return 1e6;
  return Number(v) || 0;
}

function newestFirst(revs: Revision[]): Revision[] {
  return revs
    .map((r, i) => ({ r, i, t: Date.parse(r.date) || -Infinity, n: rank(r) }))
    .sort((x, y) => (y.t - x.t) || (y.n - x.n) || (x.i - y.i))
    .map((e) => e.r);
}

export function selectRevisionPair(revs: Revision[], transportIds: Iterable<string>): RevisionPair {
  const sorted = newestFirst(revs);
  if (!sorted.length) return { evidence: "sin_versiones", inactiveDraft: false };
  const wanted = new Set([...transportIds].map((t) => t.trim().toUpperCase()).filter(Boolean));
  const inOrder = (r: Revision) => wanted.has((r.version ?? "").trim().toUpperCase());

  let idx = sorted.findIndex(inOrder);
  let evidence: Evidence = "exacta";
  if (idx === -1) {
    idx = sorted.findIndex((r) => !WORK_STATES.has(versionNumber(r)));
    evidence = "aproximada";
    if (idx === -1) idx = 0;
  }
  // La línea base es la primera versión anterior que no sea de trabajo ni de esta misma orden.
  let p = idx + 1;
  while (p < sorted.length && (WORK_STATES.has(versionNumber(sorted[p])) || inOrder(sorted[p]))) p++;
  return {
    current: sorted[idx],
    previous: sorted[p],
    evidence,
    inactiveDraft: versionNumber(sorted[idx]) === "99999",
  };
}

export interface SourceObjectRef {
  /** Nombre del objeto con fuente (programa/include, clase, interfaz, FM, CDS…). */
  name: string;
  /** Prefijos de tipo ADT aceptables al resolverlo. */
  types: string[];
  /** Entradas E071 que lo originan (p. ej. LIMU METH ZCL_X METODO). */
  from: string[];
}

export interface E071Row {
  PGMID: string;
  OBJECT: string;
  OBJ_NAME: string;
}

const DDIC = new Set(["TABL", "TABD", "TABT", "DTEL", "DTED", "DOMA", "DOMD", "TTYP", "TTYD", "VIEW", "VIED", "SHLP", "SHLD", "ENQU", "ENQD", "INDX", "XINX"]);

/**
 * Qué entradas de una orden tienen fuente comparable. El resto se lista
 * aparte (diccionario, customizing, otros) para no fingir que se revisó.
 */
export function sourceObjectsOf(rows: E071Row[]): { source: SourceObjectRef[]; ddic: string[]; other: string[] } {
  const map = new Map<string, SourceObjectRef>();
  const ddic = new Set<string>();
  const other = new Set<string>();
  const add = (name: string, types: string[], entry: string) => {
    const key = `${types[0]}:${name}`;
    const cur = map.get(key) ?? { name, types, from: [] };
    cur.from.push(entry);
    map.set(key, cur);
  };
  for (const r of rows) {
    const obj = r.OBJECT.trim();
    const raw = r.OBJ_NAME;
    const name = raw.trim();
    const entry = `${r.PGMID} ${obj} ${name}`;
    if (r.PGMID === "CORR" || (r.PGMID === "R3TR" && obj === "DEVC")) continue;
    if (obj === "PROG" || obj === "REPS") add(name, ["PROG/"], entry);
    else if (obj === "CLAS" || ["CLSD", "CPUB", "CPRO", "CPRI", "CINC", "METH", "CDEF"].includes(obj)) {
      // METH: nombre de clase en las 30 primeras posiciones; CINC: ZCL_X=====CCIMP.
      const cls = obj === "METH" ? raw.slice(0, 30).trim() : name.split("=")[0];
      add(cls, ["CLAS/"], entry);
    } else if (obj === "INTF") add(name, ["INTF/"], entry);
    else if (obj === "FUNC") add(name, ["FUGR/FF"], entry);
    else if (obj === "DDLS") add(name, ["DDLS/"], entry);
    else if (obj === "DCLS") add(name, ["DCLS/"], entry);
    else if (obj === "BDEF") add(name, ["BDEF/"], entry);
    else if (DDIC.has(obj)) ddic.add(`${obj} ${name}`);
    else other.add(`${r.PGMID} ${obj} ${name}`);
  }
  return { source: [...map.values()], ddic: [...ddic], other: [...other] };
}
