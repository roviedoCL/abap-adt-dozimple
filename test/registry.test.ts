import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AdtErrorException } from "abap-adt-api";
import { beforeAll, describe, expect, it } from "vitest";
import { parseConfig } from "../src/core/config.js";
import { ToolError } from "../src/core/errors.js";
import { invoke, isVisible, loadTools } from "../src/core/registry.js";
import { readJsonl, type UsageRecord } from "../src/core/telemetry.js";
import type { ToolDef } from "../src/core/tool.js";

beforeAll(() => {
  process.env.ABAP_DZ_STATE_DIR = mkdtempSync(join(tmpdir(), "abapdz-"));
});

const base = { url: "https://sap.example:44300", client: "100", user: "U" };
const cfg = parseConfig({
  defaultSystem: "NS",
  systems: [
    { ...base, id: "A", role: "DEV", modules: ["dz-transport-risk"] },
    { ...base, id: "NS", role: "DEV" },
    { ...base, id: "PRD", role: "PRD" },
  ],
});

/** Pool falso: devuelve una conexión con el comportamiento que pida el test. */
function fakePool(conn: Partial<Record<string, any>> = {}) {
  return {
    get: (s: any) => ({
      system: s,
      missingCapabilities: async () => [],
      adt: async () => ({}),
      ...conn,
    }),
  } as any;
}

describe("carga de tools", () => {
  it("carga todas las tools del directorio, sin nombres repetidos", async () => {
    const defs = await loadTools(join(__dirname, "..", "src", "tools"));
    const names = defs.map((d) => d.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of ["search_objects", "get_source", "sql_query", "where_used", "transport_contents", "edit_preflight",
      "syntax_check", "write_source", "activate", "run_unit_tests", "object_versions", "dumps", "sap_systems",
      "report_gap", "usage_stats", "analyze_transport_risk", "table_contents", "package_contents", "ddic_type_info",
      "transaction_info", "import_health", "failure_ranking", "change_audit", "object_transport_history",
      "remote_source", "transport_source_check", "transport_diff", "run_atc", "atc_quickfix", "api_release_state",
      "gateway_errors", "co_change", "inactive_objects", "text_elements", "write_text_elements", "jobs", "application_log",
      "create_transport"]) {
      expect(names).toContain(n);
    }
    for (const d of defs) {
      expect(d.description.length, d.name).toBeGreaterThan(40);
      expect(["read", "exec", "write", "local"]).toContain(d.access);
    }
  });

  it("oculta escritura si ningún sistema la permite, y módulos que nadie habilita", async () => {
    const defs = await loadTools(join(__dirname, "..", "src", "tools"));
    const byName = (n: string) => defs.find((d) => d.name === n)!;
    expect(isVisible(byName("write_source"), cfg)).toBe(false);
    expect(isVisible(byName("analyze_transport_risk"), cfg)).toBe(true);
    const sinModulo = parseConfig({ systems: [{ ...base, id: "NS", role: "DEV", allowWrite: true }] });
    expect(isVisible(byName("analyze_transport_risk"), sinModulo)).toBe(false);
    expect(isVisible(byName("write_source"), sinModulo)).toBe(true);
  });
});

describe("invoke", () => {
  const read: ToolDef<any> = {
    name: "t_read", title: "t", description: "d", access: "read", input: {},
    run: async (_a, ctx) => `ok en ${ctx.system.id}`,
  };

  it("pone la cabecera de sistema y de dónde salió", async () => {
    const r = await invoke(read, {}, { config: cfg, pool: fakePool(), tools: [] });
    expect(r.isError).toBe(false);
    expect(r.text).toMatch(/^Sistema: NS \(por defecto\)\n\nok en NS/);
  });

  it("una tool de módulo en un sistema sin el módulo da MODULE y dice dónde sí está", async () => {
    const mod = { ...read, name: "t_mod", requires: { module: "dz-transport-risk" } };
    const r = await invoke(mod, { system: "NS" }, { config: cfg, pool: fakePool(), tools: [] });
    expect(r).toMatchObject({ isError: true, kind: "MODULE" });
    expect(r.text).toMatch(/Disponible en: A/);
  });

  it("escribir en PRD se bloquea antes de conectar", async () => {
    let connected = false;
    const w = { ...read, name: "t_w", access: "write" as const };
    const r = await invoke(w, { system: "PRD" }, {
      config: cfg,
      pool: { get: () => ((connected = true), {}) } as any,
      tools: [],
    });
    expect(r).toMatchObject({ isError: true, kind: "POLICY" });
    expect(connected).toBe(false);
  });

  // Caso real (S/4 2023): /runtime/dumps no figura en el discovery y funciona.
  const sinDiscovery = (extra = {}) =>
    fakePool({
      missingCapabilities: async () => ["/sap/bc/adt/runtime/dumps"],
      capabilityError: async (m: string[]) => new ToolError("CAPABILITY", `404 en ${m.join(", ")}`),
      ...extra,
    });
  const dumpsLike = { ...read, requires: { adt: ["/sap/bc/adt/runtime/dumps"] } };

  it("el discovery no veta: si el endpoint no figura pero funciona, es éxito", async () => {
    const r = await invoke({ ...dumpsLike, run: async () => "42 dumps" }, {}, { config: cfg, pool: sinDiscovery(), tools: [] });
    expect(r).toMatchObject({ isError: false });
    expect(r.text).toMatch(/42 dumps/);
  });

  it("404 de SAP sobre un endpoint ausente del discovery → CAPABILITY con evidencia", async () => {
    const t = { ...dumpsLike, run: async () => { throw new AdtErrorException(404, {}, "", "Not found"); } };
    const r = await invoke(t, {}, { config: cfg, pool: sinDiscovery(), tools: [] });
    expect(r).toMatchObject({ isError: true, kind: "CAPABILITY" });
    expect(r.text).toMatch(/404 en \/sap\/bc\/adt\/runtime\/dumps/);
  });

  it("un «objeto no existe» propio no se confunde con falta de capacidad", async () => {
    const t = { ...dumpsLike, run: async () => { throw new ToolError("NOT_FOUND", "No existe PROG ZFOO."); } };
    const r = await invoke(t, {}, { config: cfg, pool: sinDiscovery(), tools: [] });
    expect(r).toMatchObject({ isError: true, kind: "NOT_FOUND" });
  });

  it("una excepción nunca sale como éxito ni como vacío", async () => {
    const t = { ...read, run: async () => { throw Object.assign(new Error("x"), { code: "ETIMEDOUT" }); } };
    const r = await invoke(t, {}, { config: cfg, pool: fakePool(), tools: [] });
    expect(r).toMatchObject({ isError: true, kind: "NETWORK" });
  });

  it("registra el uso sin argumentos", async () => {
    await invoke(read, { secreto: "no-debe-guardarse" }, { config: cfg, pool: fakePool(), tools: [] });
    const recs = readJsonl<UsageRecord>("usage.jsonl");
    expect(recs.length).toBeGreaterThan(0);
    expect(JSON.stringify(recs)).not.toMatch(/no-debe-guardarse/);
    expect(recs.at(-1)).toMatchObject({ tool: "t_read", system: "NS", ok: true });
  });

  it("las tools locales no resuelven sistema", async () => {
    const local: ToolDef<any> = { name: "t_local", title: "t", description: "d", access: "local", input: {}, run: async () => "hecho" };
    const r = await invoke(local, {}, { config: cfg, pool: fakePool(), tools: [] });
    expect(r.text).toBe("hecho");
  });
});
