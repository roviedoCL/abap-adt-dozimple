import { beforeEach, describe, expect, it, vi } from "vitest";

// runAtc falso: cada objeto tiene su propio hallazgo 1 con su propia documentación.
const runs: string[] = [];
vi.mock("../src/core/atc.js", async (orig) => {
  const real = await orig<typeof import("../src/core/atc.js")>();
  return {
    ...real,
    defaultVariant: async () => "DEMO_VARIANT",
    runAtc: async (_c: unknown, uri: string) => {
      const name = uri.split("/").pop()!.toUpperCase();
      runs.push(name);
      return {
        variant: "DEMO_VARIANT",
        scope: uri,
        at: new Date().toISOString(),
        findings: [{ n: 1, objectName: name, objectType: "PROG/P", objectUri: uri, sourceUri: uri, line: 10, column: 0,
          priority: 1, checkTitle: `Check de ${name}`, messageTitle: `Mensaje de ${name}`, docUri: `/doc/${name}`, exempted: false }],
      };
    },
  };
});

const { default: runAtcTool } = await import("../src/tools/core/run_atc.js");
const { default: quickfixTool } = await import("../src/tools/core/atc_quickfix.js");

const c = {
  searchObject: async (name: string) => [{ "adtcore:name": name, "adtcore:type": "PROG/P", "adtcore:uri": `/sap/bc/adt/programs/programs/${name.toLowerCase()}`, "adtcore:packageName": "$TMP" }],
  atcDocumentation: async (uri: string) => ({ body: `<p>Documentación ${uri}</p>` }),
};
let n = 0;
const ctx = () => ({ sap: { adt: async () => c, query: async () => ({ values: [] }) }, system: { id: `DEMO_${++n}` } }) as any;

describe("ATC recordado por objeto (regresión: explain devolvía el hallazgo de otro objeto)", () => {
  beforeEach(() => (runs.length = 0));

  it("explain=1 sobre dos objetos seguidos devuelve la documentación de cada uno", async () => {
    const x = ctx();
    await runAtcTool.run({ object_name: "ZDEMO_A", max_findings: 200, include_exempted: false }, x);
    await runAtcTool.run({ object_name: "ZDEMO_B", max_findings: 200, include_exempted: false }, x);
    const a = String(await runAtcTool.run({ object_name: "ZDEMO_A", explain: 1, max_findings: 200, include_exempted: false }, x));
    const b = String(await runAtcTool.run({ object_name: "ZDEMO_B", explain: 1, max_findings: 200, include_exempted: false }, x));
    expect(a).toMatch(/ATC de ZDEMO_A/);
    expect(a).toMatch(/Documentación \/doc\/ZDEMO_A/);
    expect(a).not.toMatch(/ZDEMO_B/);
    expect(b).toMatch(/Documentación \/doc\/ZDEMO_B/);
    expect(runs).toEqual(["ZDEMO_A", "ZDEMO_B"]); // explain no re-ejecuta lo ya analizado
  });

  it("explain sobre un objeto aún no analizado ejecuta SU ATC en vez de usar el del anterior", async () => {
    const x = ctx();
    await runAtcTool.run({ object_name: "ZDEMO_A", max_findings: 200, include_exempted: false }, x);
    const c2 = String(await runAtcTool.run({ object_name: "ZDEMO_C", explain: 1, max_findings: 200, include_exempted: false }, x));
    expect(c2).toMatch(/ATC de ZDEMO_C .*ejecutado ahora/);
    expect(c2).toMatch(/\/doc\/ZDEMO_C/);
    expect(runs).toEqual(["ZDEMO_A", "ZDEMO_C"]);
  });

  it("explain sin objeto usa el último ATC y dice de qué objeto es", async () => {
    const x = ctx();
    await runAtcTool.run({ object_name: "ZDEMO_A", max_findings: 200, include_exempted: false }, x);
    await runAtcTool.run({ object_name: "ZDEMO_B", max_findings: 200, include_exempted: false }, x);
    const last = String(await runAtcTool.run({ explain: 1, max_findings: 200, include_exempted: false }, x));
    expect(last).toMatch(/^ATC de ZDEMO_B/);
  });

  it("atc_quickfix(finding) con object_name exige el ATC de ESE objeto", async () => {
    const x = ctx();
    await runAtcTool.run({ object_name: "ZDEMO_A", max_findings: 200, include_exempted: false }, x);
    await expect(quickfixTool.run({ finding: 1, object_name: "ZDEMO_B", return_source: false }, x)).rejects.toThrow(/No hay un run_atc de ZDEMO_B/);
  });

  it("los ATC de un sistema no se mezclan con los de otro", async () => {
    const x1 = ctx();
    const x2 = ctx();
    await runAtcTool.run({ object_name: "ZDEMO_A", max_findings: 200, include_exempted: false }, x1);
    await expect(runAtcTool.run({ explain: 1, max_findings: 200, include_exempted: false }, x2)).rejects.toThrow(/No hay un ATC previo/);
  });
});
