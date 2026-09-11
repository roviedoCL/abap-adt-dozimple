import { describe, expect, it } from "vitest";
import { diffLines, unified } from "../src/core/diff.js";

/** Reconstruye ambos lados desde las operaciones: prueba de que el diff es correcto. */
function sides(ops: NonNullable<ReturnType<typeof diffLines>>) {
  return {
    a: ops.filter((o) => o.op !== "+").map((o) => o.text).join("\n"),
    b: ops.filter((o) => o.op !== "-").map((o) => o.text).join("\n"),
  };
}

describe("diffLines", () => {
  it("textos iguales: sin cambios", () => {
    const ops = diffLines("a\nb\nc", "a\nb\nc")!;
    expect(ops.every((o) => o.op === " ")).toBe(true);
    expect(unified(ops).hunks).toBe(0);
  });

  it("reconstruye ambos lados en casos variados", () => {
    const cases: Array<[string, string]> = [
      ["", "x\ny"],
      ["x\ny", ""],
      ["a\nb\nc\nd", "a\nX\nc\nd"],
      ["a\nb\nc", "c\nb\na"],
      ["REPORT z.\nDATA a.\nWRITE a.", "REPORT z.\nDATA a TYPE i.\nDATA b.\nWRITE a.\nWRITE b."],
      [Array.from({ length: 200 }, (_, i) => `l${i}`).join("\n"), Array.from({ length: 200 }, (_, i) => (i % 7 ? `l${i}` : `m${i}`)).join("\n")],
    ];
    for (const [a, b] of cases) {
      const ops = diffLines(a, b)!;
      expect(sides(ops), JSON.stringify([a, b]).slice(0, 60)).toEqual({ a, b });
    }
  });

  it("es mínimo en un cambio de una línea", () => {
    const u = unified(diffLines("a\nb\nc\nd\ne", "a\nb\nC\nd\ne")!, 1);
    expect(u).toMatchObject({ added: 1, removed: 1, hunks: 1 });
    expect(u.text).toBe("@@ -2,3 +2,3 @@\n b\n-c\n+C\n d");
  });

  it("junta cambios cercanos en un solo bloque y separa los lejanos", () => {
    const a = Array.from({ length: 30 }, (_, i) => `l${i}`);
    const b = [...a];
    b[5] = "x";
    b[7] = "y";
    b[25] = "z";
    expect(unified(diffLines(a.join("\n"), b.join("\n"))!, 3).hunks).toBe(2);
  });

  it("si hay demasiados cambios lo dice en vez de colgarse", () => {
    const a = Array.from({ length: 500 }, (_, i) => `a${i}`).join("\n");
    const b = Array.from({ length: 500 }, (_, i) => `b${i}`).join("\n");
    expect(diffLines(a, b, 100)).toBeUndefined();
  });
});
