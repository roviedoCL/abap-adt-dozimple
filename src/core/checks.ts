import type { ADTClient, SyntaxCheckResult } from "abap-adt-api";
import type { ResolvedObject } from "./objects.js";

/**
 * Chequeo de sintaxis de SAP (no abaplint) sobre un contenido dado, esté
 * guardado o no. Para includes se pasa el programa principal como contexto.
 */
export async function syntaxCheck(
  c: ADTClient,
  obj: ResolvedObject,
  srcUrl: string,
  content: string,
  mainProgram?: string,
): Promise<SyntaxCheckResult[]> {
  let context = mainProgram;
  if (!context && obj.type.startsWith("PROG/I")) {
    const mains = await c.mainPrograms(obj.uri).catch(() => []);
    context = mains[0]?.["adtcore:uri"];
  }
  return c.syntaxCheck(obj.uri, srcUrl, content, context ?? "");
}

export const isError = (m: SyntaxCheckResult) => ["E", "A", "X"].includes(m.severity?.toUpperCase());

export function renderSyntax(msgs: SyntaxCheckResult[]): string {
  return msgs
    .map((m) => `  ${m.severity} L${m.line}${m.offset ? `:${m.offset}` : ""}  ${m.text}${m.uri && !/source\/main$/.test(m.uri) ? `  [${m.uri}]` : ""}`)
    .join("\n");
}
