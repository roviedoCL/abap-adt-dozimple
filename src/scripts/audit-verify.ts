import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { AUDIT_FILE, verifyAudit } from "../core/audit.js";
import { stateDir } from "../core/telemetry.js";

/** npm run audit:verify [ruta] — comprueba que el registro de auditoría no se ha retocado. */
const path = process.argv[2] ?? join(stateDir(), AUDIT_FILE);
if (!existsSync(path)) {
  console.log(`No hay registro de auditoría en ${path} (todavía no se ha escrito ni ejecutado nada en SAP).`);
  process.exit(0);
}
const v = verifyAudit(readFileSync(path, "utf8"));
if (v.ok) {
  console.log(`Registro íntegro: ${v.entries} entradas encadenadas (${path}).`);
} else {
  console.error(`REGISTRO ALTERADO en la entrada ${v.brokenAt} de ${v.entries}: ${v.reason} (${path}).`);
  process.exit(1);
}
