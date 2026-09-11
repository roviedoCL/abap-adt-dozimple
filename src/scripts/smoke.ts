/**
 * Validación de extremo a extremo: arranca el servidor por stdio como lo haría
 * un cliente MCP, lista tools y prompts y, si se da un sistema, ejecuta SOLO
 * lecturas contra él y resume el resultado por tool.
 *
 *   npm run smoke                              → handshake, tools y prompts
 *   npm run smoke -- MI_DEV                    → batería de lecturas con objetos estándar de SAP
 *   SMOKE_TRANSPORT=DEVK900123 SMOKE_OBJECT=ZREPORTE npm run smoke -- MI_DEV
 *                                              → añade diff, ATC, correcciones y co-cambio sobre datos reales
 *
 * La orden y el objeto propios se pasan por entorno a propósito: nunca quedan en el repositorio.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const here = dirname(fileURLToPath(import.meta.url));
const system = process.argv[2];
const transport = process.env.SMOKE_TRANSPORT;
const object = process.env.SMOKE_OBJECT;

const client = new Client({ name: "smoke", version: "0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(here, "..", "index.js")], stderr: "ignore" }));

const { tools } = await client.listTools();
const { prompts } = await client.listPrompts();
console.log(`${tools.length} tools · ${prompts.length} prompts`);
if (!system) {
  console.log(tools.map((t) => t.name).join(", "));
  await client.close();
  process.exit(0);
}

const results: Array<{ tool: string; ms: number; ok: boolean; line: string }> = [];
async function call(tool: string, args: Record<string, unknown>, local = false) {
  if (!tools.some((t) => t.name === tool)) return results.push({ tool, ms: 0, ok: false, line: "no publicada en esta configuración" });
  const t0 = Date.now();
  const r = (await client.callTool({ name: tool, arguments: local ? args : { system, ...args } })) as any;
  const text: string = r.content?.[0]?.text ?? "";
  const first = text.split("\n").find((l) => l.trim() && !l.startsWith("Sistema:") && !l.startsWith("Contenido de documentación")) ?? "";
  results.push({ tool, ms: Date.now() - t0, ok: !r.isError, line: first.slice(0, 110) });
}

await call("sap_systems", { check: true, only: system }, true);
await call("search_objects", { query: "RSPARAM*", max_results: 3 });
await call("get_source", { object_name: "RSPARAM", object_type: "PROG", line_count: 5 });
await call("get_source", { object_name: "RFC_READ_TABLE", object_type: "FUNC", line_count: 5 });
await call("sql_query", { query: "SELECT mandt, mtext FROM t000", max_rows: 5 });
await call("table_contents", { table: "T000", columns: ["MANDT", "MTEXT"] });
await call("where_used", { object_name: "T000", object_type: "TABL", max_results: 3 });
await call("package_contents", { package: "SEUA_TRAN", max_objects: 10 });
await call("ddic_type_info", { name: "MANDT" });
await call("transaction_info", { tcode: "SE38" });
await call("syntax_check", { object_name: "RSPARAM", object_type: "PROG" });
await call("object_versions", { object_name: "RSPARAM", object_type: "PROG" });
await call("text_elements", { object_name: "RSPARAM", object_type: "PROG" });
await call("api_release_state", { object_name: "BAPI_SALESORDER_CREATEFROMDAT2", object_type: "FUNC" });
await call("dumps", { max: 3 });
await call("jobs", { max: 3 });
await call("application_log", { max: 3 });
await call("gateway_errors", { max: 3 });
await call("inactive_objects", {});
await call("abap_feature_matrix", { query: "COND", limit: 2 }, true);
await call("docs_search", { query: "inline declaration", k: 3 }, true);
await call("clean_core_objects", { query: "BAPI_SALESORDER", limit: 3 }, true);
await call("abap_lint", { code: "REPORT zdemo.\nDATA lv TYPE i.\nlv = 1.", version: "Standard" }, true);
if (transport) {
  await call("transport_contents", { transport, max_objects: 20 });
  await call("transport_diff", { transport, summary_only: true });
  await call("run_atc", { transport, priorities: [1, 2] });
  await call("atc_quickfix", { finding: 1 });
}
if (object) {
  await call("edit_preflight", { object_name: object });
  await call("co_change", { object_name: object, top: 5 });
}

const w = Math.max(...results.map((r) => r.tool.length));
for (const r of results) console.log(`${r.ok ? "✓" : "✗"} ${r.tool.padEnd(w)} ${String(r.ms).padStart(6)} ms  ${r.line}`);
const ok = results.filter((r) => r.ok).length;
console.log(`\n${ok}/${results.length} correctas`);
await client.close();
