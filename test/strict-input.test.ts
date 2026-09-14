import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import { beforeAll, describe, expect, it } from "vitest";
import { parseConfig } from "../src/core/config.js";
import { registerAll } from "../src/core/registry.js";
import type { ToolDef } from "../src/core/tool.js";

beforeAll(() => {
  process.env.ABAP_DZ_STATE_DIR = mkdtempSync(join(tmpdir(), "abapdz-strict-"));
});

const cfg = parseConfig({ systems: [{ id: "DEV", role: "DEV", url: "https://sap.example:44300", client: "100", user: "U" }] });
const pool = { get: (s: any) => ({ system: s, missingCapabilities: async () => [], adt: async () => ({}) }) } as any;

async function connect(defs: ToolDef<any>[]) {
  const server = new McpServer({ name: "t", version: "1" });
  registerAll(server, defs, cfg, pool);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "c", version: "1" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

describe("parámetros desconocidos", () => {
  const calls: unknown[] = [];
  const read: ToolDef<any> = {
    name: "t_read", title: "T", description: "d".repeat(50), access: "read",
    input: { transport: z.string().optional(), max_rows: z.number().int().default(10) },
    run: async (a) => (calls.push(a), "ok"),
  };

  it("un parámetro mal escrito falla con la lista de admitidos y la tool no corre", async () => {
    const client = await connect([read]);
    const r = (await client.callTool({ name: "t_read", arguments: { transprot: "DEVK900123" } })) as any;
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/Parámetro desconocido para t_read.*Admitidos: transport, max_rows, system/s);
    expect(calls).toHaveLength(0);
  });

  it("los parámetros declarados siguen funcionando, con sus valores por defecto", async () => {
    const client = await connect([read]);
    const r = (await client.callTool({ name: "t_read", arguments: { transport: "DEVK900123", system: "DEV" } })) as any;
    expect(r.isError).toBeFalsy();
    expect(calls.at(-1)).toEqual({ transport: "DEVK900123", max_rows: 10 });
  });

  it("el schema publicado declara additionalProperties: false", async () => {
    const client = await connect([read]);
    const { tools } = await client.listTools();
    expect(tools[0].inputSchema).toMatchObject({ additionalProperties: false });
    expect(Object.keys(tools[0].inputSchema.properties ?? {})).toEqual(["transport", "max_rows", "system"]);
  });
});
