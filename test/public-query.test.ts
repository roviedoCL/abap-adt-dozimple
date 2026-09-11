import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { parseConfig } from "../src/core/config.js";
import { assertPublicQuery, customTokens, sensitiveTerms } from "../src/core/policy.js";
import { isVisible, loadTools } from "../src/core/registry.js";

beforeAll(() => {
  process.env.ABAP_DZ_STATE_DIR = mkdtempSync(join(tmpdir(), "abapdz-"));
});

const cfg = parseConfig({
  systems: [
    { id: "DEV_B", sid: "D02", url: "https://sap-dev.cliente-b.example:44300", client: "300", user: "S_USUARIO", role: "DEV" },
    { id: "DEV_A", sid: "D01", url: "https://sapdev.cliente-a.example:44300", client: "100", user: "USUARIO", role: "DEV" },
  ],
  sidecars: { docs: { command: "/bin/true", blockTerms: ["ClienteA", "ClienteB"] } },
});
const block = cfg.sidecars.docs.blockTerms;

describe("consultas que salen a internet", () => {
  it("deduce términos sensibles de la configuración", () => {
    const t = sensitiveTerms(cfg, block);
    for (const x of ["dev_b", "dev_a", "d02", "d01", "s_usuario", "usuario", "cliente-b", "cliente-a", "clientea", "clienteb"]) expect(t).toContain(x);
    expect(t).not.toContain("sap");
  });

  it("detecta objetos de cliente, namespaces y órdenes", () => {
    expect(customTokens("error en ZDEMO_REPORT_01 y zcl_demo_valor")).toEqual(["ZDEMO_REPORT_01", "zcl_demo_valor"]);
    expect(customTokens("ZFI001 dump")).toEqual(["ZFI001"]);
    expect(customTokens("/NSP/STOCK falla en DEVK900123")).toEqual(["/NSP/STOCK", "DEVK900123"]);
  });

  it("deja pasar consultas técnicas genéricas", () => {
    for (const q of ["MATNR length extension BAPI MATERIAL_LONG", "inline declaration 7.50", "year end closing yield", "CX_SY_DYN_CALL_ILLEGAL_TYPE"]) {
      expect(() => assertPublicQuery(q, cfg, block), q).not.toThrow();
    }
  });

  it("bloquea cualquier dato del cliente o del sistema", () => {
    for (const q of ["ZDEMO_REPORT_01 MATERIAL_LONG", "clientea ATC remediation", "ClienteB stock availability", "dump en D02", "error cliente-a gateway", "S_USUARIO lock"]) {
      expect(() => assertPublicQuery(q, cfg, block), q).toThrow(/saldría a internet/);
    }
  });
});

describe("visibilidad de las tools de documentación", () => {
  it("existen solo si el componente está configurado, y la online solo con allowOnline", async () => {
    const defs = await loadTools(join(__dirname, "..", "src", "tools"));
    const byName = (n: string) => defs.find((d) => d.name === n)!;
    expect(isVisible(byName("docs_search"), cfg)).toBe(true);
    expect(isVisible(byName("docs_community_search"), cfg)).toBe(false);
    const online = parseConfig({ ...cfg, sidecars: { docs: { command: "/bin/true", allowOnline: true } } });
    expect(isVisible(byName("docs_community_search"), online)).toBe(true);
    const sinDocs = parseConfig({ systems: cfg.systems });
    expect(isVisible(byName("docs_search"), sinDocs)).toBe(false);
  });
});
