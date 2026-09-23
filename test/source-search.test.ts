import { z } from "zod";
import { describe, expect, it } from "vitest";
import search, { groupNames } from "../src/tools/core/source_search.js";
import type { ToolDef } from "../src/core/tool.js";

/**
 * source_search: en NW 7.50 no hay endpoint ADT de búsqueda de texto (404), así que se leen las fuentes de un alcance
 * acotado y se busca aquí. Datos ficticios.
 */
const def = search as ToolDef<any>;
const out = z.object(def.output!);

const SOURCES: Record<string, string> = {
  "/sap/bc/adt/programs/programs/zdemo_rep/source/main": "REPORT zdemo_rep.\n* CALL FUNCTION 'RV_FLOW' comentado\nCALL FUNCTION 'RV_FLOW'.\n",
  "/sap/bc/adt/programs/includes/lzdemof01/source/main": "FORM x.\n  CALL FUNCTION 'rv_flow'.\nENDFORM.\n",
  "/sap/bc/adt/functions/groups/zdemo/fmodules/z_demo_fm/source/main": "FUNCTION z_demo_fm.\nENDFUNCTION.\n",
  "/c/main": "CLASS zcl_demo DEFINITION.\nENDCLASS.\nCLASS zcl_demo IMPLEMENTATION.\nENDCLASS.",
  "/c/impl": "  lcl_helper=>call( 'RV_FLOW' ).",
};
const TYPES: Record<string, { type: string; uri: string }> = {
  ZDEMO_REP: { type: "PROG/P", uri: "/sap/bc/adt/programs/programs/zdemo_rep" },
  LZDEMOF01: { type: "FUGR/I", uri: "/sap/bc/adt/programs/includes/lzdemof01" }, // así tipa ADT los includes de grupo
  Z_DEMO_FM: { type: "FUGR/FF", uri: "/sap/bc/adt/functions/groups/zdemo/fmodules/z_demo_fm" },
  ZCL_DEMO: { type: "CLAS/OC", uri: "/sap/bc/adt/oo/classes/zcl_demo" },
  ZROTO: { type: "PROG/P", uri: "/sap/bc/adt/programs/programs/zroto" },
};

function setup(opts: { tadir?: Array<[string, string]>; signal?: AbortSignal } = {}) {
  const queries: string[] = [];
  const tadir = opts.tadir ?? [["PROG", "ZDEMO_REP"], ["FUGR", "ZDEMO"], ["CLAS", "ZCL_DEMO"], ["TABL", "ZDEMO_T"]];
  const sap = {
    query: async (sql: string) => {
      queries.push(sql);
      if (/FROM tdevc WHERE parentcl/.test(sql)) return { values: [] };
      if (/FROM tadir/.test(sql)) return { values: tadir.map(([o, n]) => ({ DEVCLASS: "ZDEMO", PGMID: "R3TR", OBJECT: o, OBJ_NAME: n })) };
      if (/FROM tfdir/.test(sql)) return { values: [{ FUNCNAME: "Z_DEMO_FM" }] };
      if (/FROM trdir/.test(sql)) return { values: [{ NAME: "LZDEMOF01" }, { NAME: "LZDEMO$01" }] }; // el $ es generado: no se lee
      if (/FROM e070 WHERE strkorr/.test(sql)) return { values: [{ TRKORR: "DEVK900124" }] };
      if (/FROM e071/.test(sql)) return { values: [{ PGMID: "R3TR", OBJECT: "PROG", OBJ_NAME: "ZDEMO_REP" }] };
      return { values: [] };
    },
    adt: async () => ({
      searchObject: async (name: string) => {
        const t = TYPES[name];
        return t ? [{ "adtcore:name": name, "adtcore:type": t.type, "adtcore:uri": t.uri }] : [];
      },
      getObjectSource: async (url: string) => {
        if (url.includes("zroto")) throw Object.assign(new Error("sin autorización"), { typeID: undefined });
        return SOURCES[url] ?? Object.entries(SOURCES).find(([k]) => k.startsWith("/c/") && url.endsWith(k))?.[1] ?? "";
      },
      objectStructure: async () => ({
        objectUrl: "/sap/bc/adt/oo/classes/zcl_demo",
        metaData: {},
        links: [],
        includes: [
          { "class:includeType": "main", "abapsource:sourceUri": "/c/main", links: [{ href: "/c/main", rel: "http://www.sap.com/adt/relations/source", type: "text/plain" }] },
          { "class:includeType": "implementations", "abapsource:sourceUri": "/c/impl", links: [{ href: "/c/impl", rel: "http://www.sap.com/adt/relations/source", type: "text/plain" }] },
        ],
      }),
    }),
  };
  const progress: string[] = [];
  const ctx = { sap, system: { id: "DEV" }, signal: opts.signal, progress: (m: string) => progress.push(m) } as any;
  return { ctx, queries, progress };
}

const base = { regex: false, include_subpackages: true, ignore_comments: false, max_objects: 200, max_hits: 300 };

describe("source_search", () => {
  it("exige exactamente un alcance", async () => {
    const { ctx } = setup();
    await expect(def.run({ ...base, text: "RV_FLOW" }, ctx)).rejects.toMatchObject({ kind: "INPUT", message: expect.stringMatching(/exactamente un alcance/) });
    await expect(def.run({ ...base, text: "RV_FLOW", package: "ZDEMO", transport: "DEVK900123" }, ctx)).rejects.toMatchObject({ kind: "INPUT" });
  });

  it("en un paquete busca en programas, módulos e includes del grupo y clases con sus includes; no en tablas", async () => {
    const { ctx } = setup();
    const r: any = await def.run({ ...base, text: "rv_flow", package: "ZDEMO" }, ctx);
    const s = out.parse(r.structured);
    expect(s.hits.map((h) => `${h.object}/${h.include}:${h.line}`)).toEqual([
      "LZDEMOF01/main:2", "ZCL_DEMO/implementations:1", "ZDEMO_REP/main:2", "ZDEMO_REP/main:3",
    ]);
    expect(s).toMatchObject({ scope: "paquete ZDEMO", objects_in_scope: 4, scanned: 4, truncated: false, skipped: [] });
    expect(r.text).toMatch(/«rv_flow» en paquete ZDEMO: 4 coincidencias en 3 objetos · 4 de 4 objetos leídos/);
  });

  it("no lee objetos borrados (TADIR DELFLAG) ni includes generados con $", async () => {
    const { ctx, queries } = setup();
    const r: any = await def.run({ ...base, text: "rv_flow", package: "ZDEMO" }, ctx);
    expect(queries.find((q) => /FROM tadir/.test(q))).toMatch(/delflag = ' '/);
    expect(r.structured.skipped).toEqual([]);
    expect(r.structured.objects_in_scope).toBe(4);
  });

  it("ignore_comments descarta las líneas de comentario", async () => {
    const { ctx } = setup();
    const r: any = await def.run({ ...base, text: "RV_FLOW", package: "ZDEMO", ignore_comments: true }, ctx);
    expect(r.structured.hits.map((h: any) => `${h.object}:${h.line}`)).not.toContain("ZDEMO_REP:2");
  });

  it("regex válida busca; inválida o demasiado larga es INPUT", async () => {
    const { ctx } = setup();
    const r: any = await def.run({ ...base, text: "CALL FUNCTION 'RV_\\w+'", regex: true, package: "ZDEMO" }, ctx);
    expect(r.structured.hits.length).toBe(3);
    await expect(def.run({ ...base, text: "(sin cerrar", regex: true, package: "ZDEMO" }, ctx)).rejects.toMatchObject({ kind: "INPUT", message: expect.stringMatching(/Expresión regular inválida/) });
    await expect(def.run({ ...base, text: "x".repeat(201), package: "ZDEMO" }, ctx)).rejects.toMatchObject({ kind: "INPUT" });
  });

  it("tope de objetos: lo dice y marca truncated", async () => {
    const { ctx } = setup();
    const r: any = await def.run({ ...base, text: "RV_FLOW", package: "ZDEMO", max_objects: 1 }, ctx);
    expect(r.text).toMatch(/TOPE ALCANZADO: 3 objetos sin leer/);
    expect(r.structured.truncated).toBe(true);
  });

  it("un objeto ilegible se lista aparte con su motivo, nunca se omite en silencio", async () => {
    const { ctx } = setup();
    const r: any = await def.run({ ...base, text: "RV_FLOW", objects: ["ZDEMO_REP", "ZROTO", "ZNOEXISTE"] }, ctx);
    const s = out.parse(r.structured);
    expect(s.scanned).toBe(1);
    expect(s.skipped.map((x) => x.object)).toEqual(expect.arrayContaining(["ZROTO", "ZNOEXISTE"]));
    expect(r.text).toMatch(/No se pudieron leer \(2\)/);
  });

  it("una orden: usa sus entradas y las de sus tareas", async () => {
    const { ctx, queries } = setup();
    const orderCtx = { ...ctx, sap: { ...ctx.sap, query: async (sql: string) => (/FROM e070 WHERE trkorr/.test(sql) ? { values: [{ TRKORR: "DEVK900123", TRFUNCTION: "K", TRSTATUS: "D", AS4USER: "U", STRKORR: "" }] } : ctx.sap.query(sql)) } };
    const r: any = await def.run({ ...base, text: "RV_FLOW", transport: "DEVK900123" }, orderCtx);
    expect(r.structured.scope).toMatch(/orden DEVK900123/);
    expect(r.structured.hits.length).toBe(2);
    expect(queries.some((q) => /FROM e071 WHERE trkorr IN \( 'DEVK900123', 'DEVK900124' \)/.test(q))).toBe(true);
  });

  it("sin coincidencias lo dice: se leyó el código y no aparece", async () => {
    const { ctx } = setup();
    const r: any = await def.run({ ...base, text: "NO_EXISTE_ESTO", package: "ZDEMO" }, ctx);
    expect(r.text).toMatch(/Se leyó el código y no aparece/);
    expect(out.parse(r.structured).hits).toEqual([]);
  });

  it("informa del avance y respeta la cancelación entre objetos", async () => {
    const { ctx, progress } = setup();
    await def.run({ ...base, text: "RV_FLOW", package: "ZDEMO" }, ctx);
    expect(progress[0]).toMatch(/Leyendo 4 objetos/);
    expect(progress.at(-1)).toBe("4 de 4 objetos leídos");
    const ac = new AbortController();
    ac.abort();
    const { ctx: c2 } = setup({ signal: ac.signal });
    await expect(def.run({ ...base, text: "RV_FLOW", package: "ZDEMO" }, c2)).rejects.toMatchObject({ name: "AbortError" });
  });

  it("nombres del grupo con namespace", () => {
    expect(groupNames("zdemo")).toEqual({ main: "SAPLZDEMO", includePrefix: "LZDEMO" });
    expect(groupNames("/DZ/GRP")).toEqual({ main: "/DZ/SAPLGRP", includePrefix: "/DZ/LGRP" });
  });
});
