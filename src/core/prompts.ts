import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "./config.js";

/** Metadatos de los flujos: los usan el registro y la documentación generada. */
export const PROMPT_META = {
  revisar_pase: {
    title: "Revisar una orden antes del pase",
    description: "Revisión completa de una orden: código, compañeros ausentes, bloqueos y, con el módulo de riesgo, su análisis.",
    args: ["system", "transport"],
    chain: "transport_contents → transport_diff → inactive_objects → co_change + edit_preflight → analyze_transport_risk (si hay módulo) → informe en tres capas: negocio, consultor, Basis",
  },
  remediar_atc: {
    title: "Remediar hallazgos ATC de un objeto",
    description: "ATC → documentación y nota SAP → sucesor liberado → corrección → sintaxis → guardado con orden.",
    args: ["system", "object_name", "object_type?", "transport?"],
    chain: "edit_preflight → run_atc (BEFORE) → explain + api_release_state + where_used/object_versions → clasificación CAMBIAR/INVESTIGAR/NO_CAMBIAR → atc_quickfix → syntax_check → write_source con la orden (con OK humano) → run_atc (AFTER) y reducción de P1",
  },
  diagnosticar_ticket: {
    title: "Diagnosticar un incidente",
    description: "Dumps, jobs, log de aplicación y errores de Gateway alrededor de un incidente.",
    args: ["system", "hint", "date?"],
    chain: "dumps → jobs → application_log → gateway_errors → transaction_info / get_source / object_versions / transport_contents → causa probable con evidencia y lo que no se pudo comprobar",
  },
} as const;

/**
 * Flujos guiados (prompts MCP): aparecen como comandos en el cliente
 * (/mcp__abap-adt-doZimple__revisar_pase en Claude Code). Encadenan tools con
 * las reglas de trabajo ya aprendidas; no ejecutan nada por sí mismos.
 */
export function registerPrompts(server: McpServer, config: Config): string[] {
  const ids = config.systems.map((s) => s.id).join(", ");
  const sys = z.string().describe(`Sistema: ${ids}`);
  const msg = (text: string) => ({ messages: [{ role: "user" as const, content: { type: "text" as const, text } }] });

  server.registerPrompt(
    "revisar_pase",
    {
      title: PROMPT_META.revisar_pase.title,
      description: PROMPT_META.revisar_pase.description,
      argsSchema: { system: sys, transport: z.string().describe("Orden, p. ej. DEVK900123") },
    },
    ({ system, transport }) =>
      msg(
        `Revisa la orden ${transport} en ${system} antes de su pase. Solo lectura: no liberes ni modifiques nada.\n\n` +
          `1. transport_contents: cabecera, tareas abiertas y dueños.\n` +
          `2. transport_diff (summary_only primero; luego el diff de los objetos con más cambios): qué cambia de verdad. ` +
          `Señala código comentado de más, lógica de negocio tocada fuera del alcance, y cambios SIN ACTIVAR.\n` +
          `3. inactive_objects: lo que quede sin activar no viaja.\n` +
          `4. Para los 3 objetos principales: co_change con transport=${transport} (compañeros habituales ausentes) y ` +
          `edit_preflight (bloqueos TLOCK ajenos, reparaciones).\n` +
          `5. Si el sistema tiene el módulo dz-transport-risk: analyze_transport_risk (pregunta el destino si no está claro) ` +
          `y sigue el steering analisis-riesgo-transporte para redactar.\n\n` +
          `Informe en español, en tres capas: veredicto de negocio (sin ABAP), qué revisar (objeto, motivo, línea) y ` +
          `acciones de pase (tareas por liberar, órdenes a coordinar). No afirmes nada que no hayas visto en una tool.`,
      ),
  );

  server.registerPrompt(
    "remediar_atc",
    {
      title: PROMPT_META.remediar_atc.title,
      description: PROMPT_META.remediar_atc.description,
      argsSchema: {
        system: sys,
        object_name: z.string(),
        object_type: z.string().optional(),
        transport: z.string().optional().describe("Orden del ticket"),
      },
    },
    ({ system, object_name, object_type, transport }) =>
      msg(
        `Remedia los hallazgos ATC de ${object_name}${object_type ? ` (${object_type})` : ""} en ${system}` +
          `${transport ? `, en la orden ${transport}` : ""}.\n\n` +
          `Reglas: cambio mínimo, nunca lógica de negocio; primer criterio la nota SAP, ` +
          `luego los precedentes del proyecto; supresión solo como último recurso y justificada.\n\n` +
          `1. edit_preflight: si hay bloqueo ajeno o es reparación, PARA y avísame antes de nada.\n` +
          `2. run_atc (priorities [1,2] primero). Guarda el conteo P1/P2/P3 como BEFORE.\n` +
          `3. Por cada hallazgo: run_atc(explain=N) para la documentación y la nota; si menciona un objeto obsoleto, ` +
          `api_release_state para su sucesor; where_used y object_versions para precedentes.\n` +
          `4. Clasifica CAMBIAR / INVESTIGAR / NO_CAMBIAR y enséñame la tabla antes de tocar código.\n` +
          `5. Para los CAMBIAR: atc_quickfix(finding=N) si SAP ofrece corrección; si no, prepara el cambio a mano. ` +
          `Siempre syntax_check con la fuente completa propuesta.\n` +
          `6. Guardar solo con mi OK: write_source con transport explícito (o abap-fs si la escritura no está habilitada). ` +
          `Si una corrección crea símbolos de texto, write_text_elements.\n` +
          `7. run_atc de nuevo como AFTER y calcula la reducción de P1.`,
      ),
  );

  server.registerPrompt(
    "diagnosticar_ticket",
    {
      title: PROMPT_META.diagnosticar_ticket.title,
      description: PROMPT_META.diagnosticar_ticket.description,
      argsSchema: {
        system: sys,
        hint: z.string().describe("Qué falló: programa, transacción, job, usuario, servicio OData o nº de documento"),
        date: z.string().optional().describe("AAAA-MM-DD del incidente"),
      },
    },
    ({ system, hint, date }) =>
      msg(
        `Diagnostica el incidente «${hint}» en ${system}${date ? ` del ${date}` : ""}. Solo lectura.\n\n` +
          `1. dumps (filtra por usuario o por el programa/error con contains) y dumps(detail=N) del más relevante.\n` +
          `2. Si es un proceso de fondo: jobs (nombre con *, from_date) — estado y pasos.\n` +
          `3. application_log (objeto o nº externo) para errores registrados.\n` +
          `4. Si es una app Fiori/OData: gateway_errors y su detalle.\n` +
          `5. Si hay transacción: transaction_info → get_source del punto que falla; object_versions para ver si cambió ` +
          `hace poco y transport_contents de esa orden.\n\n` +
          `Cierra con: causa probable (con la evidencia de cada tool), qué no se pudo comprobar, y siguiente paso. ` +
          `Si algo solo se ve en SAP GUI (log de job, textos de SLG1), dilo y llama a report_gap.`,
      ),
  );

  return ["revisar_pase", "remediar_atc", "diagnosticar_ticket"];
}
