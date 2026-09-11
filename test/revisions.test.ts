import { describe, expect, it } from "vitest";
import type { Revision } from "abap-adt-api";
import { selectRevisionPair, sourceObjectsOf, versionNumber } from "../src/core/revisions.js";

const rev = (num: string, transport: string, date: string): Revision => ({
  uri: `/sap/bc/adt/programs/includes/z/source/main/versions/20211116222913/${num}/content`,
  version: transport,
  versionTitle: "",
  date,
  author: "U",
});

describe("selección de versiones", () => {
  it("caso real ZDEMO_MONITOR_F01: orden abierta, versión activa lleva la tarea", () => {
    const revs = [rev("00000", "DEVK900701", "2026-09-09T06:46:06Z"), rev("00001", "OLDK900001", "2021-11-16T22:29:13Z")];
    const p = selectRevisionPair(revs, ["DEVK900700", "DEVK900701"]);
    expect(p.evidence).toBe("exacta");
    expect(versionNumber(p.current!)).toBe("00000");
    expect(p.previous?.version).toBe("OLDK900001");
  });

  it("dos guardados en la misma orden: la base es anterior a la orden", () => {
    const revs = [
      rev("00003", "DEVK900701", "2026-09-10T10:00:00Z"),
      rev("00002", "DEVK900701", "2026-09-09T10:00:00Z"),
      rev("00001", "DEVK1", "2021-01-01T00:00:00Z"),
    ];
    const p = selectRevisionPair(revs, ["DEVK900700", "DEVK900701"]);
    expect(versionNumber(p.current!)).toBe("00003");
    expect(p.previous?.version).toBe("DEVK1");
  });

  it("empate de fecha: decide el número de versión (el feed no viene ordenado)", () => {
    const t = "2026-01-01T00:00:00Z";
    const p = selectRevisionPair([rev("00002", "A", t), rev("00000", "X", t), rev("00001", "B", t)], ["X"]);
    expect(p.previous?.version).toBe("A");
  });

  it("objeto nuevo: exacta sin versión anterior", () => {
    const p = selectRevisionPair([rev("00001", "DEVK1", "2026-01-01T00:00:00Z")], ["DEVK1"]);
    expect(p).toMatchObject({ evidence: "exacta", previous: undefined });
  });

  it("ninguna versión nombra la orden: aproximada, y nunca base una versión de trabajo", () => {
    const revs = [rev("00000", "", "2026-02-01T00:00:00Z"), rev("00002", "S1", "2026-01-01T00:00:00Z"), rev("00001", "S0", "2025-01-01T00:00:00Z")];
    const p = selectRevisionPair(revs, ["OTRA"]);
    expect(p.evidence).toBe("aproximada");
    expect(p.current?.version).toBe("S1");
    expect(p.previous?.version).toBe("S0");
  });

  it("borrador inactivo con la orden: se marca", () => {
    const p = selectRevisionPair([rev("99999", "DEVK1", "2026-03-01T00:00:00Z"), rev("00001", "S0", "2025-01-01T00:00:00Z")], ["DEVK1"]);
    expect(p.inactiveDraft).toBe(true);
  });
});

describe("objetos con fuente de una orden", () => {
  it("agrupa sub-objetos de clase, separa diccionario y customizing", () => {
    const r = sourceObjectsOf([
      { PGMID: "LIMU", OBJECT: "METH", OBJ_NAME: "ZCL_DEMO_VALOR".padEnd(30) + "GET_VALOR" },
      { PGMID: "LIMU", OBJECT: "CPRI", OBJ_NAME: "ZCL_DEMO_VALOR" },
      { PGMID: "LIMU", OBJECT: "CINC", OBJ_NAME: "ZCL_DEMO_VALOR==========CCIMP" },
      { PGMID: "LIMU", OBJECT: "REPS", OBJ_NAME: "ZDEMO_MONITOR_F01" },
      { PGMID: "LIMU", OBJECT: "FUNC", OBJ_NAME: "Z_DEMO_F4_EXIT" },
      { PGMID: "R3TR", OBJECT: "TABL", OBJ_NAME: "ZDEMO_TABLA" },
      { PGMID: "R3TR", OBJECT: "TABU", OBJ_NAME: "TVARVC" },
      { PGMID: "CORR", OBJECT: "RELE", OBJ_NAME: "X" },
    ]);
    expect(r.source.map((s) => s.name)).toEqual(["ZCL_DEMO_VALOR", "ZDEMO_MONITOR_F01", "Z_DEMO_F4_EXIT"]);
    expect(r.source[0].from).toHaveLength(3);
    expect(r.ddic).toEqual(["TABL ZDEMO_TABLA"]);
    expect(r.other).toEqual(["R3TR TABU TVARVC"]);
  });
});
