import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Config, SidecarConfig } from "./config.js";
import { ToolError } from "./errors.js";

const CALL_TIMEOUT_MS = 120_000;

/** Variables que el componente necesita para arrancar. Nada más: ni ABAP_DZ_*, ni tokens, ni proxies con credenciales. */
const SIDECAR_ENV_KEYS = ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "TERM", "USER", "LOGNAME", "SHELL", "SystemRoot"];

export function sidecarEnv(src: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const k of SIDECAR_ENV_KEYS) if (src[k]) env[k] = src[k]!;
  return env;
}

/**
 * Un MCP de terceros corriendo como proceso hijo. Aislado a propósito: sus
 * dependencias no se cargan en este proceso (que tiene las credenciales SAP),
 * y todo lo que publica pasa por la política de este servidor.
 */
export class Sidecar {
  private client?: Promise<Client>;

  constructor(
    readonly name: string,
    readonly cfg: SidecarConfig,
  ) {}

  private connect(): Promise<Client> {
    if (!this.client) {
      this.client = (async () => {
        const c = new Client({ name: `abap-adt-doZimple/${this.name}`, version: "1" });
        const transport = new StdioClientTransport({
          command: this.cfg.command,
          args: this.cfg.args,
          env: sidecarEnv(),
          // Su stdout es el canal MCP; su stderr se descarta (nunca a nuestro stdout).
          stderr: "ignore",
        });
        transport.onclose = () => (this.client = undefined);
        await c.connect(transport);
        return c;
      })();
      this.client.catch(() => (this.client = undefined));
    }
    return this.client;
  }

  async call(tool: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
    let c: Client;
    try {
      c = await this.connect();
    } catch (e) {
      throw new ToolError("INTERNAL", `No arranca el componente «${this.name}» (${this.cfg.command}): ${(e as Error).message}`);
    }
    const r = (await c.callTool({ name: tool, arguments: args }, undefined, { timeout: CALL_TIMEOUT_MS })) as {
      content?: Array<{ type: string; text?: string }>;
      isError?: boolean;
    };
    const text = (r.content ?? []).filter((x) => x.type === "text").map((x) => x.text ?? "").join("\n");
    return { text, isError: !!r.isError };
  }

  async close(): Promise<void> {
    const c = await this.client?.catch(() => undefined);
    await c?.close().catch(() => undefined);
    this.client = undefined;
  }
}

export class SidecarPool {
  private readonly pool = new Map<string, Sidecar>();

  constructor(private readonly config: Config) {}

  get(name: string): Sidecar {
    const cfg = this.config.sidecars[name];
    if (!cfg) throw new ToolError("MODULE", `El componente «${name}» no está configurado (sidecars.${name} en systems.json).`);
    let s = this.pool.get(name);
    if (!s) {
      s = new Sidecar(name, cfg);
      this.pool.set(name, s);
    }
    return s;
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.pool.values()].map((s) => s.close()));
  }
}
