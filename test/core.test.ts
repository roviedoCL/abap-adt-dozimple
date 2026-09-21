import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { canWrite, parseConfig, resolveSystem } from "../src/core/config.js";
import { normalizeError, renderError, ToolError } from "../src/core/errors.js";
import { budget } from "../src/core/output.js";
import { assertAccess, assertNotSensitive, assertSelectOnly, assertTrkorr } from "../src/core/policy.js";
import { decideTransport } from "../src/core/transport.js";
import { adtType } from "../src/core/objects.js";

beforeAll(() => {
  process.env.ABAP_DZ_STATE_DIR = mkdtempSync(join(tmpdir(), "abapdz-"));
});

const base = { url: "https://sap.example:44300", client: "100", user: "U" };
const cfg = parseConfig({
  defaultSystem: "dev_b",
  systems: [
    { ...base, id: "DEV_A", role: "DEV", allowWrite: true, modules: ["dz-transport-risk"] },
    { ...base, id: "PRD_A", role: "PRD", allowWrite: true },
    { ...base, id: "DEV_B", role: "DEV" },
  ],
});

describe("configuración", () => {
  it("resuelve por parámetro sin distinguir mayúsculas", () => {
    expect(resolveSystem(cfg, "dev_A")).toMatchObject({ system: { id: "DEV_A" }, source: "parámetro" });
  });
  it("usa el sistema por defecto y lo dice", () => {
    expect(resolveSystem(cfg)).toMatchObject({ system: { id: "DEV_B" }, source: "por defecto" });
  });
  it("con varios sistemas y sin defecto, pide elegir en vez de adivinar", () => {
    const c = parseConfig({ systems: [{ ...base, id: "A", role: "DEV" }, { ...base, id: "B", role: "DEV" }] });
    expect(() => resolveSystem(c)).toThrow(/indica "system"/);
  });
  it("rechaza sistemas desconocidos listando los disponibles", () => {
    expect(() => resolveSystem(cfg, "X")).toThrow(/DEV_A, PRD_A, DEV_B/);
  });
  it("rechaza ids duplicados y defaultSystem inexistente", () => {
    expect(() => parseConfig({ systems: [{ ...base, id: "A", role: "DEV" }, { ...base, id: "a", role: "DEV" }] })).toThrow(/duplicado/);
    expect(() => parseConfig({ defaultSystem: "Z", systems: [{ ...base, id: "A", role: "DEV" }] })).toThrow(/defaultSystem/);
  });
  it("no acepta contraseñas en el archivo", () => {
    expect(() => parseConfig({ systems: [{ ...base, id: "A", role: "DEV", password: ["texto", "plano"].join("-") }] })).toThrow();
  });
});

describe("política", () => {
  it("PRD nunca escribe, aunque allowWrite sea true", () => {
    const prd = cfg.systems.find((s) => s.id === "PRD_A")!;
    expect(canWrite(prd)).toBe(false);
    expect(() => assertAccess("write", prd)).toThrow(/nunca escribe/);
    expect(() => assertAccess("exec", prd)).toThrow(/solo se ejecuta/);
    expect(() => assertAccess("read", prd)).not.toThrow();
  });
  it("DEV sin allowWrite no escribe y dice cómo habilitarlo", () => {
    const ns = cfg.systems.find((s) => s.id === "DEV_B")!;
    try {
      assertAccess("write", ns);
      expect.unreachable();
    } catch (e) {
      expect((e as ToolError).kind).toBe("POLICY");
      expect((e as ToolError).hint).toMatch(/allowWrite/);
    }
    expect(() => assertAccess("exec", ns)).not.toThrow();
  });
  it("solo SELECT/WITH, una sentencia", () => {
    expect(assertSelectOnly("  select * from t000.")).toBe("select * from t000");
    expect(() => assertSelectOnly("DELETE FROM ztab")).toThrow(/SELECT/);
    expect(() => assertSelectOnly("SELECT * FROM t000; DELETE FROM x")).toThrow(/«;»/);
  });
  it("bloquea material de credenciales, venga como venga escrito", () => {
    for (const q of [
      "SELECT bname, pwdsaltedhash FROM usr02",
      "select * from USR02 where bname = 'X'",
      "SELECT a~bname FROM usr01 AS a INNER JOIN usr02 AS b ON b~bname = a~bname",
      "SELECT * FROM rsectab",
      "SELECT * FROM ssf_pse_d",
      "SELECT bname FROM usr01 WHERE bname IN ( SELECT bname FROM ush02 )",
    ]) {
      expect(() => assertNotSensitive(q), q).toThrow(/datos de seguridad/);
    }
  });
  it("deja pasar la configuración sin secretos que usa el análisis de Basis", () => {
    for (const q of [
      "SELECT rfcdest, rfctype FROM rfcdes",
      "SELECT * FROM rfcsysacl",
      "SELECT agr_name FROM agr_define",
      "SELECT bname, class FROM usr01",
      "SELECT * FROM ZUSR02_LOG", // un nombre que solo contiene la palabra no es la tabla
    ]) {
      expect(() => assertNotSensitive(q), q).not.toThrow();
    }
  });
  it("valida números de orden", () => {
    expect(assertTrkorr(" devk900123 ")).toBe("DEVK900123");
    expect(() => assertTrkorr("SAPKCCD750")).toThrow();
  });
});

describe("decisión de orden al guardar", () => {
  const free = { CORRNR: "", CORRUSER: "", IS_LOCAL: "" };
  it("objeto local: sin orden", () => {
    expect(decideTransport({ ...free, IS_LOCAL: "X" }, undefined)).toMatchObject({ ok: true, corrNr: "" });
  });
  it("objeto libre sin orden pedida: se para", () => {
    expect(decideTransport(free, undefined)).toMatchObject({ ok: false });
  });
  it("objeto libre con orden pedida: la usa", () => {
    expect(decideTransport(free, "DEVK900100")).toMatchObject({ ok: true, corrNr: "DEVK900100" });
  });
  it("bloqueado en la tarea de la orden pedida: guarda en esa tarea", () => {
    const lock = { CORRNR: "DEVK900101", CORRUSER: "USUARIO", IS_LOCAL: "" };
    expect(decideTransport(lock, "DEVK900100", "DEVK900100")).toMatchObject({ ok: true, corrNr: "DEVK900101" });
  });
  it("bloqueado en otra orden: se para y dice cuál (bloqueo TLOCK ajeno)", () => {
    const lock = { CORRNR: "DEVK900294", CORRUSER: "OTRO_USER", IS_LOCAL: "" };
    const d = decideTransport(lock, "DEVK900100", "DEVK900293");
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toMatch(/DEVK900293.*OTRO_USER.*No se escribió nada/);
  });
  it("bloqueado y sin orden pedida: no elige por el usuario", () => {
    const d = decideTransport({ CORRNR: "DEVK900101", CORRUSER: "X", IS_LOCAL: "" }, undefined, "DEVK900100");
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toMatch(/transport=DEVK900100/);
  });
});

describe("errores honestos", () => {
  it("un fallo de red se clasifica como NETWORK y sugiere la VPN", () => {
    const te = normalizeError(Object.assign(new Error("connect"), { code: "ENETUNREACH" }), "DEV_A");
    expect(te.kind).toBe("NETWORK");
    expect(renderError(te)).toMatch(/VPN/);
    expect(renderError(te)).toMatch(/no interpretes esto como un resultado vacío/);
  });
  it("un error sin mensaje no se queda en «undefined»", () => {
    expect(normalizeError(undefined).message).not.toBe("");
  });
});

describe("salida", () => {
  it("recorta por líneas y avisa", () => {
    const text = Array.from({ length: 100 }, (_, i) => `linea ${i}`).join("\n");
    const out = budget(text, 50, "Pide más.");
    expect(out).toMatch(/recortado: se muestran \d+ de 100 líneas\. Pide más\./);
  });
  it("no toca lo que cabe", () => {
    expect(budget("hola", 10)).toBe("hola");
  });
});

describe("tipos de objeto", () => {
  it("traduce tipos cortos y acepta ADT", () => {
    expect(adtType("func")).toBe("FUGR/FF");
    expect(adtType("PROG/I")).toBe("PROG/I");
    expect(() => adtType("FOO")).toThrow(/Tipo desconocido/);
  });
});
