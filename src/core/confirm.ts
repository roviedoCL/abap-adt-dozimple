import { createHash, randomBytes } from "node:crypto";

/**
 * Confirmación en dos fases de las escrituras cuando el cliente MCP no
 * soporta elicitación: la primera llamada devuelve la vista previa y un token
 * de un solo uso atado a tool + sistema + argumentos exactos. Si el modelo
 * cambia una coma de la fuente entre la vista previa y la escritura, el token
 * deja de valer y hay que volver a previsualizar.
 */
export const CONFIRM_TTL_MS = 10 * 60_000;

const pending = new Map<string, { digest: string; exp: number }>();

function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.keys(v as object)
        .sort()
        .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
        .map((k) => [k, canonical((v as Record<string, unknown>)[k])]),
    );
  }
  return v;
}

export function argsDigest(tool: string, system: string, args: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify([tool, system.toUpperCase(), canonical(args)])).digest("hex");
}

export function issueToken(tool: string, system: string, args: Record<string, unknown>, now = Date.now()): string {
  for (const [t, p] of pending) if (p.exp <= now) pending.delete(t);
  const token = randomBytes(16).toString("hex");
  pending.set(token, { digest: argsDigest(tool, system, args), exp: now + CONFIRM_TTL_MS });
  return token;
}

export type TokenCheck = "ok" | "unknown" | "expired" | "mismatch";

/** Consume el token: vale una sola vez, también cuando no coincide. */
export function consumeToken(
  token: string,
  tool: string,
  system: string,
  args: Record<string, unknown>,
  now = Date.now(),
): TokenCheck {
  const p = pending.get(token);
  if (!p) return "unknown";
  pending.delete(token);
  if (p.exp <= now) return "expired";
  return p.digest === argsDigest(tool, system, args) ? "ok" : "mismatch";
}
