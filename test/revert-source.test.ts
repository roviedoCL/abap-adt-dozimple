import { describe, expect, it, vi } from "vitest";
import { stateOf } from "../src/core/confirm.js";
import type { ToolDef } from "../src/core/tool.js";

/**
 * revert_source: deshacer con confirmación, nunca automático. Vuelve a escribir una versión anterior (activa,
 * previa o una concreta) pasando por la misma vista previa, bloqueo, huella y orden que write_source.
 */
vi.mock("../src/core/checks.js", async (orig) => {
  const real = await orig<typeof import("../src/core/checks.js")>();
  return { ...real, syntaxCheck: async () => [] };
});

const { default: revert } = await import("../src/tools/core/revert_source.js");
const def = revert as ToolDef<any>;

const ACTIVE = "REPORT zdemo.\nWRITE 'activa'.\n";
const DRAFT = "REPORT zdemo.\nWRITE 'borrador roto'.\n";
const OLDER = "REPORT zdemo.\nWRITE 'anterior'.\n";
const base = "/sap/bc/adt/programs/programs/zdemo";

/** Historial como lo devuelve ADT: activa (00000), borrador inactivo (99999) y dos versiones grabadas. */
const revisions = (withDraft = true) => [
  { uri: `${base}/versions/x/00000/`, date: "2026-09-22T10:00:00Z", author: "DEV1", version: "", versionTitle: "activa" },
  ...(withDraft ? [{ uri: `${base}/versions/x/99999/`, date: "2026-09-22T11:00:00Z", author: "DEV1", version: "", versionTitle: "inactiva" }] : []),
  { uri: `${base}/versions/x/00002/`, date: "2026-09-20T10:00:00Z", author: "DEV2", version: "DEVK900123", versionTitle: "versión 2" },
  { uri: `${base}/versions/x/00001/`, date: "2026-09-10T10:00:00Z", author: "DEV2", version: "DEVK900100", versionTitle: "versión 1" },
];
const sourceByUri: Record<string, string> = {
  [`${base}/versions/x/00000/`]: ACTIVE,
  [`${base}/versions/x/99999/`]: DRAFT,
  [`${base}/versions/x/00002/`]: OLDER,
  [`${base}/versions/x/00001/`]: "REPORT zdemo.\n",
};

function setup(opts: { withDraft?: boolean; current?: string } = {}) {
  const current = opts.current ?? (opts.withDraft === false ? ACTIVE : DRAFT);
  const c = {
    searchObject: async () => [{ "adtcore:name": "ZDEMO", "adtcore:type": "PROG/P", "adtcore:uri": base, "adtcore:packageName": "$TMP" }],
    objectStructure: async () => { throw new Error("sin estructura"); },
    revisions: async () => revisions(opts.withDraft),
    getObjectSource: async (uri: string) => sourceByUri[uri] ?? current, // la URL del objeto devuelve lo que hay ahora
  };
  const written: string[] = [];
  const s = {
    lock: async () => ({ LOCK_HANDLE: "H", CORRNR: "", CORRUSER: "", IS_LOCAL: "X" }),
    getObjectSource: async () => current,
    setObjectSource: async (_u: string, src: string) => void written.push(src),
    unLock: async () => undefined,
  };
  const ctx = (confirmedState?: string) =>
    ({ sap: { adt: async () => c, stateful: async (fn: any) => fn(s), query: async () => ({ values: [] }) }, system: { id: "DEV", user: "DEV1" }, confirmedState }) as any;
  return { ctx, written };
}

const args = (extra: Record<string, unknown> = {}) => ({ object_name: "ZDEMO", object_type: "PROG", include: "main", target: "active", activate: false, ...extra });

describe("revert_source · vista previa", () => {
  it("muestra a qué versión vuelve, que hay borrador inactivo, el diff y la huella de lo que hay ahora", async () => {
    const { ctx } = setup();
    const p: any = await def.preview!(args(), ctx());
    expect(p.text).toMatch(/Volver a: última versión activa · 2026-09-22T10:00:00Z · DEV1 · activa/);
    expect(p.text).toMatch(/Estado: el objeto tiene un borrador inactivo/);
    expect(p.text).toMatch(/Cambio respecto a lo que hay ahora: \+1 −1/);
    expect(p.text).toMatch(/-WRITE 'borrador roto'\./);
    expect(p.text).toMatch(/\+WRITE 'activa'\./);
    expect(p.state).toBe(stateOf(DRAFT));
  });

  it("avisa cuando no hay borrador que deshacer", async () => {
    const { ctx } = setup({ withDraft: false });
    const p: any = await def.preview!(args(), ctx());
    expect(p.text).toMatch(/no hay borrador que deshacer/);
    expect(p.text).toMatch(/Cambio: ninguno/);
  });

  it("target=previous elige la versión grabada más reciente, no la activa ni el borrador", async () => {
    const { ctx } = setup();
    const p: any = await def.preview!(args({ target: "previous" }), ctx());
    expect(p.text).toMatch(/Volver a: versión anterior a la activa · 2026-09-20T10:00:00Z · DEV2 · versión 2/);
    expect(p.text).toMatch(/\+WRITE 'anterior'\./);
  });

  it("target=N usa la numeración de object_versions y rechaza un número fuera de rango", async () => {
    const { ctx } = setup();
    const p: any = await def.preview!(args({ target: 4 }), ctx());
    expect(p.text).toMatch(/Volver a: versión 4 del historial .* versión 1/);
    await expect(def.preview!(args({ target: 9 }), ctx())).rejects.toThrow(/Solo hay 4 versiones/);
  });
});

describe("revert_source · escritura", () => {
  it("escribe la versión activa sobre el borrador con la huella confirmada", async () => {
    const { ctx, written } = setup();
    const r: any = await def.run(args(), ctx(stateOf(DRAFT)));
    expect(r.isError).toBe(false);
    expect(r.text).toMatch(/^Revertido a la última versión activa\./);
    expect(written).toEqual([ACTIVE]);
  });

  it("no escribe si lo que hay en SAP ya no es lo que se vio en la vista previa", async () => {
    const { ctx, written } = setup();
    const r: any = await def.run(args(), ctx(stateOf("REPORT zdemo.\n* alguien guardó otra cosa\n")));
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/cambió en SAP después de la vista previa/);
    expect(written).toEqual([]);
  });

  it("es una tool write: el registro exige vista previa y confirmación como a cualquier escritura", () => {
    expect(def.access).toBe("write");
    expect(typeof def.preview).toBe("function");
  });
});
