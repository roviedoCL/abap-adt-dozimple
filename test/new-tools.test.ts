import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { recordGap } from "../src/core/telemetry.js";
import growth from "../src/tools/local/growth.js";
import functionModules from "../src/tools/core/function_modules.js";

const tool = (n: string) => (growth as any[]).find((t) => t.name === n);

describe("function_modules", () => {
  const sap = {
    query: async (sql: string) => {
      if (/FROM enlfdir WHERE funcname/.test(sql)) return { values: sql.includes("'ZDEMO_FM_A'") ? [{ AREA: "ZDEMO_GROUP" }] : [] };
      if (/FROM enlfdir AS e/.test(sql)) return { values: sql.includes("'ZDEMO_GROUP'") ? [{ FUNCNAME: "ZDEMO_FM_A", FMODE: "R" }, { FUNCNAME: "ZDEMO_FM_B", FMODE: "" }] : [] };
      if (/FROM tftit/.test(sql)) return { values: [{ FUNCNAME: "ZDEMO_FM_A", SPRAS: "S", STEXT: "Lee demo" }, { FUNCNAME: "ZDEMO_FM_A", SPRAS: "E", STEXT: "Reads demo" }] };
      if (/FROM tlibt/.test(sql)) return { values: [{ SPRAS: "S", AREAT: "Grupo demo" }] };
      if (/FROM tadir/.test(sql)) return { values: sql.includes("'ZDEMO_EMPTY'") ? [{ OBJ_NAME: "ZDEMO_EMPTY" }] : [] };
      return { values: [] };
    },
  };
  const ctx = { sap, system: { language: "ES" } } as any;

  it("lista los módulos del grupo con tipo y texto en el idioma de la conexión", async () => {
    const out = String(await functionModules.run({ group: "zdemo_group" }, ctx));
    expect(out).toMatch(/Grupo ZDEMO_GROUP «Grupo demo»: 2 módulos/);
    expect(out).toMatch(/ZDEMO_FM_A\tRFC\tLee demo/);
    expect(out).toMatch(/ZDEMO_FM_B\tnormal/);
  });
  it("sin texto en el idioma de la conexión prefiere inglés a cualquier otro", async () => {
    const s2 = { ...sap, query: async (q: string) => (/FROM tftit/.test(q) ? { values: [{ FUNCNAME: "ZDEMO_FM_A", SPRAS: "D", STEXT: "Demo DE" }, { FUNCNAME: "ZDEMO_FM_A", SPRAS: "E", STEXT: "Demo EN" }] } : sap.query(q)) };
    expect(String(await functionModules.run({ group: "ZDEMO_GROUP" }, { ...ctx, sap: s2 }))).toMatch(/ZDEMO_FM_A\tRFC\tDemo EN/);
  });

  it("desde un módulo encuentra su grupo", async () => {
    expect(String(await functionModules.run({ function: "ZDEMO_FM_A" }, ctx))).toMatch(/grupo de ZDEMO_FM_A/);
  });
  it("grupo inexistente, grupo vacío y nombres inválidos no se confunden", async () => {
    await expect(functionModules.run({ group: "ZDEMO_NONE" }, ctx)).rejects.toThrow(/No existe el grupo/);
    expect(String(await functionModules.run({ group: "ZDEMO_EMPTY" }, ctx))).toMatch(/no tiene módulos/);
    await expect(functionModules.run({ group: "X' OR '1'='1" }, ctx)).rejects.toThrow(/inválido/);
  });
});

describe("close_gap", () => {
  beforeEach(() => {
    process.env.ABAP_DZ_STATE_DIR = mkdtempSync(join(tmpdir(), "abapdz-gaps-"));
  });
  it("cierra un hueco sin borrarlo y usage_stats deja de mostrarlo como pendiente", async () => {
    recordGap({ ts: "2026-01-01T00:00:00.000Z", need: "Escribir la fuente de un módulo de demo" });
    recordGap({ ts: "2026-01-02T00:00:00.000Z", need: "Otra necesidad distinta de demo" });
    expect(await tool("close_gap").run({ match: "fuente de un módulo", note: "write_source lo cubre", all: false }, {})).toMatch(/Cerrados 1/);
    const stats = String(await tool("usage_stats").run({ days: 3650 }, {}));
    expect(stats).toMatch(/1 huecos pendientes \(1 cerrados\)/);
    expect(stats).toMatch(/✓ 2026-01-01 Escribir la fuente.*write_source lo cubre/);
  });
  it("si coincide con varios pide afinar, y sin coincidencias lo dice", async () => {
    recordGap({ ts: "2026-01-01T00:00:00.000Z", need: "demo uno" });
    recordGap({ ts: "2026-01-02T00:00:00.000Z", need: "demo dos" });
    await expect(tool("close_gap").run({ match: "demo ", note: "nota larga", all: false }, {})).rejects.toThrow(/coincide con 2/);
    await expect(tool("close_gap").run({ match: "no existe esto", note: "nota larga", all: false }, {})).rejects.toThrow(/Ningún hueco/);
  });
});
