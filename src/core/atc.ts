import type { ADTClient } from "abap-adt-api";

export interface AtcFindingRef {
  n: number;
  objectName: string;
  objectType: string;
  objectUri: string;
  sourceUri: string;
  line: number;
  column: number;
  priority: number;
  checkTitle: string;
  messageTitle: string;
  docUri?: string;
  exempted: boolean;
}

export interface AtcRunOutcome {
  variant: string;
  scope: string;
  at: string;
  /** Totales por prioridad según SAP (incluye los que no caben en maxResults). */
  stats?: { p1: number; p2: number; p3: number };
  findings: AtcFindingRef[];
}

/** Último ATC por sistema, para que atc_quickfix pueda referirse a «el hallazgo 3». */
const lastRun = new Map<string, AtcRunOutcome>();
export const rememberRun = (systemId: string, r: AtcRunOutcome) => lastRun.set(systemId.toUpperCase(), r);
export const recallRun = (systemId: string) => lastRun.get(systemId.toUpperCase());

export async function defaultVariant(c: ADTClient): Promise<string> {
  const cust = await c.atcCustomizing();
  const v = cust.properties.find((p) => p.name === "systemCheckVariant")?.value;
  return typeof v === "string" && v ? v : "DEFAULT";
}

const xmlEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/**
 * Ejecución ATC sobre varios objetos a la vez. La librería solo admite una
 * URI; en NW 7.50 una orden no sirve como conjunto («No URI-Mapping defined
 * for URI»), así que se envían sus objetos en la misma ejecución.
 */
async function createMultiRun(c: ADTClient, worklistId: string, uris: string[], maxResults: number) {
  const refs = uris.map((u) => `<adtcore:objectReference adtcore:uri="${xmlEsc(u)}"/>`).join("");
  const body =
    `<?xml version="1.0" encoding="UTF-8"?><atc:run maximumVerdicts="${maxResults}" xmlns:atc="http://www.sap.com/adt/atc">` +
    `<objectSets xmlns:adtcore="http://www.sap.com/adt/core"><objectSet kind="inclusive"><adtcore:objectReferences>${refs}` +
    `</adtcore:objectReferences></objectSet></objectSets></atc:run>`;
  const r = await c.httpClient.request(`/sap/bc/adt/atc/runs?worklistId=${encodeURIComponent(worklistId)}`, {
    method: "POST",
    headers: { Accept: "application/xml", "Content-Type": "application/xml" },
    body,
  });
  const xml = String(r.body);
  const tag = (t: string) => new RegExp(`<(?:\\w+:)?${t}>([^<]*)</(?:\\w+:)?${t}>`).exec(xml)?.[1] ?? "";
  const infos = [...xml.matchAll(/<(?:\w+:)?info>([\s\S]*?)<\/(?:\w+:)?info>/g)].map((m) => ({
    type: /<(?:\w+:)?type>([^<]*)</.exec(m[1])?.[1] ?? "",
    description: /<(?:\w+:)?description>([^<]*)</.exec(m[1])?.[1] ?? "",
  }));
  return { id: tag("worklistId"), timestamp: new Date(tag("worklistTimestamp")).getTime() / 1000, infos };
}

/** Ejecuta ATC sobre una o varias URI (objeto, paquete, orden u objetos de una orden). */
export async function runAtc(c: ADTClient, uri: string | string[], variant: string, maxResults: number, includeExempted: boolean): Promise<AtcRunOutcome> {
  const worklistId = await c.atcCheckVariant(variant);
  const run = Array.isArray(uri) ? await createMultiRun(c, worklistId, uri, maxResults) : await c.createAtcRun(worklistId, uri, maxResults);
  const wl = await c.atcWorklists(run.id, run.timestamp, "99999999999999999999999999999999", includeExempted);
  const statsInfo = run.infos.find((i) => i.type === "FINDING_STATS")?.description;
  const [p1, p2, p3] = (statsInfo ?? "").split(",").map((x) => Number(x));
  const findings: AtcFindingRef[] = [];
  for (const o of wl.objects) {
    for (const f of o.findings) {
      findings.push({
        n: 0,
        objectName: o.name,
        objectType: o.type,
        objectUri: o.uri,
        sourceUri: f.location.uri.split("#")[0],
        line: f.location.range.start.line,
        column: f.location.range.start.column,
        priority: f.priority,
        checkTitle: f.checkTitle,
        messageTitle: f.messageTitle,
        docUri: f.link?.href,
        exempted: !!f.exemptionKind,
      });
    }
  }
  findings.sort((a, b) => a.priority - b.priority || a.objectName.localeCompare(b.objectName) || a.line - b.line);
  findings.forEach((f, i) => (f.n = i + 1));
  return {
    variant,
    scope: Array.isArray(uri) ? `${uri.length} objetos` : uri,
    at: new Date().toISOString(),
    stats: statsInfo && [p1, p2, p3].every(Number.isFinite) ? { p1, p2, p3 } : undefined,
    findings,
  };
}
