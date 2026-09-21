import { execFileSync } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";

/**
 * Clave HMAC del registro de auditoría, guardada en el almacén de secretos del sistema operativo (llavero de macOS
 * o Secret Service en Linux). Con ella, reescribir el registro exige además poder leer el llavero del usuario: un
 * proceso sin acceso al llavero (u otro usuario del equipo) ya no puede recalcular la cadena y que pase por buena.
 *
 * Formato guardado: «v1:<fecha ISO de creación>:<64 hex>». La fecha permite detectar que se QUITARON firmas:
 * toda entrada posterior a ella tiene que llevarla.
 *
 * ABAP_DZ_AUDIT_KEYSTORE: «os» (por defecto), «memory» (tests) o «none» (sin firma, se avisa).
 */
const SERVICE = "abap-adt-dozimple-audit";
const ACCOUNT = "hmac";

export interface AuditKey {
  created: string;
  key: Buffer;
}

let cached: AuditKey | null | undefined;
let memory: string | undefined;
let warned = false;

const parse = (v: string | undefined): AuditKey | null => {
  const m = /^v1:([^:]+(?::[^:]+)*?):([0-9a-f]{64})$/.exec((v ?? "").trim());
  return m ? { created: m[1], key: Buffer.from(m[2], "hex") } : null;
};

function readOs(): string | undefined {
  try {
    if (process.platform === "darwin") {
      return execFileSync("security", ["find-generic-password", "-s", SERVICE, "-a", ACCOUNT, "-w"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    }
    if (process.platform === "linux") {
      return execFileSync("secret-tool", ["lookup", "service", SERVICE, "account", ACCOUNT], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    }
  } catch {
    /* no existe todavía, o no hay almacén */
  }
  return undefined;
}

/** Guarda el valor sin pasarlo nunca como argumento de un proceso (visible en `ps`): siempre por stdin. */
function writeOs(value: string): boolean {
  try {
    if (process.platform === "darwin") {
      execFileSync("security", ["-i"], { input: `add-generic-password -U -s ${SERVICE} -a ${ACCOUNT} -w ${value}\n`, stdio: ["pipe", "ignore", "ignore"] });
      return parse(readOs())?.key.toString("hex") === value.split(":").pop();
    }
    if (process.platform === "linux") {
      execFileSync("secret-tool", ["store", `--label=${SERVICE}`, "service", SERVICE, "account", ACCOUNT], { input: value, stdio: ["pipe", "ignore", "ignore"] });
      return !!parse(readOs());
    }
  } catch {
    /* sin almacén disponible */
  }
  return false;
}

/**
 * La clave, creándola la primera vez si `create`. null = no hay almacén de secretos: el registro sigue encadenado
 * pero sin firma (y se avisa una vez por stderr).
 */
export function auditKey(create = true): AuditKey | null {
  if (cached !== undefined && (cached || !create)) return cached;
  const mode = process.env.ABAP_DZ_AUDIT_KEYSTORE ?? "os";
  if (mode === "none") return (cached = null);
  const read = () => (mode === "memory" ? memory : readOs());
  let k = parse(read());
  if (!k && create) {
    const value = `v1:${new Date().toISOString()}:${randomBytes(32).toString("hex")}`;
    if (mode === "memory") memory = value;
    else if (!writeOs(value)) {
      if (!warned) console.error("[abap-adt-doZimple] ⚠ Sin almacén de secretos: el registro de auditoría queda encadenado pero sin firma HMAC.");
      warned = true;
      return (cached = null);
    }
    k = parse(read());
  }
  return (cached = k);
}

/** Solo tests: olvida la clave en memoria (como si fuera otro equipo o se hubiera borrado). */
export function resetAuditKeyForTests(): void {
  cached = undefined;
  memory = undefined;
}

export const macOf = (key: Buffer, hash: string) => createHmac("sha256", key).update(hash).digest("hex");
