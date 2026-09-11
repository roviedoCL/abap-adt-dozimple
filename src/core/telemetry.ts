import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ErrorKind } from "./errors.js";

/**
 * Registro local de uso: qué tools se llaman, contra qué sistema, cuánto
 * tardan y cómo fallan. Nunca guarda argumentos (pueden llevar fuente o
 * datos de cliente). Es la materia prima para decidir la siguiente tool.
 */
export function stateDir(): string {
  return process.env.ABAP_DZ_STATE_DIR ?? join(homedir(), ".local", "state", "abap-adt-dozimple");
}

export interface UsageRecord {
  ts: string;
  tool: string;
  system?: string;
  ms: number;
  ok: boolean;
  kind?: ErrorKind;
}

export interface GapRecord {
  ts: string;
  need: string;
  workaround?: string;
  system?: string;
}

function append(file: string, rec: object): void {
  try {
    const dir = stateDir();
    // Privado del usuario: no lleva secretos, pero sí nombres de sistemas y huecos de trabajo.
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    appendFileSync(join(dir, file), JSON.stringify(rec) + "\n", { mode: 0o600 });
  } catch {
    /* el registro nunca debe romper una tool */
  }
}

export const recordUsage = (r: UsageRecord) => append("usage.jsonl", r);
export const recordGap = (r: GapRecord) => append("gaps.jsonl", r);

export function readJsonl<T>(file: string): T[] {
  const path = join(stateDir(), file);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((l) => {
      try {
        return [JSON.parse(l) as T];
      } catch {
        return [];
      }
    });
}
