import { describe, expect, it } from "vitest";
import { applyEdits } from "../src/core/edits.js";
import { candidateColumns } from "../src/tools/core/atc_quickfix.js";

const at = (l1: number, c1: number, l2: number, c2: number, content: string) => ({
  range: { start: { line: l1, column: c1 }, end: { line: l2, column: c2 } },
  content,
});

describe("applyEdits", () => {
  const src = "REPORT z.\n  lv = 'Hola'.\nWRITE lv.";
  it("sustituye un rango dentro de una línea", () => {
    expect(applyEdits(src, [at(2, 7, 2, 13, "TEXT-001")])).toBe("REPORT z.\n  lv = TEXT-001.\nWRITE lv.");
  });
  it("inserta líneas y aplica varias ediciones sin desplazar offsets", () => {
    const out = applyEdits(src, [at(2, 7, 2, 13, "lc_hola"), at(2, 0, 2, 0, "  CONSTANTS lc_hola TYPE string VALUE 'Hola'.\n")]);
    expect(out).toBe("REPORT z.\n  CONSTANTS lc_hola TYPE string VALUE 'Hola'.\n  lv = lc_hola.\nWRITE lv.");
  });
  it("rechaza ediciones solapadas", () => {
    expect(() => applyEdits(src, [at(2, 2, 2, 10, "a"), at(2, 5, 2, 12, "b")])).toThrow(/solapadas/);
  });
});

describe("columnas candidatas para quickfix", () => {
  it("prueba primero la dada, luego el literal y los tokens", () => {
    const cols = candidateColumns("    cv_message = 'Error de ejemplo'.", 0);
    expect(cols[0]).toBe(18); // dentro del literal
    expect(cols).toContain(5); // cv_message
  });
  it("respeta la columna del hallazgo si viene", () => {
    expect(candidateColumns("SELECT * FROM mara.", 3)[0]).toBe(3);
  });
});
