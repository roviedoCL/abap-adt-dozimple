import { z } from "zod";
import { ToolError } from "../../core/errors.js";
import { resolveObject, TYPE_HELP } from "../../core/objects.js";
import { defineTool } from "../../core/tool.js";

const CONTRACTS: Record<string, string> = {
  c0: "C0 extensión",
  c1: "C1 uso interno (ABAP Cloud / key user)",
  c2: "C2 uso remoto",
  c3: "C3 contenido de configuración",
  c4: "C4 uso en ABAP-managed DB procedures",
};

/** Por contrato: estado y sucesores, del documento apiRelease de ADT. */
export function parseApiRelease(xml: string): Array<{ contract: string; state: string; successors: string[]; concept: string }> {
  const out: Array<{ contract: string; state: string; successors: string[]; concept: string }> = [];
  const parts = xml.split(/<atom:link [^>]*href="[^"]*\/(c\d)" rel="self"[^>]*\/>/);
  for (let i = 1; i < parts.length; i += 2) {
    const id = parts[i];
    const body = parts[i + 1] ?? "";
    const state = /<ars:status ars:state="([^"]+)" ars:stateDescription="([^"]*)"/.exec(body);
    const succ = /<ars:successors>([\s\S]*?)<\/ars:successors>/.exec(body)?.[1] ?? "";
    const successors = [...succ.matchAll(/adtcore:type="([^"]+)" adtcore:name="([^"]+)"/g)].map((m) => `${m[2]} (${m[1]})`);
    const concept = /<ars:successorConceptName>([^<]*)<\/ars:successorConceptName>/.exec(body)?.[1] ?? "";
    out.push({ contract: CONTRACTS[id] ?? id, state: state ? `${state[2]} (${state[1]})` : "?", successors, concept });
  }
  return out;
}

export default defineTool({
  name: "api_release_state",
  title: "¿Está liberada esta API? ¿Cuál es su sucesor?",
  description:
    "Estado de liberación de un objeto SAP (clase, FM/BAPI, tabla, CDS…) por contrato C0–C4 y su sucesor liberado, " +
    "leído del propio sistema. Clave en remediación ATC S/4: «VBUK no está liberada», «BAPI_X → I_SALESORDERTP». " +
    "Solo S/4 y releases con API Release State (no existe en ECC 7.50).",
  access: "read",
  requires: { adt: ["/sap/bc/adt/apireleases"] },
  input: {
    object_name: z.string().min(1),
    object_type: z.string().optional().describe(TYPE_HELP),
  },
  async run({ object_name, object_type }, { sap }) {
    const c = await sap.adt();
    const obj = await resolveObject(c, object_name, object_type);
    // La URI viene de SAP: se exige la forma de una URI ADT, sin «..», antes de meterla en otra ruta.
    if (!/^\/sap\/bc\/adt\/[A-Za-z0-9_$%/.-]+$/.test(obj.uri) || obj.uri.split("/").includes("..")) {
      throw new ToolError("INPUT", `URI de objeto inesperada: ${obj.uri}`);
    }
    const r = await c.httpClient.request(`/sap/bc/adt/apireleases/${encodeURIComponent(obj.uri)}`, {
      headers: { Accept: "application/vnd.sap.adt.apirelease.v10+xml" },
    });
    const contracts = parseApiRelease(String(r.body));
    if (!contracts.length) return `${obj.name} (${obj.type}): SAP no devuelve contratos de liberación para este objeto.`;
    const released = contracts.filter((k) => k.state.includes("(RELEASED)"));
    const successors = [...new Set(contracts.flatMap((k) => k.successors))];
    return [
      `${obj.name} (${obj.type})${obj.packageName ? ` · paquete ${obj.packageName}` : ""}`,
      released.length ? `Liberado para: ${released.map((k) => k.contract).join("; ")}` : "No liberado en ningún contrato.",
      successors.length ? `Sucesor(es) indicados por SAP: ${successors.join(", ")}` : "SAP no indica sucesor.",
      "",
      ...contracts.map((k) => `  ${k.contract}: ${k.state}${k.successors.length ? ` → ${k.successors.join(", ")}` : ""}${k.concept ? ` · concepto ${k.concept}` : ""}`),
    ].join("\n");
  },
});
