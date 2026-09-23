import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeAll, describe, expect, it } from "vitest";
import { parseConfig } from "../src/core/config.js";
import { invoke, registerAll } from "../src/core/registry.js";
import type { ToolDef } from "../src/core/tool.js";

/**
 * Progreso y cancelación (sprint 2 del plan): una tool larga informa de su avance y respeta la cancelación del
 * cliente ENTRE pasos. Una llamada ADT en curso no se puede abortar: la cancelación llega al terminar el paso.
 */
beforeAll(() => {
  process.env.ABAP_DZ_STATE_DIR = mkdtempSync(join(tmpdir(), "abapdz-prog-"));
});

const cfg = parseConfig({ systems: [{ id: "DEV", role: "DEV", url: "https://sap.example:44300", client: "100", user: "U" }] });
const pool = { get: (s: any) => ({ system: s, missingCapabilities: async () => [], adt: async () => ({}), noteNetworkFailure() {}, resetReader() {} }) } as any;
const env = () => ({ config: cfg, pool, tools: [] });

async function connect(defs: ToolDef<any>[]) {
  const server = new McpServer({ name: "t", version: "1" });
  registerAll(server, defs, cfg, pool);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "c", version: "1" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

const tool = (run: ToolDef["run"], extra: Partial<ToolDef> = {}): ToolDef =>
  ({ name: "t_long", title: "T", description: "d".repeat(50), access: "read", input: {}, run, ...extra }) as ToolDef;

describe("progreso", () => {
  it("llega al cliente como notificaciones cuando la petición lo pide", async () => {
    const client = await connect([
      tool(async (_a, ctx) => {
        ctx.progress("Comparando 3 objetos…", 0, 3);
        ctx.progress("1 de 3", 1, 3);
        ctx.progress("3 de 3", 3, 3);
        return "listo";
      }),
    ]);
    const seen: Array<{ progress: number; total?: number; message?: string }> = [];
    const r = (await client.callTool({ name: "t_long", arguments: {} }, undefined, { onprogress: (p) => void seen.push(p) })) as any;
    expect(r.isError).toBe(false);
    expect(seen.map((p) => [p.progress, p.total, p.message])).toEqual([
      [0, 3, "Comparando 3 objetos…"],
      [1, 3, "1 de 3"],
      [3, 3, "3 de 3"],
    ]);
  });

  it("sin progressToken el progreso se ignora sin fallar", async () => {
    let calls = 0;
    const r = await invoke(
      tool(async (_a, ctx) => {
        ctx.progress("a", 1, 2);
        calls++;
        return "ok";
      }),
      {},
      env(),
    );
    expect(r.isError).toBe(false);
    expect(calls).toBe(1);
  });

  it("un fallo al notificar nunca rompe la tool", async () => {
    const r = await invoke(
      tool(async (_a, ctx) => {
        ctx.progress("x");
        return "ok";
      }),
      {},
      { ...env(), progress: () => { throw new Error("transporte caído"); } },
    );
    expect(r.isError).toBe(false);
    expect(r.text).toMatch(/ok/);
  });
});

describe("cancelación", () => {
  it("una petición cancelada a mitad termina como CANCELLED, no como fallo del servidor", async () => {
    const ac = new AbortController();
    const p = invoke(tool(() => new Promise(() => undefined)), {}, { ...env(), signal: ac.signal });
    setTimeout(() => ac.abort(), 20);
    const r = await p;
    expect(r.isError).toBe(true);
    expect(r.kind).toBe("CANCELLED");
    expect(r.text).toMatch(/Cancelado: t_long: cancelado por el cliente/);
  });

  it("una tool que comprueba la señal entre pasos deja de trabajar en el paso siguiente", async () => {
    const ac = new AbortController();
    const steps: string[] = [];
    const r = await invoke(
      tool(async (_a, ctx) => {
        steps.push("paso 1");
        ac.abort(); // el cliente cancela mientras corre el paso 1
        ctx.signal?.throwIfAborted();
        steps.push("paso 2");
        return "no debería llegar";
      }),
      {},
      { ...env(), signal: ac.signal },
    );
    expect(steps).toEqual(["paso 1"]);
    expect(r.kind).toBe("CANCELLED");
  });

  it("una señal ya cancelada no ejecuta nada", async () => {
    const ac = new AbortController();
    ac.abort();
    let ran = false;
    const r = await invoke(tool(async () => ((ran = true), "x")), {}, { ...env(), signal: ac.signal });
    expect(ran).toBe(false);
    expect(r.kind).toBe("CANCELLED");
  });

  it("la cancelación no cuenta como resultado negativo ni abre el circuito", async () => {
    const conn = { system: cfg.systems[0], missingCapabilities: async () => [], adt: async () => ({}), noteNetworkFailure: () => { throw new Error("no debería contarse"); }, resetReader() {} };
    const ac = new AbortController();
    ac.abort();
    const r = await invoke(tool(async () => "x"), {}, { ...env(), pool: { get: () => conn } as any, signal: ac.signal });
    expect(r.kind).toBe("CANCELLED");
  });
});
