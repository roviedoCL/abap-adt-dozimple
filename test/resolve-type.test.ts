import { describe, expect, it } from "vitest";
import { withNotes } from "../src/core/notes.js";
import { compatibleType, resolveObject } from "../src/core/objects.js";

/** quickSearch falso: el sistema tiene exactamente estos objetos. */
const system = (objs: Array<[string, string]>) =>
  ({
    searchObject: async (q: string, type?: string) =>
      objs
        .filter(([n, t]) => n.startsWith(q.replace(/\*$/, "")) && (!type || t.startsWith(type)))
        .map(([n, t]) => ({ "adtcore:name": n, "adtcore:type": t, "adtcore:uri": `/sap/bc/adt/x/${n.toLowerCase()}` })),
  }) as any;

describe("resolución del tipo cuando la coincidencia es única", () => {
  it("PROG pedido, include en el sistema: se resuelve y queda anotado", async () => {
    const c = system([["ZDEMO_INCL01", "PROG/I"]]);
    const { result, notes } = await withNotes(() => resolveObject(c, "zdemo_incl01", "PROG"));
    expect(result.type).toBe("PROG/I");
    expect(notes).toEqual(["se pidió PROG ZDEMO_INCL01; en el sistema es PROG/I (include) y se usó ese."]);
  });

  it("TABL pedido, estructura en el sistema: se resuelve", async () => {
    const c = system([["ZDEMO_STRUC", "TABL/DS"]]);
    const { result, notes } = await withNotes(() => resolveObject(c, "ZDEMO_STRUC", "TABL"));
    expect(result.type).toBe("TABL/DS");
    expect(notes[0]).toMatch(/estructura/);
  });

  it("FUNC pedido con el nombre de un grupo: no se confunde, y dice dónde están sus módulos", async () => {
    const c = system([["ZDEMO_GROUP", "FUGR/F"]]);
    await expect(resolveObject(c, "ZDEMO_GROUP", "FUNC")).rejects.toThrow(/grupo de funciones.*no un módulo/);
  });

  it("con el tipo correcto no se añade ninguna nota", async () => {
    const c = system([["ZDEMO_REPORT", "PROG/P"]]);
    const { result, notes } = await withNotes(() => resolveObject(c, "ZDEMO_REPORT", "PROG"));
    expect(result.type).toBe("PROG/P");
    expect(notes).toEqual([]);
  });

  it("de otra familia no se resuelve: sigue siendo «no existe» con los parecidos", async () => {
    const c = system([["ZDEMO_X", "CLAS/OC"]]);
    await expect(resolveObject(c, "ZDEMO_X", "PROG")).rejects.toThrow(/No existe PROG ZDEMO_X.*Parecidos: ZDEMO_X \(CLAS\/OC\)/);
  });

  it("familias compatibles, excepto grupo ↔ módulo", () => {
    expect(compatibleType("PROG/P", "PROG/I")).toBe(true);
    expect(compatibleType("TABL/DT", "TABL/DS")).toBe(true);
    expect(compatibleType("FUGR/FF", "FUGR/F")).toBe(false);
    expect(compatibleType("PROG/P", "CLAS/OC")).toBe(false);
  });
});
