import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { stateDir } from "./telemetry.js";

/**
 * Registro de auditoría de todo lo que modifica o ejecuta en SAP. Solo
 * añade líneas y cada una lleva el hash de la anterior: borrar o retocar una
 * entrada rompe la cadena y `npm run audit:verify` lo detecta.
 *
 * Nunca guarda fuente, textos ni datos: de los argumentos largos o
 * compuestos queda solo su huella (sha256 y tamaño), suficiente para probar
 * qué se escribió comparando con la versión en SAP.
 */
export const AUDIT_FILE = "audit.jsonl";
const GENESIS = "0".repeat(64);
const INLINE_MAX = 120;

export type AuditPhase = "intent" | "result" | "denied";

export interface AuditInput {
  phase: AuditPhase;
  tool: string;
  access: string;
  system: string;
  sapUser: string;
  client: string;
  args: Record<string, unknown>;
  confirmedBy?: "elicitation" | "token" | "not-required";
  ok?: boolean;
  kind?: string;
  reason?: string;
}

export interface AuditEntry extends Omit<AuditInput, "args"> {
  seq: number;
  ts: string;
  args: Record<string, unknown>;
  prev: string;
  hash: string;
}

/** E/S del registro, sustituible en tests para simular disco lleno o permisos. */
export const auditIo = { appendFileSync, existsSync, mkdirSync, readFileSync };

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Argumentos aptos para el registro: valores cortos tal cual, el resto como huella. */
export function auditArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (v === undefined) continue;
    if (typeof v === "string" && v.length > INLINE_MAX) {
      out[k] = { sha256: sha256(v), chars: v.length, lines: v.split("\n").length };
    } else if (v !== null && typeof v === "object") {
      const json = JSON.stringify(v);
      out[k] = { sha256: sha256(json), items: Array.isArray(v) ? v.length : Object.keys(v).length };
    } else {
      out[k] = v;
    }
  }
  return out;
}

function entryHash(e: Omit<AuditEntry, "hash">): string {
  return sha256(JSON.stringify(e));
}

function lastEntry(path: string): { seq: number; hash: string } {
  if (!auditIo.existsSync(path)) return { seq: 0, hash: GENESIS };
  const lines = auditIo.readFileSync(path, "utf8").trimEnd().split("\n").filter(Boolean);
  if (!lines.length) return { seq: 0, hash: GENESIS };
  const last = JSON.parse(lines[lines.length - 1]) as AuditEntry;
  return { seq: last.seq, hash: last.hash };
}

/**
 * Añade una entrada. Lanza si no puede escribir: quien llama decide no
 * seguir (una escritura sin rastro no se hace).
 */
export function appendAudit(input: AuditInput, dir = stateDir()): AuditEntry {
  auditIo.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, AUDIT_FILE);
  const prev = lastEntry(path);
  const base: Omit<AuditEntry, "hash"> = {
    seq: prev.seq + 1,
    ts: new Date().toISOString(),
    ...input,
    args: auditArgs(input.args),
    prev: prev.hash,
  };
  const entry: AuditEntry = { ...base, hash: entryHash(base) };
  auditIo.appendFileSync(path, JSON.stringify(entry) + "\n", { mode: 0o600 });
  return entry;
}

export interface AuditVerdict {
  ok: boolean;
  entries: number;
  brokenAt?: number;
  reason?: string;
}

/** Recorre la cadena completa: secuencia, enlace con la anterior y hash propio. */
export function verifyAudit(text: string): AuditVerdict {
  const lines = text.split("\n").filter(Boolean);
  let prev = GENESIS;
  for (let i = 0; i < lines.length; i++) {
    let e: AuditEntry;
    try {
      e = JSON.parse(lines[i]);
    } catch {
      return { ok: false, entries: lines.length, brokenAt: i + 1, reason: "línea que no es JSON" };
    }
    const { hash, ...rest } = e;
    if (e.seq !== i + 1) return { ok: false, entries: lines.length, brokenAt: i + 1, reason: `secuencia ${e.seq}, se esperaba ${i + 1}` };
    if (e.prev !== prev) return { ok: false, entries: lines.length, brokenAt: i + 1, reason: "no enlaza con la entrada anterior" };
    if (entryHash(rest) !== hash) return { ok: false, entries: lines.length, brokenAt: i + 1, reason: "contenido alterado" };
    prev = hash;
  }
  return { ok: true, entries: lines.length };
}
