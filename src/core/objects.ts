import { ADTClient, type AbapClassStructure, type SearchResult } from "abap-adt-api";
import { ToolError } from "./errors.js";

/**
 * Tipos cortos que entiende la tool → tipo ADT (TADIR/WB). También se acepta
 * el tipo ADT tal cual (p. ej. "PROG/P").
 */
export const TYPE_MAP: Record<string, string> = {
  PROG: "PROG/P",
  INCL: "PROG/I",
  CLAS: "CLAS/OC",
  INTF: "INTF/OI",
  FUGR: "FUGR/F",
  FUNC: "FUGR/FF",
  DDLS: "DDLS/DF",
  DDLX: "DDLX/EX",
  DCLS: "DCLS/DL",
  TABL: "TABL/DT",
  STRU: "TABL/DS",
  VIEW: "VIEW/DV",
  DTEL: "DTEL/DE",
  DOMA: "DOMA/DD",
  TTYP: "TTYP/DA",
  MSAG: "MSAG/N",
  XSLT: "XSLT/VT",
  BDEF: "BDEF/BDO",
  SRVD: "SRVD/SRV",
  SRVB: "SRVB/SVB",
};

export const TYPE_HELP =
  "Tipo corto: " + Object.keys(TYPE_MAP).join(", ") + ". También vale el tipo ADT (p. ej. PROG/P).";

export function adtType(t?: string): string | undefined {
  if (!t) return undefined;
  const up = t.trim().toUpperCase();
  if (up.includes("/")) return up;
  const mapped = TYPE_MAP[up];
  if (!mapped) throw new ToolError("INPUT", `Tipo desconocido: ${t}. ${TYPE_HELP}`);
  return mapped;
}

export interface ResolvedObject {
  name: string;
  type: string;
  uri: string;
  packageName?: string;
  description?: string;
}

/**
 * Localiza un objeto por nombre exacto (y tipo si se da) vía quickSearch.
 * No adivina: si hay varios tipos con el mismo nombre y no se indicó tipo,
 * devuelve el listado para que se elija.
 */
export async function resolveObject(c: ADTClient, name: string, type?: string): Promise<ResolvedObject> {
  const wanted = name.trim().toUpperCase();
  const at = adtType(type);
  let hits: SearchResult[] = await c.searchObject(wanted, at, 50);
  // Algunos releases no filtran bien por tipo en quickSearch: se reintenta sin filtro.
  if (at && !hits.some((h) => h["adtcore:name"].toUpperCase() === wanted)) {
    hits = await c.searchObject(wanted, undefined, 100);
  }
  let exact = hits.filter((h) => h["adtcore:name"].toUpperCase() === wanted);
  if (at) exact = exact.filter((h) => h["adtcore:type"].toUpperCase().startsWith(at));
  if (exact.length === 0) {
    const near = hits.slice(0, 8).map((h) => `${h["adtcore:name"]} (${h["adtcore:type"]})`);
    throw new ToolError(
      "NOT_FOUND",
      `No existe ${type ? type.toUpperCase() + " " : ""}${wanted}.` + (near.length ? ` Parecidos: ${near.join(", ")}` : ""),
    );
  }
  if (exact.length > 1 && !at) {
    throw new ToolError(
      "INPUT",
      `${wanted} es ambiguo; indica object_type: ` + exact.map((h) => h["adtcore:type"]).join(", "),
    );
  }
  const h = exact[0];
  return {
    name: h["adtcore:name"],
    type: h["adtcore:type"],
    uri: h["adtcore:uri"],
    packageName: h["adtcore:packageName"],
    description: h["adtcore:description"],
  };
}

export const CLASS_INCLUDES = ["main", "definitions", "implementations", "macros", "testclasses"] as const;
export type ClassIncludeName = (typeof CLASS_INCLUDES)[number];

/** URL de la fuente del objeto (o del include de clase pedido). */
export async function sourceUrl(c: ADTClient, obj: ResolvedObject, include: ClassIncludeName = "main"): Promise<string> {
  if (obj.type.startsWith("CLAS")) {
    const st = (await c.objectStructure(obj.uri)) as AbapClassStructure;
    const url = ADTClient.classIncludes(st).get(include);
    if (!url) {
      const has = [...ADTClient.classIncludes(st).keys()].join(", ");
      throw new ToolError("NOT_FOUND", `La clase ${obj.name} no tiene include "${include}". Tiene: ${has}`);
    }
    return url;
  }
  if (include !== "main") throw new ToolError("INPUT", `"include" solo aplica a clases.`);
  if (ADTClient.isMainInclude(obj.uri)) return obj.uri;
  try {
    return ADTClient.mainInclude(await c.objectStructure(obj.uri));
  } catch {
    return `${obj.uri}/source/main`;
  }
}

/** Localiza por nombre exacto aceptando varios prefijos de tipo (p. ej. PROG/ = programa o include). */
export async function resolveByTypePrefix(c: ADTClient, name: string, prefixes: string[]): Promise<{ uri: string; type: string } | undefined> {
  const hits = await c.searchObject(name, undefined, 50);
  const h = hits.find((x) => x["adtcore:name"].toUpperCase() === name.toUpperCase() && prefixes.some((t) => x["adtcore:type"].startsWith(t)));
  return h ? { uri: h["adtcore:uri"], type: h["adtcore:type"] } : undefined;
}

/** Escapa un literal para ABAP SQL. */
export function sqlLiteral(v: string): string {
  return `'${v.replace(/'/g, "''")}'`;
}
