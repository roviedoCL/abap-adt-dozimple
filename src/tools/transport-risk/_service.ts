import https from "node:https";
import axios from "axios";
import { z } from "zod";
import type { SystemConfig } from "../../core/config.js";
import { tlsOptions } from "../../core/connection.js";
import { getPassword } from "../../core/credentials.js";
import { sanitizeMessage, ToolError } from "../../core/errors.js";
import type { ToolResult } from "../../core/tool.js";

/**
 * DoZimple Transport Risk: analizador de riesgo de transportes instalado en el
 * sistema de desarrollo del cliente (nodo ICF /sap/bc/zdz_risk, clase
 * ZDZ_CL_RISK_HTTP). Solo lectura; responde JSON también en error. Lo usan
 * todas las tools del módulo. El "_" inicial evita que se cargue como tool.
 */
export const RISK_MODULE = "dz-transport-risk";
export const RISK_SERVICE_PATH = "/sap/bc/zdz_risk";

/** SID del dominio de transporte (DEV = el propio sistema de desarrollo). */
export const sidParam = (what: string) =>
  z
    .string()
    .regex(/^[A-Za-z0-9]{3}$/, "SID de 3 caracteres")
    .transform((s) => s.toUpperCase())
    .describe(what);

/** El componente SAP no se distribuye con este repositorio. */
export const BACKEND_HINT =
  "Este módulo requiere el componente SAP de DoZimple Transport Risk (servicio /sap/bc/zdz_risk y RFC de solo " +
  "lectura en los sistemas destino), que no se incluye aquí. Para implantarlo: https://dozimple.cl";

export async function callRiskService(system: SystemConfig, params: Record<string, string | undefined>): Promise<ToolResult> {
  const clean: Record<string, string> = { "sap-client": system.client };
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") clean[k] = v;

  const response = await axios.get(system.url.replace(/\/$/, "") + RISK_SERVICE_PATH, {
    params: clean,
    auth: { username: system.user, password: await getPassword(system) },
    httpsAgent: tlsOptions(system).httpsAgent ?? new https.Agent(),
    timeout: 180_000,
    // Un servicio ICF de solo lectura no redirige: sin redirecciones, las credenciales Basic nunca viajan a otra URL
    // (sin depender de que una librería transitiva las quite al cambiar de host).
    maxRedirects: 0,
    // Tope de tamaño de la respuesta antes de procesarla (un sistema averiado no agota la memoria del proceso).
    maxContentLength: 50 * 1024 * 1024,
    // Los 4xx/5xx traen un JSON con la causa: se lee en vez de lanzar.
    validateStatus: () => true,
    responseType: "text",
    transformResponse: (d) => d,
  });

  const body = String(response.data ?? "");
  if (response.status === 401 || response.status === 403) {
    throw new ToolError("AUTH", `El servicio de riesgo rechazó las credenciales (HTTP ${response.status}).`);
  }
  let json: any;
  try {
    json = JSON.parse(body);
  } catch {
    // Nodo ICF inexistente o sesión caducada: ICF responde HTML con 200.
    return {
      text:
        `La respuesta no es JSON (HTTP ${response.status}): el nodo ${RISK_SERVICE_PATH} no existe o no está activo en ` +
        `SICF, o las credenciales no valen.\n${BACKEND_HINT}`,
      isError: true,
    };
  }
  if (response.status === 404) return { text: `El servicio ${RISK_SERVICE_PATH} no existe en este sistema.\n${BACKEND_HINT}`, isError: true };
  if (response.status !== 200) {
    const detail = json && typeof json === "object" && "error" in json ? String(json.error) : body;
    return { text: `El servicio de riesgo respondió HTTP ${response.status}: ${sanitizeMessage(detail, 300)}`, isError: true };
  }
  return body;
}
