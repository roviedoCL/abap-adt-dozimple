/** Tope de caracteres de una respuesta: lo que pase se recorta avisando. */
export const MAX_CHARS = 80_000;

/**
 * Recorta por líneas y dice cuánto quedó fuera y cómo pedirlo. Nunca recorta
 * en silencio: un recorte sin aviso se lee como «el objeto termina aquí».
 */
export function budget(text: string, max = MAX_CHARS, howToGetMore = ""): string {
  if (text.length <= max) return text;
  const lines = text.split("\n");
  let used = 0;
  let n = 0;
  while (n < lines.length && used + lines[n].length + 1 <= max) used += lines[n++].length + 1;
  return (
    lines.slice(0, n).join("\n") +
    `\n\n[… recortado: se muestran ${n} de ${lines.length} líneas.${howToGetMore ? " " + howToGetMore : ""}]`
  );
}

/** Tabla separada por tabuladores: compacta y fácil de leer para el modelo. */
export function tsv(columns: string[], rows: unknown[][]): string {
  const cell = (v: unknown) =>
    v === null || v === undefined ? "" : String(v).replace(/[\t\n\r]+/g, " ").trimEnd();
  return [columns.join("\t"), ...rows.map((r) => r.map(cell).join("\t"))].join("\n");
}

export function numbered(lines: string[], first = 1): string {
  const width = String(first + lines.length - 1).length;
  return lines.map((l, i) => `${String(first + i).padStart(width)}| ${l}`).join("\n");
}
