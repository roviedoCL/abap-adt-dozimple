import { isAdtError, isCsrfError, isHttpError } from "abap-adt-api";

/**
 * Tipos de fallo. La regla del servidor: un fallo NUNCA se convierte en un
 * resultado vacío ni en un «todo bien». Si no se pudo mirar, se dice.
 */
export type ErrorKind =
  | "NETWORK"     // no se llega al host (VPN, DNS, timeout)
  | "AUTH"        // credenciales o autorización
  | "NOT_FOUND"   // el objeto o endpoint no existe
  | "SAP"         // SAP respondió con un error de negocio
  | "POLICY"      // la política del servidor lo impide (escritura, PRD…)
  | "CAPABILITY"  // este release no expone el endpoint ADT necesario
  | "MODULE"      // tool de un cliente no habilitada en este sistema
  | "INPUT"       // parámetros inválidos
  | "INTERNAL";

export class ToolError extends Error {
  constructor(
    readonly kind: ErrorKind,
    message: string,
    readonly hint?: string,
  ) {
    super(message);
  }
}

const NETWORK_CODES = new Set([
  "ENETUNREACH", "EHOSTUNREACH", "ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT",
  "ECONNRESET", "EAI_AGAIN", "ECONNABORTED",
]);

function errCode(e: any): string | undefined {
  return e?.code ?? e?.parent?.code ?? e?.cause?.code ?? e?.parent?.cause?.code;
}

export function normalizeError(e: unknown, systemId?: string): ToolError {
  if (e instanceof ToolError) return e;
  const any = e as any;
  const code = errCode(any);

  if (code && NETWORK_CODES.has(code)) {
    return new ToolError(
      "NETWORK",
      `No se llega a ${systemId ?? "SAP"} (${code}).`,
      "¿Está levantada la VPN de ese cliente?",
    );
  }
  if (isCsrfError(e)) {
    return new ToolError("AUTH", `Sesión o token CSRF rechazado por ${systemId ?? "SAP"}: ${any.message}`);
  }
  if (isHttpError(e)) {
    const st = any.status;
    if (st === 401) return new ToolError("AUTH", `Usuario o contraseña rechazados por ${systemId ?? "SAP"} (401).`);
    if (st === 403) return new ToolError("AUTH", `Sin autorización (403): ${any.message}`);
    if (st === 404) return new ToolError("NOT_FOUND", `No encontrado (404): ${any.message}`);
    return new ToolError("SAP", `HTTP ${st ?? "?"}: ${any.message}`);
  }
  if (isAdtError(e)) {
    const st = any.err as number;
    const msg = any.localizedMessage || any.message || "sin mensaje";
    if (st === 401) return new ToolError("AUTH", `Usuario o contraseña rechazados (401): ${msg}`);
    if (st === 403) return new ToolError("AUTH", `Sin autorización (403): ${msg}`);
    if (st === 404) return new ToolError("NOT_FOUND", msg);
    return new ToolError("SAP", `${msg}${st ? ` (HTTP ${st})` : ""}`);
  }
  const message = any?.message ? String(any.message) : String(e);
  return new ToolError("INTERNAL", message || "Error sin mensaje");
}

export function renderError(te: ToolError): string {
  const labels: Record<ErrorKind, string> = {
    NETWORK: "Sin conexión",
    AUTH: "Autenticación/autorización",
    NOT_FOUND: "No encontrado",
    SAP: "Error de SAP",
    POLICY: "Bloqueado por política",
    CAPABILITY: "No disponible en este sistema",
    MODULE: "Módulo no habilitado",
    INPUT: "Parámetros inválidos",
    INTERNAL: "Error interno",
  };
  return `${labels[te.kind]}: ${te.message}${te.hint ? `\n${te.hint}` : ""}\n` +
    `(No se completó la operación: no interpretes esto como un resultado vacío.)`;
}
