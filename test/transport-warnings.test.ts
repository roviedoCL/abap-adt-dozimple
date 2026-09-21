import { describe, expect, it } from "vitest";
import { transportWarnings } from "../src/core/transport.js";

/** E070/E07T falsos. */
const sap = (rows: Array<Record<string, string>>) =>
  ({
    query: async (sql: string) => {
      const ids = [...sql.matchAll(/'([^']+)'/g)].map((m) => m[1]);
      if (/FROM e07t/.test(sql)) return { values: [] };
      return { values: rows.filter((r) => ids.includes(r.TRKORR)) };
    },
  }) as any;
const row = (TRKORR: string, o: Partial<Record<string, string>> = {}) => ({ TRKORR, TRFUNCTION: "K", TRSTATUS: "D", TARSYSTEM: "QAS", AS4USER: "DEMO_USER", AS4DATE: "20260920", STRKORR: "", ...o });

describe("avisos de la orden antes de escribir", () => {
  it("orden propia, abierta y con destino: sin avisos", async () => {
    expect(await transportWarnings(sap([row("DEVK900123")]), "DEVK900123", "demo_user")).toEqual([]);
  });
  it("orden sin sistema destino: lo escrito no viaja", async () => {
    const w = await transportWarnings(sap([row("DEVK900123", { TARSYSTEM: "" })]), "DEVK900123", "DEMO_USER");
    expect(w.join(" ")).toMatch(/SIN SISTEMA DESTINO/);
  });
  it("orden de otra persona", async () => {
    const w = await transportWarnings(sap([row("DEVK900123", { AS4USER: "OTRA_PERSONA" })]), "DEVK900123", "DEMO_USER");
    expect(w.join(" ")).toMatch(/es de OTRA_PERSONA/);
  });
  it("tarea propia dentro de una orden ajena y sin destino: se avisan las dos cosas", async () => {
    const w = await transportWarnings(
      sap([row("DEVK900124", { TRFUNCTION: "S", TARSYSTEM: "", STRKORR: "DEVK900123" }), row("DEVK900123", { TARSYSTEM: "", AS4USER: "OTRA_PERSONA" })]),
      "DEVK900124",
      "DEMO_USER",
    );
    expect(w.join(" ")).toMatch(/SIN SISTEMA DESTINO: DEVK900123/);
    expect(w.join(" ")).toMatch(/DEVK900123 es de OTRA_PERSONA/);
  });
  it("orden liberada o inexistente", async () => {
    expect((await transportWarnings(sap([row("DEVK900123", { TRSTATUS: "R" })]), "DEVK900123", "DEMO_USER")).join(" ")).toMatch(/no está modificable/);
    expect(await transportWarnings(sap([]), "DEVK900999", "DEMO_USER")).toEqual(["DEVK900999 no existe en este sistema."]);
  });
});
