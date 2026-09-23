import { z } from "zod";
import { describe, expect, it } from "vitest";
import notesTool, { IMPL_STATE, PROC_STATE } from "../src/tools/core/sap_notes.js";
import type { ToolDef } from "../src/core/tool.js";

/**
 * sap_notes: estado de notas SAP en el sistema, leído de CWBNTCUST / CWBNTHEAD / CWBNTSTXT. Los significados de
 * los códigos vienen de IF_SCWN_NA_CONSTANTS (verificados en un 7.50). Números de nota y datos ficticios.
 */
const def = notesTool as ToolDef<any>;
const out = z.object(def.output!);

const CUST = [
  { NUMM: 1000001, NTSTATUS: "A", PRSTATUS: "E", CWBUSER: "DEV_USER" },
  { NUMM: 1000002, NTSTATUS: "I", PRSTATUS: "U", CWBUSER: "DEV_USER" },
  { NUMM: 1000003, NTSTATUS: "N", PRSTATUS: " ", CWBUSER: "" },
];
const HEAD = [
  { NUMM: 1000001, VERSNO: 1, THEMK: "SD-BF" },
  { NUMM: 1000001, VERSNO: 3, THEMK: "SD-BF-PR" },
  { NUMM: 1000002, VERSNO: 2, THEMK: "MM-PUR" },
  { NUMM: 1000003, VERSNO: 1, THEMK: "SD-BF" },
];
const TXT = [
  { NUMM: 1000001, VERSNO: 3, LANGU: "E", STEXT: "Title in English" },
  { NUMM: 1000001, VERSNO: 3, LANGU: "S", STEXT: "Título en español" },
  { NUMM: 1000001, VERSNO: 1, LANGU: "S", STEXT: "Título viejo" },
  { NUMM: 1000002, VERSNO: 2, LANGU: "E", STEXT: "Only English" },
];

const inList = (sql: string) => [...sql.matchAll(/'(\d+)'/g)].map((m) => Number(m[1]));
function ctx(cls: "test" | "prod" = "test") {
  const queries: string[] = [];
  const sap = {
    query: async (sql: string, rows: number) => {
      queries.push(sql);
      if (/COUNT\(\*\)/.test(sql)) return { values: [{ N: 1 }] };
      if (/FROM cwbntcust/.test(sql)) {
        const numIn = /numm IN \( ([^)]*) \)/.exec(sql)?.[1];
        const ids = numIn ? inList(numIn) : undefined;
        const st = /prstatus IN \( ([^)]*) \)/.exec(sql)?.[1];
        const want = st ? [...st.matchAll(/'([^']*)'/g)].map((m) => m[1]) : undefined;
        return { values: CUST.filter((c) => (!ids || ids.includes(c.NUMM)) && (!want || want.includes(c.PRSTATUS.trim()))).slice(0, rows) };
      }
      if (/SELECT DISTINCT numm FROM cwbnthead WHERE themk LIKE '([^']*)%'/.test(sql)) {
        const pre = /LIKE '([^']*)%'/.exec(sql)![1];
        return { values: [...new Set(HEAD.filter((h) => h.THEMK.startsWith(pre)).map((h) => h.NUMM))].map((n) => ({ NUMM: n })) };
      }
      if (/FROM cwbnthead/.test(sql)) return { values: HEAD.filter((h) => inList(sql).includes(h.NUMM)) };
      if (/FROM cwbntstxt/.test(sql)) return { values: TXT.filter((t) => inList(sql).includes(t.NUMM)) };
      return { values: [] };
    },
  };
  return { queries, ctx: { sap, system: { id: "DEV", role: cls === "test" ? "DEV" : "PRD", dataClass: cls } } as any };
}

describe("sap_notes", () => {
  it("por notas: estado, última versión, componente y título (español antes que inglés), y las no descargadas", async () => {
    const { ctx: x } = ctx();
    const r: any = await def.run({ notes: ["1000001", "1000002", "9999999"], max: 100 }, x);
    const s = out.parse(r.structured);
    expect(s.notes[0]).toEqual({
      note: "1000001", downloaded: true, implementation: IMPL_STATE.E, implementation_code: "E", processing: PROC_STATE.A,
      version: 3, component: "SD-BF-PR", title: "Título en español", processor: "DEV_USER",
    });
    expect(s.notes[1]).toMatchObject({ implementation: "implementada de forma incompleta", processing: "en tratamiento", title: "Only English" });
    expect(s.notes[2]).toEqual({ note: "9999999", downloaded: false });
    expect(r.text).toMatch(/No descargadas en este sistema: 9999999\. Que no esté no significa que no aplique/);
  });

  it("un estado vacío es «sin determinar», nunca se inventa", async () => {
    const { ctx: x } = ctx();
    const r: any = await def.run({ notes: ["1000003"], max: 100 }, x);
    expect(r.structured.notes[0]).toMatchObject({ implementation: "sin determinar", processing: "nueva" });
  });

  it("filtra por estado de implementación y da el total real con COUNT", async () => {
    const { ctx: x, queries } = ctx();
    const r: any = await def.run({ implementation: ["U"], max: 100 }, x);
    expect(r.structured.notes.map((n: any) => n.note)).toEqual(["1000002"]);
    expect(queries.some((q) => /SELECT COUNT\(\*\) AS n FROM cwbntcust WHERE prstatus IN \( 'U' \)/.test(q))).toBe(true);
  });

  it("filtra por componente en la cabecera (prefijo) y combina con el estado", async () => {
    const { ctx: x } = ctx();
    const r: any = await def.run({ component: "sd-bf", max: 100 }, x);
    expect(r.structured.notes.map((n: any) => n.note)).toEqual(["1000003", "1000001"]);
    const both: any = await def.run({ component: "SD-BF", implementation: ["E"], max: 100 }, x);
    expect(both.structured.notes.map((n: any) => n.note)).toEqual(["1000001"]);
  });

  it("sin notas ni filtro es INPUT", async () => {
    const { ctx: x } = ctx();
    await expect(def.run({ max: 100 }, x)).rejects.toMatchObject({ kind: "INPUT" });
  });

  it("en sistemas con datos productivos no muestra quién trató la nota", async () => {
    const { ctx: x } = ctx("prod");
    const r: any = await def.run({ notes: ["1000001"], max: 100 }, x);
    expect(r.structured.notes[0].processor).toBeUndefined();
    expect(r.text).not.toMatch(/DEV_USER|tratada por/);
  });

  it("un número de nota que no son dígitos no llega a la consulta", () => {
    expect(z.object(def.input).safeParse({ notes: ["123' OR '1'='1"] }).success).toBe(false);
  });
});
