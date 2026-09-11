import { describe, expect, it } from "vitest";
import { normalizeValue, wrapSql } from "../src/core/sql.js";

describe("wrapSql", () => {
  it("parte consultas largas en líneas de ≤200 caracteres", () => {
    const keys = Array.from({ length: 30 }, (_, i) => `( jobname = 'JOB_${i}' AND jobcount = '1330430${i % 10}' )`);
    const out = wrapSql(`SELECT * FROM tbtcp WHERE ${keys.join(" OR ")}`);
    expect(out.split("\n").every((l) => l.length <= 200)).toBe(true);
    expect(out.replace(/\n/g, " ")).toBe(`SELECT * FROM tbtcp WHERE ${keys.join(" OR ")}`);
  });
  it("nunca corta ni altera un literal con espacios", () => {
    const lit = `'${"a b ".repeat(20)}'`;
    const out = wrapSql(`SELECT * FROM t WHERE x = ${lit} AND ${"y = 1 AND ".repeat(30)}z = 2`);
    expect(out).toContain(lit);
  });
  it("deja igual una consulta corta", () => {
    expect(wrapSql("SELECT * FROM t000")).toBe("SELECT * FROM t000");
  });
});

describe("normalizeValue", () => {
  it("devuelve la fecha SAP (AAAAMMDD) sin desplazarla por zona horaria", () => {
    expect(normalizeValue(new Date(Date.UTC(2026, 8, 11)))).toBe("20260911");
    expect(normalizeValue(new Date(Date.UTC(9999, 11, 31)))).toBe("99991231");
  });
  it("no toca otros valores", () => {
    expect(normalizeValue("08000600")).toBe("08000600");
    expect(normalizeValue(4)).toBe(4);
  });
});
