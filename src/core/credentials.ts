import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { SystemConfig } from "./config.js";
import { ToolError } from "./errors.js";

const run = promisify(execFile);

/** Servicio del llavero de macOS bajo el que se guardan las contraseñas. */
export const KEYCHAIN_SERVICE = "abap-adt-dozimple";

const cache = new Map<string, string>();

/**
 * Devuelve la contraseña del sistema. Nunca se escribe en logs ni en la
 * respuesta de una tool: solo viaja a la cabecera Basic de ADT.
 */
export async function getPassword(s: SystemConfig): Promise<string> {
  const hit = cache.get(s.id);
  if (hit) return hit;

  let pwd: string | undefined;
  if (s.password.startsWith("env:")) {
    pwd = process.env[s.password.slice(4)];
    if (!pwd) {
      throw new ToolError("AUTH", `La variable ${s.password.slice(4)} no está definida para el sistema ${s.id}.`);
    }
  } else {
    try {
      const { stdout } = await run("security", [
        "find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", s.id, "-w",
      ]);
      pwd = stdout.replace(/\n$/, "");
    } catch {
      throw new ToolError(
        "AUTH",
        `No hay contraseña para ${s.id} en el llavero. Guárdala con: scripts/set-password.sh ${s.id}`,
      );
    }
  }
  cache.set(s.id, pwd);
  return pwd;
}

/** Tras un 401 conviene olvidar la contraseña cacheada por si se cambió. */
export function forgetPassword(id: string): void {
  cache.delete(id);
}
