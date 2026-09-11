import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { canWrite, resolveSystem, type Config, type SystemConfig, type SystemSource } from "./config.js";
import type { ConnectionPool, SapConnection } from "./connection.js";
import { normalizeError, renderError, ToolError, type ErrorKind } from "./errors.js";
import { budget } from "./output.js";
import { assertAccess } from "./policy.js";
import { recordUsage } from "./telemetry.js";
import type { SidecarPool } from "./sidecar.js";
import type { ToolContext, ToolDef, ToolEnv } from "./tool.js";

/**
 * Carga todas las tools de una carpeta (recursivo). Cada archivo exporta por
 * defecto una ToolDef o un array. Añadir una tool = añadir un archivo.
 * Se ignoran los que empiezan por "_" y los tests.
 */
export async function loadTools(dir: string): Promise<ToolDef<any>[]> {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d).sort()) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(js|ts)$/.test(f) && !f.endsWith(".d.ts") && !/\.test\./.test(f) && !f.startsWith("_")) files.push(p);
    }
  };
  walk(dir);
  const defs: ToolDef<any>[] = [];
  for (const f of files) {
    const mod = await import(pathToFileURL(f).href);
    const exp = mod.default;
    if (!exp) continue;
    defs.push(...(Array.isArray(exp) ? exp : [exp]));
  }
  const seen = new Set<string>();
  for (const d of defs) {
    if (seen.has(d.name)) throw new Error(`Tool duplicada: ${d.name}`);
    seen.add(d.name);
  }
  return defs;
}

/** ¿Tiene sentido publicar la tool con esta configuración? */
export function isVisible(def: ToolDef<any>, cfg: Config): boolean {
  const sc = def.requires?.sidecar;
  if (sc && !cfg.sidecars[sc]) return false;
  if (sc && def.requires?.online && !cfg.sidecars[sc].allowOnline) return false;
  if (def.requires?.module && !cfg.systems.some((s) => s.modules.includes(def.requires!.module!))) return false;
  if (def.access === "write" && !cfg.systems.some(canWrite)) return false;
  if (def.access === "exec" && !cfg.systems.some((s) => s.role === "DEV")) return false;
  return true;
}

/** Sistemas donde la tool puede correr (por política y módulo; la capacidad se mira al llamar). */
export function eligibleSystems(def: ToolDef<any>, cfg: Config): SystemConfig[] {
  return cfg.systems.filter((s) => {
    if (def.requires?.module && !s.modules.includes(def.requires.module)) return false;
    if (def.access === "write") return canWrite(s);
    if (def.access === "exec") return s.role === "DEV";
    return true;
  });
}

export interface CallOutcome {
  text: string;
  isError: boolean;
  kind?: ErrorKind;
  system?: string;
}

/**
 * Ejecuta una tool con todas las garantías del servidor: resolución de
 * sistema, módulo, política, capacidad, errores honestos, tope de tamaño y
 * registro de uso. Separado del SDK para poder probarlo sin MCP.
 */
export async function invoke(def: ToolDef<any>, rawArgs: Record<string, unknown>, env: ToolEnv): Promise<CallOutcome> {
  const t0 = Date.now();
  let systemId: string | undefined;
  let outcome: CallOutcome;
  let sapConn: SapConnection | undefined;
  let missing: string[] = [];
  try {
    const { system: requested, ...args } = rawArgs as { system?: string };
    let resolved: { system: SystemConfig; source: SystemSource } | undefined;
    let sap: SapConnection | undefined;

    if (def.access !== "local") {
      try {
        resolved = resolveSystem(env.config, requested);
      } catch (e) {
        throw new ToolError("INPUT", (e as Error).message);
      }
      systemId = resolved.system.id;
      const mod = def.requires?.module;
      if (mod && !resolved.system.modules.includes(mod)) {
        const where = eligibleSystems(def, env.config).map((s) => s.id).join(", ");
        throw new ToolError("MODULE", `${def.name} es del módulo "${mod}", no habilitado en ${systemId}. Disponible en: ${where}`);
      }
      assertAccess(def.access, resolved.system);
      sap = sapConn = env.pool.get(resolved.system);
      if (def.requires?.adt?.length) missing = await sap.missingCapabilities(def.requires.adt);
    }

    const ctx: ToolContext = {
      config: env.config,
      pool: env.pool,
      tools: env.tools,
      get system() {
        if (!resolved) throw new ToolError("INTERNAL", `${def.name} es local y no tiene sistema.`);
        return resolved.system;
      },
      get systemSource() {
        return resolved?.source ?? "por defecto";
      },
      get sap() {
        if (!sap) throw new ToolError("INTERNAL", `${def.name} es local y no tiene conexión.`);
        return sap;
      },
      sidecar(name: string) {
        if (!env.sidecars) throw new ToolError("INTERNAL", "No hay componentes auxiliares en este servidor.");
        return env.sidecars.get(name);
      },
    };

    const res = await def.run(args, ctx);
    const text = typeof res === "string" ? res : res.text;
    const isError = typeof res === "string" ? false : !!res.isError;
    const head = resolved ? `Sistema: ${resolved.system.id} (${resolved.source})\n\n` : "";
    outcome = { text: head + budget(text), isError, system: systemId };
  } catch (e) {
    let te = normalizeError(e, systemId);
    // Un 404 de SAP (no un «objeto no existe» nuestro) sobre un endpoint que el
    // discovery tampoco lista: ahora sí hay evidencia de que falta la función.
    if (te.kind === "NOT_FOUND" && !(e instanceof ToolError) && missing.length && sapConn) {
      te = await sapConn.capabilityError(missing).catch(() => te);
    }
    outcome = { text: renderError(te), isError: true, kind: te.kind, system: systemId };
  }
  recordUsage({
    ts: new Date().toISOString(),
    tool: def.name,
    system: outcome.system,
    ms: Date.now() - t0,
    ok: !outcome.isError,
    kind: outcome.kind,
  });
  return outcome;
}

function describe(def: ToolDef<any>, cfg: Config): string {
  const where = eligibleSystems(def, cfg).map((s) => s.id);
  const notes: string[] = [];
  if (def.access === "write") notes.push(`Escribe en SAP; solo en: ${where.join(", ")}.`);
  if (def.access === "exec") notes.push(`Ejecuta código; solo en: ${where.join(", ")}.`);
  if (def.requires?.module) notes.push(`Módulo ${def.requires.module}; solo en: ${where.join(", ")}.`);
  if (def.requires?.online) notes.push("Envía la consulta a internet: sin nombres Z, órdenes, sistemas ni clientes (el servidor lo bloquea).");
  return notes.length ? `${def.description}\n\n${notes.join(" ")}` : def.description;
}

export function registerAll(
  server: McpServer,
  defs: readonly ToolDef<any>[],
  config: Config,
  pool: ConnectionPool,
  sidecars?: SidecarPool,
): string[] {
  const published: string[] = [];
  const ids = config.systems.map((s) => s.id);
  const systemParam = z
    .string()
    .optional()
    .describe(
      `Sistema SAP: ${ids.join(", ")}.` + (config.defaultSystem ? ` Si se omite: ${config.defaultSystem}.` : ""),
    );

  for (const def of defs) {
    if (!isVisible(def, config)) continue;
    const inputSchema = def.access === "local" ? def.input : { ...def.input, system: systemParam };
    server.registerTool(
      def.name,
      {
        title: def.title,
        description: describe(def, config),
        inputSchema,
        annotations: {
          title: def.title,
          readOnlyHint: def.access === "read" || def.access === "local",
          destructiveHint: false,
          openWorldHint: def.access !== "local",
        },
      },
      (async (args: Record<string, unknown>) => {
        const r = await invoke(def, args ?? {}, { config, pool, tools: defs, sidecars });
        return { content: [{ type: "text" as const, text: r.text }], isError: r.isError };
      }) as any,
    );
    published.push(def.name);
  }
  return published;
}
