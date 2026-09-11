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

/** Ejecuta ATC sobre una URI (objeto, paquete u orden) y devuelve hallazgos numerados. */
export async function runAtc(c: ADTClient, uri: string, variant: string, maxResults: number, includeExempted: boolean): Promise<AtcRunOutcome> {
  const worklistId = await c.atcCheckVariant(variant);
  const run = await c.createAtcRun(worklistId, uri, maxResults);
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
    scope: uri,
    at: new Date().toISOString(),
    stats: statsInfo && [p1, p2, p3].every(Number.isFinite) ? { p1, p2, p3 } : undefined,
    findings,
  };
}
