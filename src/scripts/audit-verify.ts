import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { AUDIT_FILE, verifyAudit, type AuditEntry } from "../core/audit.js";
import { stateDir } from "../core/telemetry.js";

/**
 * npm run audit:verify [ruta] — comprueba que el registro de auditoría no se ha retocado y resume cómo se confirmó
 * cada escritura. La cadena de hashes detecta ediciones y borrados puntuales, pero quien tenga la cuenta del usuario
 * podría reescribirla entera: para evidencia fuerte, anota fuera del equipo el «último hash» que imprime este
 * comando (ticket, correo, repositorio) y compáralo en la siguiente revisión.
 */
const path = process.argv[2] ?? join(stateDir(), AUDIT_FILE);
if (!existsSync(path)) {
  console.log(`No hay registro de auditoría en ${path} (todavía no se ha escrito ni ejecutado nada en SAP).`);
  process.exit(0);
}
const text = readFileSync(path, "utf8");
const v = verifyAudit(text);
if (!v.ok) {
  console.error(`REGISTRO ALTERADO en la entrada ${v.brokenAt} de ${v.entries}: ${v.reason} (${path}).`);
  process.exit(1);
}
const entries = text.split("\n").filter(Boolean).map((l) => JSON.parse(l) as AuditEntry);
const writes = entries.filter((e) => e.phase === "intent" && e.access === "write");
const by = (k: string) => writes.filter((e) => e.confirmedBy === k).length;
const denied = entries.filter((e) => e.phase === "denied").length;
const last = entries.at(-1);
console.log(`Registro íntegro: ${v.entries} entradas encadenadas (${path}).`);
console.log(
  `Escrituras: ${writes.length} · confirmadas por elicitación (una persona respondió en el cliente): ${by("elicitation")} · ` +
    `por token (garantía de aviso: el cliente debe no autoaprobar): ${by("token")} · denegadas: ${denied}.`,
);
if (last) console.log(`Último hash (anótalo fuera del equipo para detectar una reescritura completa): ${last.hash} · seq ${last.seq} · ${last.ts}`);
