#!/usr/bin/env node
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { configPath, loadConfig } from "./core/config.js";
import { ConnectionPool } from "./core/connection.js";
import { registerPrompts } from "./core/prompts.js";
import { loadTools, registerAll } from "./core/registry.js";
import { SidecarPool } from "./core/sidecar.js";

// stdout es el canal MCP: cualquier log va a stderr.
const log = (...a: unknown[]) => console.error("[abap-adt-doZimple]", ...a);
const here = dirname(fileURLToPath(import.meta.url));

async function main() {
  const server = new McpServer({ name: "abap-adt-doZimple", version: "0.2.0" });

  let config;
  try {
    config = loadConfig();
  } catch (e) {
    // Sin configuración se arranca igual, con una sola tool que explica el
    // problema: así se ve en el cliente en vez de un servidor «caído».
    const msg = (e as Error).message;
    log(msg);
    server.registerTool(
      "sap_systems",
      { title: "Sistemas SAP", description: "Estado de la configuración de sistemas SAP." },
      async () => ({ content: [{ type: "text", text: `Configuración inválida (${configPath()}):\n${msg}` }], isError: true }),
    );
    await server.connect(new StdioServerTransport());
    return;
  }

  const defs = await loadTools(join(here, "tools"));
  const sidecars = new SidecarPool(config);
  const published = registerAll(server, defs, config, new ConnectionPool(), sidecars);
  // Los componentes auxiliares son procesos hijo: se cierran con el servidor.
  const shutdown = () => void sidecars.closeAll().finally(() => process.exit(0));
  process.stdin.on("close", shutdown);
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  const prompts = registerPrompts(server, config);
  log(`${published.length} tools y ${prompts.length} prompts para ${config.systems.map((s) => s.id).join(", ")}`);
  await server.connect(new StdioServerTransport());
}

main().catch((e) => {
  log("fallo al arrancar:", e);
  process.exit(1);
});
