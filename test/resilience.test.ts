import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AdtErrorException } from "abap-adt-api";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { parseConfig } from "../src/core/config.js";
import { SapConnection } from "../src/core/connection.js";
import { isSessionExpired, ToolError } from "../src/core/errors.js";
import { invoke } from "../src/core/registry.js";
import type { ToolDef } from "../src/core/tool.js";

/**
 * Sprint 1 del plan de mejoras: reintento único ante sesión caducada (solo lecturas), circuit breaker por sistema y
 * tiempo máximo por tool. Ninguna de las tres cosas toca SAP en los tests: la conexión se finge.
 */
beforeAll(() => {
  process.env.ABAP_DZ_STATE_DIR = mkdtempSync(join(tmpdir(), "abapdz-res-"));
});

const base = { url: "https://sap.example:44300", client: "100", user: "U" };
const cfg = parseConfig({ defaultSystem: "NS", systems: [{ ...base, id: "NS", role: "DEV", allowWrite: true }] });

/** Error 401 como lo lanza abap-adt-api a mitad de sesión (no en el login). */
const expired = () => AdtErrorException.create(401, {}, "", "Session expired");
/** Error CSRF: la librería lo reconoce por su typeID, no por la clase. */
const csrf = () => Object.assign(new Error("CSRF token validation failed"), { typeID: Symbol.for("BAD CSRF") });

function fakePool(conn: Record<string, unknown> = {}) {
  const c = { missingCapabilities: async () => [], adt: async () => ({}), resetReader: vi.fn(), noteNetworkFailure: vi.fn(), ...conn };
  return { pool: { get: () => c } as any, conn: c };
}

const readTool = (run: ToolDef["run"], extra: Partial<ToolDef> = {}): ToolDef =>
  ({ name: "demo_read", title: "demo", description: "demo", access: "read", input: {}, run, ...extra }) as ToolDef;

describe("sesión caducada: una lectura se repite una vez", () => {
  it("renueva la sesión, repite y lo anota en la respuesta", async () => {
    const { pool, conn } = fakePool();
    let calls = 0;
    const t = readTool(async () => (++calls === 1 ? Promise.reject(expired()) : "fuente del objeto"));
    const r = await invoke(t, {}, { config: cfg, pool, tools: [] });
    expect(r.isError).toBe(false);
    expect(r.text).toMatch(/Nota: La sesión con NS había caducado: se renovó y la lectura se repitió/);
    expect(r.text).toMatch(/fuente del objeto/);
    expect(calls).toBe(2);
    expect(conn.resetReader).toHaveBeenCalledTimes(1);
  });

  it("también ante un token CSRF rechazado", async () => {
    const { pool, conn } = fakePool();
    let calls = 0;
    const t = readTool(async () => (++calls === 1 ? Promise.reject(csrf()) : "ok"));
    const r = await invoke(t, {}, { config: cfg, pool, tools: [] });
    expect(r.isError).toBe(false);
    expect(calls).toBe(2);
    expect(conn.resetReader).toHaveBeenCalledTimes(1);
  });

  it("si vuelve a fallar, no insiste: dos intentos y error AUTH", async () => {
    const { pool, conn } = fakePool();
    let calls = 0;
    const t = readTool(async () => {
      calls++;
      throw expired();
    });
    const r = await invoke(t, {}, { config: cfg, pool, tools: [] });
    expect(r.isError).toBe(true);
    expect(r.kind).toBe("AUTH");
    expect(calls).toBe(2);
    expect(conn.resetReader).toHaveBeenCalledTimes(1);
  });

  it("una ejecución (exec) nunca se repite: podría ejecutar dos veces", async () => {
    const { pool, conn } = fakePool();
    let calls = 0;
    const t = readTool(
      async () => {
        calls++;
        throw expired();
      },
      { name: "demo_exec", access: "exec", confirm: false },
    );
    const r = await invoke(t, {}, { config: cfg, pool, tools: [] });
    expect(r.isError).toBe(true);
    expect(calls).toBe(1);
    expect(conn.resetReader).not.toHaveBeenCalled();
  });

  it("una contraseña rechazada en el login no es una sesión caducada", () => {
    // isSessionExpired solo mira la forma del error; que sea el login o no lo decide dónde se lanza (connection.login
    // olvida la contraseña y propaga un ToolError AUTH, que no pasa por aquí).
    expect(isSessionExpired(new ToolError("AUTH", "Usuario o contraseña rechazados"))).toBe(false);
    expect(isSessionExpired(AdtErrorException.create(403, {}, "", "Sin autorización"))).toBe(false);
    expect(isSessionExpired(expired())).toBe(true);
    expect(isSessionExpired(csrf())).toBe(true);
  });
});

describe("tiempo máximo por tool", () => {
  it("una tool que no termina a tiempo falla como NETWORK, dice el tiempo y no se repite", async () => {
    const { pool, conn } = fakePool();
    let calls = 0;
    const t = readTool(
      () => {
        calls++;
        return new Promise((res) => setTimeout(() => res("tarde"), 200));
      },
      { timeoutMs: 50 },
    );
    const r = await invoke(t, {}, { config: cfg, pool, tools: [] });
    expect(r.isError).toBe(true);
    expect(r.kind).toBe("NETWORK");
    expect(r.text).toMatch(/demo_read: tiempo agotado \(50 ms\)/);
    expect(calls).toBe(1);
    // Un timeout propio no es un fallo de red del sistema: no abre el circuito.
    expect(conn.noteNetworkFailure).not.toHaveBeenCalled();
  });

  it("una tool rápida no se ve afectada por el límite", async () => {
    const { pool } = fakePool();
    const r = await invoke(readTool(async () => "rápido", { timeoutMs: 50 }), {}, { config: cfg, pool, tools: [] });
    expect(r.isError).toBe(false);
    expect(r.text).toMatch(/rápido/);
  });
});

describe("circuit breaker por sistema", () => {
  afterEach(() => vi.useRealTimers());

  const sys = cfg.systems[0];

  it("tres fallos de red en un minuto abren el circuito; pasado un minuto se cierra solo", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-22T10:00:00Z"));
    const c = new SapConnection(sys);
    c.noteNetworkFailure();
    c.noteNetworkFailure();
    expect(c.circuitOpenFor()).toBe(0);
    c.noteNetworkFailure();
    expect(c.circuitOpenFor()).toBeGreaterThan(0);
    // Con el circuito abierto, adt() ni siquiera intenta conectar: falla al instante con NETWORK.
    await expect(c.adt()).rejects.toMatchObject({ kind: "NETWORK", message: expect.stringMatching(/no se vuelve a intentar durante \d+ s/) });
    await expect(c.stateful(async () => "x")).rejects.toMatchObject({ kind: "NETWORK" });
    vi.setSystemTime(new Date("2026-09-22T10:01:01Z"));
    expect(c.circuitOpenFor()).toBe(0);
  });

  it("fallos espaciados más de un minuto no lo abren", () => {
    vi.useFakeTimers();
    const c = new SapConnection(sys);
    vi.setSystemTime(new Date("2026-09-22T10:00:00Z"));
    c.noteNetworkFailure();
    vi.setSystemTime(new Date("2026-09-22T10:00:40Z"));
    c.noteNetworkFailure();
    vi.setSystemTime(new Date("2026-09-22T10:01:30Z")); // el primero ya salió de la ventana
    c.noteNetworkFailure();
    expect(c.circuitOpenFor()).toBe(0);
  });

  it("resetCircuit lo cierra a mano (lo que hace sap_systems con check)", () => {
    const c = new SapConnection(sys);
    for (let i = 0; i < 3; i++) c.noteNetworkFailure();
    expect(c.circuitOpenFor()).toBeGreaterThan(0);
    c.resetCircuit();
    expect(c.circuitOpenFor()).toBe(0);
  });

  it("el registro avisa al circuito solo con fallos de red reales de la librería", async () => {
    const { pool, conn } = fakePool();
    const netErr = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    await invoke(readTool(async () => Promise.reject(netErr)), {}, { config: cfg, pool, tools: [] });
    expect(conn.noteNetworkFailure).toHaveBeenCalledTimes(1);
    // Un ToolError NETWORK nuestro (p. ej. el propio aviso de circuito abierto) no cuenta.
    await invoke(readTool(async () => Promise.reject(new ToolError("NETWORK", "circuito abierto"))), {}, { config: cfg, pool, tools: [] });
    expect(conn.noteNetworkFailure).toHaveBeenCalledTimes(1);
  });

  it("cada sistema tiene su propio circuito", () => {
    const a = new SapConnection({ ...sys, id: "A" });
    const b = new SapConnection({ ...sys, id: "B" });
    for (let i = 0; i < 3; i++) a.noteNetworkFailure();
    expect(a.circuitOpenFor()).toBeGreaterThan(0);
    expect(b.circuitOpenFor()).toBe(0);
  });
});
