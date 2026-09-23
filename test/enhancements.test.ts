import { z } from "zod";
import { describe, expect, it } from "vitest";
import enh, { mainProgram } from "../src/tools/core/enhancements.js";
import type { ToolDef } from "../src/core/tool.js";

/** enhancements: BAdI (nuevas y clásicas), ampliaciones de código por programa y listado por prefijo. Datos ficticios. */
const def = enh as ToolDef<any>;
const out = z.object(def.output!);

function ctx(rows: Record<string, Array<Record<string, unknown>>>) {
  const queries: string[] = [];
  const sap = {
    query: async (sql: string) => {
      queries.push(sql);
      for (const [k, v] of Object.entries(rows)) if (new RegExp(k, "i").test(sql)) return { values: v };
      return { values: [] };
    },
  };
  return { queries, ctx: { sap, system: { id: "DEV", role: "DEV" } } as any };
}
const base = { program_type: "PROG", max: 200 };

describe("enhancements", () => {
  it("exige exactamente un modo", async () => {
    const { ctx: x } = ctx({});
    await expect(def.run({ ...base }, x)).rejects.toMatchObject({ kind: "INPUT" });
    await expect(def.run({ ...base, badi: "B", prefix: "Z" }, x)).rejects.toMatchObject({ kind: "INPUT" });
  });

  it("BAdI: nuevas y clásicas, la clásica migrada una sola vez, activas marcadas y las propias primero", async () => {
    const { ctx: x } = ctx({
      "FROM badiimpl_enh": [
        { ENHNAME: "ZDEMO_ENH", BADI_IMPL: "ZDEMO_IMPL", ACTIVE: "X", SPOTNAME: "DEMO_SPOT" },
        { ENHNAME: "SAP_ENH", BADI_IMPL: "SAP_IMPL", ACTIVE: "X", SPOTNAME: "DEMO_SPOT" },
      ],
      "FROM sxc_exit": [{ IMP_NAME: "ZDEMO_IMPL" }, { IMP_NAME: "ZDEMO_OLD" }, { IMP_NAME: "ADEMO_STD" }],
      "FROM sxc_attr": [{ IMP_NAME: "ZDEMO_OLD", ACTIVE: "" }, { IMP_NAME: "ADEMO_STD", ACTIVE: "X" }],
    });
    const r: any = await def.run({ ...base, badi: "demo_badi" }, x);
    const s = out.parse(r.structured);
    expect(s.rows.map((row) => `${row.implementation}:${row.kind}:${row.active}`)).toEqual([
      "ZDEMO_IMPL:nueva:true", "ZDEMO_OLD:clásica:false", "ADEMO_STD:clásica:true", "SAP_IMPL:nueva:true",
    ]);
    expect(r.text).toMatch(/BAdI DEMO_BADI: 4 implementaciones, 3 activas, 2 propias/);
  });

  it("BAdI sin implementaciones lo dice, nunca vacío", async () => {
    const { ctx: x } = ctx({});
    const r: any = await def.run({ ...base, badi: "NADA" }, x);
    expect(r.text).toMatch(/no tiene implementaciones en este sistema/);
    expect(r.structured.total).toBe(0);
  });

  it("programa: agrupa por ampliación, cuenta lugares y avisa de las que sustituyen código estándar", async () => {
    const { ctx: x, queries } = ctx({
      "FROM enhincinx": [
        { ENHNAME: "ZDEMO_A", VERSION: "A", ENHMODE: "D", OVERWRITE: "" },
        { ENHNAME: "ZDEMO_A", VERSION: "A", ENHMODE: "D", OVERWRITE: "" },
        { ENHNAME: "ZDEMO_B", VERSION: "I", ENHMODE: "S", OVERWRITE: "X" },
      ],
    });
    const r: any = await def.run({ ...base, program: "zcl_demo", program_type: "CLAS" }, x);
    expect(queries[0]).toMatch(/programname = 'ZCL_DEMO={22}CP'/);
    expect(out.parse(r.structured).rows).toEqual([
      { enhancement: "ZDEMO_A", mode: "dinámica", active: true, overwrite: false, places: 2 },
      { enhancement: "ZDEMO_B", mode: "estática", active: false, overwrite: true, places: 1 },
    ]);
    expect(r.text).toMatch(/1 SUSTITUYEN código estándar/);
    expect(r.text).toMatch(/ZDEMO_B\testática\tsolo inactiva\tSÍ/);
  });

  it("prefijo: total real por tipo con COUNT y listado acotado", async () => {
    const { ctx: x } = ctx({
      "COUNT": [{ ENHTOOLTYPE: "HOOK_IMPL", N: "5 " }, { ENHTOOLTYPE: "BADI_IMPL", N: "3 " }],
      "SELECT enhname, enhtooltype": [{ ENHNAME: "ZDEMO_1", ENHTOOLTYPE: "HOOK_IMPL" }],
    });
    const r: any = await def.run({ ...base, prefix: "z", max: 1 }, x);
    expect(out.parse(r.structured)).toMatchObject({ mode: "prefix", target: "Z", total: 8, truncated: true });
    expect(r.text).toMatch(/8 implementaciones .* \(se muestran 1\)\nHOOK_IMPL \(ampliación de código \(punto o sección\)\): 5 · BADI_IMPL \(implementación de BAdI\): 3/);
  });

  it("nombres con comillas no pasan el esquema", () => {
    expect(z.object(def.input).safeParse({ badi: "X' OR '1'='1" }).success).toBe(false);
  });

  it("programa principal por tipo, con namespace", () => {
    expect(mainProgram("sapf124", "PROG")).toBe("SAPF124");
    expect(mainProgram("ZCL_X", "CLAS")).toBe(`ZCL_X${"=".repeat(25)}CP`);
    expect(mainProgram("zgrp", "FUGR")).toBe("SAPLZGRP");
    expect(mainProgram("/DZ/GRP", "FUGR")).toBe("/DZ/SAPLGRP");
  });
});
