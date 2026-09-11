export interface TextEdit {
  range: { start: { line: number; column: number }; end: { line: number; column: number } };
  content: string;
}

/** Offset de (línea 1-based, columna 0-based) en el texto. */
function offsetOf(lines: string[], line: number, column: number): number {
  let off = 0;
  for (let i = 0; i < line - 1 && i < lines.length; i++) off += lines[i].length + 1;
  return off + Math.min(column, lines[line - 1]?.length ?? 0);
}

/**
 * Aplica ediciones ADT (quickfixes, refactorings) a un fuente, de atrás hacia
 * delante para que los offsets no se muevan. Lanza si dos ediciones se pisan.
 */
export function applyEdits(source: string, edits: TextEdit[]): string {
  const text = source.replace(/\r\n/g, "\n");
  const lines = text.split("\n");
  const spans = edits
    .map((e) => ({
      from: offsetOf(lines, e.range.start.line, e.range.start.column),
      to: offsetOf(lines, e.range.end.line, e.range.end.column),
      content: e.content ?? "",
    }))
    .sort((a, b) => b.from - a.from);
  for (let i = 1; i < spans.length; i++) {
    if (spans[i].to > spans[i - 1].from) throw new Error("Ediciones solapadas: SAP devolvió cambios incompatibles.");
  }
  let out = text;
  for (const s of spans) out = out.slice(0, s.from) + s.content + out.slice(s.to);
  return out;
}
