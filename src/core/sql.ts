/**
 * La vista previa de datos de ADT convierte el SQL en líneas de código ABAP, y
 * una línea ABAP no puede pasar de 255 caracteres: una consulta larga en una
 * sola línea falla con errores engañosos («A Boolean expression was expected
 * in JOBCOUNT»). Se parte en líneas cortas por espacios fuera de literales.
 */
export function wrapSql(sql: string, max = 200): string {
  const tokens: string[] = [];
  let cur = "";
  let inStr = false;
  for (const ch of sql.replace(/\s*\n\s*/g, " ")) {
    if (ch === "'") inStr = !inStr;
    if (ch === " " && !inStr) {
      if (cur) tokens.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur) tokens.push(cur);
  const lines: string[] = [];
  let line = "";
  for (const t of tokens) {
    if (line && line.length + 1 + t.length > max) {
      lines.push(line);
      line = t;
    } else line = line ? `${line} ${t}` : t;
  }
  if (line) lines.push(line);
  return lines.join("\n");
}

/**
 * abap-adt-api convierte las fechas SAP en objetos Date (medianoche UTC); al
 * mostrarlos en la zona local cambian de día. Se devuelven como AAAAMMDD, el
 * valor tal como está en SAP.
 */
export function normalizeValue(v: unknown): unknown {
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return "";
    const y = String(v.getUTCFullYear()).padStart(4, "0");
    const m = String(v.getUTCMonth() + 1).padStart(2, "0");
    const d = String(v.getUTCDate()).padStart(2, "0");
    return `${y}${m}${d}`;
  }
  return v;
}
