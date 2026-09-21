import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

const SCANNER = join(__dirname, "..", "scripts", "scan-sensitive.mjs");
// Los valores se arman al ejecutar: este archivo no contiene ningún secreto ni dirección con forma real.
const j = (...p: string[]) => p.join("");
const FAKE = {
  aws: j("AKIA", "Z".repeat(16)),
  google: j("AIza", "Q".repeat(35)),
  github: j("ghp_", "a1".repeat(18)),
  githubPat: j("github_pat_", "b2".repeat(22)),
  npm: j("npm_", "c3".repeat(18)),
  slack: j("xoxb-", "123456789012-", "abcdefghij"),
  jwt: j("eyJ", "h".repeat(20), ".eyJ", "p".repeat(20), ".", "s".repeat(20)),
  pem: j("-----BEGIN ", "RSA PRIVATE KEY-----"),
  privateIp: ["10", "20", "30", "40"].join("."),
  publicIp: ["34", "120", "7", "9"].join("."),
  sapHost: j("sapdev.", "acme-corp.cl", ":44300"),
  internal: j("https://", "erp.", "intranet"),
};

let repo: string;
const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "ignore" });
const put = (path: string, content: string) => {
  mkdirSync(join(repo, path, ".."), { recursive: true });
  writeFileSync(join(repo, path), content);
};
function scan(...args: string[]) {
  const r = spawnSync("node", [SCANNER, ...args], {
    cwd: repo,
    encoding: "utf8",
    // Sin configuración local: solo patrones genéricos, como en CI.
    env: { ...process.env, ABAP_DZ_CONFIG: join(repo, "no-existe", "systems.json") },
  });
  return { code: r.status, out: r.stderr };
}

beforeEach(() => {
  if (repo) rmSync(repo, { recursive: true, force: true });
  repo = mkdtempSync(join(tmpdir(), "abapdz-scan-"));
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "test");
  put("README.md", "limpio\n");
  git("add", "-A");
  git("commit", "-q", "-m", "inicio");
});

describe("escáner: credenciales", () => {
  it.each([
    ["clave AWS", `const k = "${FAKE.aws}";`],
    ["clave de Google", `key: ${FAKE.google}`],
    ["token de API", `TOKEN=${FAKE.github}`],
    ["token de API", `t = "${FAKE.githubPat}"`],
    ["token de npm", j("//registry.npmjs.org/:_auth", "Token=", FAKE.npm)],
    ["token de API", `slack ${FAKE.slack}`],
    ["JWT", `bearer ${FAKE.jwt}`],
    ["clave privada", FAKE.pem],
    ["secreto asignado", `api_key = "${"k".repeat(24)}"`],
    ["URL con usuario y contraseña", `https://admin:${"s".repeat(10)}@sap.acme-corp.cl/`],
    ["contraseña en claro", `password: "${"x".repeat(10)}"`],
  ])("detecta %s", (name, line) => {
    put("src/a.ts", line + "\n");
    const r = scan();
    expect(r.code).toBe(1);
    expect(r.out).toContain(name);
    expect(r.out).not.toContain(line.slice(-8)); // nunca imprime el valor
  });
});

describe("escáner: direcciones", () => {
  it("detecta IPs privadas y públicas, hosts SAP con puerto y dominios internos", () => {
    put("a.md", `servidor ${FAKE.privateIp}\n`);
    put("b.md", `api ${FAKE.publicIp}\n`);
    put("c.md", `ADT en ${FAKE.sapHost}\n`);
    put("d.md", `${FAKE.internal}/portal\n`);
    const r = scan();
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/a\.md:1\s+dirección IP/);
    expect(r.out).toMatch(/b\.md:1\s+dirección IP/);
    expect(r.out).toMatch(/c\.md:1\s+host interno o de SAP/);
    expect(r.out).toMatch(/d\.md:1\s+host interno o de SAP/);
  });

  it("no salta con ejemplos legítimos: localhost, rangos de documentación, *.example, versiones", () => {
    put("ok.md", [
      "https://host:44300 y https://sap.example:44300 y http://localhost:8080",
      "doc 192.0.2.10, 198.51.100.7, 203.0.113.5, loopback 127.0.0.1",
      "versión 1.30.0, node 22.20.2, semver 5.9.3",
      "https://github.com/modelcontextprotocol y https://dozimple.cl",
    ].join("\n"));
    expect(scan()).toMatchObject({ code: 0 });
  });
});

describe("escáner: archivos peligrosos por su nombre", () => {
  it.each([
    [".env", "X=1", "archivo .env"],
    ["cert/server.pem", "cualquier cosa", "certificado o clave"],
    ["id_ed25519", "x", "clave SSH"],
    ["config/systems.json", "{}", "configuración real de sistemas"],
  ])("bloquea %s", (path, content, name) => {
    put(path, content);
    const r = scan();
    expect(r.code).toBe(1);
    expect(r.out).toContain(name);
  });

  it("permite el ejemplo de configuración y un .npmrc sin credenciales", () => {
    put("config/systems.example.json", '{"systems":[]}');
    put(".npmrc", "ignore-scripts=true\n");
    put(".env.example", "API_KEY=<tu clave>\n");
    expect(scan()).toMatchObject({ code: 0 });
  });
});

describe("escáner: alcance", () => {
  it("en el commit revisa lo PREPARADO aunque el archivo en disco ya esté limpio", () => {
    put("src/b.ts", `const k = "${FAKE.aws}";\n`);
    git("add", "src/b.ts");
    put("src/b.ts", "const k = process.env.K;\n"); // limpio en disco, sucio en el índice
    const r = scan("--commit");
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/src\/b\.ts \(preparado\):1\s+clave AWS/);
  });

  it("en el commit también revisa archivos no preparados del árbol completo", () => {
    put("otro/c.md", `${FAKE.privateIp}\n`); // no se añade al commit
    expect(scan("--commit")).toMatchObject({ code: 1 });
  });

  it("el historial encuentra un secreto que se subió y después se borró", () => {
    put("src/c.ts", `const t = "${FAKE.npm}";\n`);
    git("add", "-A");
    git("commit", "-q", "-m", "con secreto");
    put("src/c.ts", "limpio\n");
    git("add", "-A");
    git("commit", "-q", "-m", "borrado");
    expect(scan()).toMatchObject({ code: 0 }); // el árbol actual está limpio…
    const h = scan("--history");
    expect(h.code).toBe(1); // …pero el historial no
    expect(h.out).toMatch(/[0-9a-f]{7}:src\/c\.ts:1\s+token de npm/);
  });
});
