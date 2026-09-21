#!/usr/bin/env node
/**
 * Escáner de datos sensibles del repositorio: credenciales, direcciones (IPs, hosts internos) y datos de clientes.
 * Falla (exit 1) si encuentra algo; nunca imprime el valor encontrado, solo archivo, línea y tipo.
 *
 *   node scripts/scan-sensitive.mjs            → todo el árbol: archivos versionados + nuevos no ignorados
 *   node scripts/scan-sensitive.mjs --commit   → todo el árbol + el contenido preparado para el commit (hook)
 *   node scripts/scan-sensitive.mjs --staged   → solo el contenido preparado para el commit
 *   node scripts/scan-sensitive.mjs --history  → todas las líneas añadidas en todos los commits de todas las ramas
 *
 * La lista de términos de clientes NO está en el repositorio (listarla sería exponerla): se deduce de la
 * configuración local de sistemas —ids, SID, usuarios, dominios de los hosts, blockTerms— y de un archivo opcional
 * de términos privados, uno por línea: ~/.config/abap-adt-dozimple/private-terms.txt. En CI solo se aplican los
 * patrones genéricos (credenciales, direcciones, archivos peligrosos).
 */
import { execFileSync } from "node:child_process";
import { closeSync, existsSync, fstatSync, openSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

const CFG_DIR = process.env.ABAP_DZ_CONFIG ? join(process.env.ABAP_DZ_CONFIG, "..") : join(homedir(), ".config", "abap-adt-dozimple");
const CFG = process.env.ABAP_DZ_CONFIG ?? join(CFG_DIR, "systems.json");
const PRIVATE = join(CFG_DIR, "private-terms.txt");
/** El propio producto y los SID genéricos de cualquier landscape no identifican a un cliente. */
const ALLOW = new Set(["dozimple", "abap-adt-dozimple", "dev", "qas", "prd", "tst", "sbx", "trn"]);
const GENERIC_LABELS = new Set(["com", "net", "org", "sap", "corp", "local", "cloud", "hana", "ondemand", "intra", "internal", "prod", "dev", "example"]);

function terms() {
  const t = new Set();
  if (existsSync(CFG)) {
    const cfg = JSON.parse(readFileSync(CFG, "utf8"));
    for (const s of cfg.systems ?? []) {
      t.add(s.id);
      if (s.sid) t.add(s.sid);
      if (s.user) t.add(s.user);
      try {
        const host = new URL(s.url).hostname;
        t.add(host);
        for (const l of host.split(".").slice(1, -1)) if (l.length >= 4 && !GENERIC_LABELS.has(l.toLowerCase())) t.add(l);
      } catch {}
    }
    for (const sc of Object.values(cfg.sidecars ?? {})) for (const b of sc.blockTerms ?? []) t.add(b);
  } else {
    console.error(`[scan] Aviso: sin configuración local (${CFG}); solo se buscan patrones genéricos.`);
  }
  if (existsSync(PRIVATE)) {
    for (const l of readFileSync(PRIVATE, "utf8").split("\n")) if (l.trim() && !l.startsWith("#")) t.add(l.trim());
  }
  return [...t].filter((x) => x.length >= 3 && !ALLOW.has(x.toLowerCase()));
}

// ── Direcciones ─────────────────────────────────────────────────────────────
/** Rangos de documentación (RFC 5737), loopback y comodines: no identifican ninguna red real. */
const IP_OK = [/^127\./, /^0\.0\.0\.0$/, /^255\.255\./, /^192\.0\.2\./, /^198\.51\.100\./, /^203\.0\.113\./];
function hasRealIp(line) {
  for (const m of line.matchAll(/(?<![\d.])((?:\d{1,3}\.){3}\d{1,3})(?![\d.])/g)) {
    const ip = m[1];
    if (ip.split(".").some((o) => Number(o) > 255 || (o.length > 1 && o.startsWith("0")))) continue; // no es una IP
    if (!IP_OK.some((re) => re.test(ip))) return true;
  }
  return false;
}
/** Hosts de ejemplo permitidos en docs y tests. */
const HOST_OK = /^(localhost|host|host-prd|sap|u|[a-z0-9.-]*\.example|example\.(com|org|net)|\[?::1\]?)$/i;
const INTERNAL_TLD = /\.(local|corp|internal|intra|intranet|lan|priv|localdomain|home\.arpa)$/i;
/** Puertos típicos de SAP (ICM HTTPS 443NN, HTTP 80NN, 5NN00…): con host real, es la dirección de un sistema. */
const SAP_PORT = /^(443\d\d|80\d\d|5\d\d0[0-6]|3\d\d[0-3]\d)$/;
function hasInternalHost(line) {
  for (const m of line.matchAll(/\b(?:https?:\/\/)?((?:[a-z0-9-]+\.)*[a-z0-9-]+)(?::(\d{2,5}))\b/gi)) {
    const [, host, port] = m;
    if (HOST_OK.test(host) || !/[a-z]/i.test(host)) continue;
    if (SAP_PORT.test(port) && host.includes(".")) return true;
  }
  for (const m of line.matchAll(/\bhttps?:\/\/([a-z0-9.-]+)/gi)) {
    if (!HOST_OK.test(m[1]) && INTERNAL_TLD.test(m[1])) return true;
  }
  return false;
}

// ── Reglas ──────────────────────────────────────────────────────────────────
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const rules = [
  { name: "clave privada", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "clave AWS", re: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { name: "clave de Google", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: "token de API", re: /\b(sk-[A-Za-z0-9_-]{20,}|s2_[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|xox[baprs]-[A-Za-z0-9-]{10,}|glpat-[A-Za-z0-9_-]{20,})\b/ },
  { name: "token de npm", re: /\bnpm_[A-Za-z0-9]{36}\b|_authToken\s*=\s*\S{8,}/ },
  { name: "JWT", re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { name: "cadena de conexión con clave", re: /\b(AccountKey|SharedAccessKey|Password|Pwd)=[^;"'\s]{8,}/i, allow: /<|\$\{|env:/ },
  // Anclado a un límite (inicio o carácter que no forma parte de un nombre de host): «evilhooks.slack.com» no cuenta.
  { name: "webhook con secreto", re: /(?:^|[^A-Za-z0-9.-])(?:hooks\.slack\.com\/services\/[A-Z0-9]+\/[A-Z0-9]+\/[A-Za-z0-9]+|discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+)/ },
  { name: "cabecera Authorization con valor", re: /authorization["']?\s*[:=]\s*["'](Basic|Bearer)\s+[A-Za-z0-9+/=._-]{12,}/i },
  { name: "contraseña en claro", re: /\b(password|passwd|pwd)["']?\s*[:=]\s*["'][^"'\s]{6,}["']/i, allow: /keychain|env:|<|\$\{/ },
  {
    name: "secreto asignado",
    re: /\b(api[_-]?key|secret|client[_-]?secret|access[_-]?token|auth[_-]?token|private[_-]?key)["']?\s*[:=]\s*["'][A-Za-z0-9+/=_-]{16,}["']/i,
    allow: /<|\$\{|env:|example|dummy|fake|ficticio/i,
  },
  { name: "URL con usuario y contraseña", re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s@/]{3,}@(?!proxy\b)[a-z0-9.-]+/i, allow: /u:p@|user:pass@|<|\$\{/ },
  { name: "dirección IP", test: hasRealIp },
  { name: "host interno o de SAP", test: hasInternalHost },
  { name: "ruta personal", re: /\/Users\/[a-z0-9._-]+\//i },
];
/** Archivos que nunca se versionan, por su nombre, sea cual sea su contenido. */
const FORBIDDEN_FILES = [
  { name: "archivo .env", re: /(^|\/)\.env(\.[a-z0-9]+)?$/i, allow: /\.env\.example$/i },
  { name: "certificado o clave", re: /\.(pem|key|p12|pfx|jks|keystore|pse|ppk)$/i },
  { name: "clave SSH", re: /(^|\/)id_(rsa|dsa|ecdsa|ed25519)$/ },
  { name: "configuración real de sistemas", re: /(^|\/)systems\.json$/ },
  { name: "credenciales de npm", re: /(^|\/)\.npmrc$/, content: /_authToken|_auth\s*=|_password/ },
];

const custom = terms();
// Términos cortos (SID, 3-4 caracteres) solo como palabra completa: un SID «S4X» no debe saltar en el campo «AS4XDATE».
for (const term of custom) {
  const re = term.length <= 4 ? new RegExp(`(^|[^A-Za-z0-9])${esc(term)}([^A-Za-z0-9]|$)`, "i") : new RegExp(esc(term), "i");
  rules.push({ name: "dato de cliente/sistema (configuración local)", re, hide: true });
}
// Órdenes de transporte con el SID real de un sistema configurado.
for (const sid of custom.filter((x) => /^[A-Za-z0-9]{3}$/.test(x))) rules.push({ name: "orden real", re: new RegExp(`\\b${esc(sid)}K\\d{6}\\b`, "i"), hide: true });

// ── Entrada ─────────────────────────────────────────────────────────────────
const mode = process.argv.includes("--history") ? "history" : process.argv.includes("--staged") ? "staged" : process.argv.includes("--commit") ? "commit" : "tree";
const git = (args, opts = {}) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 512 * 1024 * 1024, ...opts });
const gitLines = (args) => git(args).split("\n").filter(Boolean);
try {
  git(["rev-parse", "--git-dir"]);
} catch {
  console.error("[scan] No es un repositorio git.");
  process.exit(2);
}

// La URL pública del propio repositorio (remoto origin) no es un dato sensible: se ignora solo esa cadena exacta
// (la necesitan package.json para la procedencia de npm y los enlaces). El handle en cualquier otro contexto sigue bloqueado.
let ownRepoUrl = "";
try {
  const m = /github\.com[:/]([^/]+\/[^/.\s]+)/.exec(git(["remote", "get-url", "origin"]).trim());
  if (m) ownRepoUrl = `github.com/${m[1]}`;
} catch {}
const stripOwn = (s) => (ownRepoUrl ? s.split(ownRepoUrl).join("github.com/<repo>") : s);

const SKIP = /(^|\/)package-lock\.json$|\.(png|jpg|jpeg|gif|ico|webp|pdf|zip|tgz|gz)$/i;
const findings = [];
const report = (where, what) => findings.push(`${where}  ${what}`);

function scanText(where, text, lineOffset = 0) {
  text.split("\n").forEach((line, i) => {
    const l = stripOwn(line);
    for (const r of rules) {
      if (r.test) {
        if (r.test(l)) report(`${where}:${i + 1 + lineOffset}`, r.name);
        continue;
      }
      // La excepción se evalúa sobre el FRAGMENTO detectado, no sobre la línea: un comentario «usa keychain» en la
      // misma línea no puede salvar una contraseña real.
      const m = r.re.exec(l);
      if (m && !(r.allow && r.allow.test(m[0]))) report(`${where}:${i + 1 + lineOffset}`, r.name);
    }
  });
}

function checkFileName(path, content) {
  for (const f of FORBIDDEN_FILES) {
    if (!f.re.test(path) || (f.allow && f.allow.test(path))) continue;
    if (f.name === "configuración real de sistemas" && /systems\.example\.json$/.test(path)) continue;
    if (f.content && !(content && f.content.test(content))) continue;
    report(path, f.name);
  }
}

/** Contenido del árbol de trabajo, abriendo una vez el archivo (sin carrera entre comprobar y leer). */
function readWorking(f) {
  try {
    const fd = openSync(f, "r");
    try {
      if (fstatSync(fd).size > 2_000_000) return undefined;
      return readFileSync(fd, "utf8");
    } finally {
      closeSync(fd);
    }
  } catch {
    return undefined; // borrado entre el listado de git y la lectura
  }
}

let scanned = 0;
if (mode === "tree" || mode === "commit") {
  const files = [...new Set([...gitLines(["ls-files"]), ...gitLines(["ls-files", "--others", "--exclude-standard"])])];
  for (const f of files) {
    if (SKIP.test(f)) continue;
    const content = readWorking(f);
    checkFileName(f, content);
    if (content !== undefined) scanText(f, content);
    scanned++;
  }
}
if (mode === "staged" || mode === "commit") {
  // Lo que se commitea es el índice, no el disco: un secreto preparado y luego borrado del archivo seguiría entrando.
  for (const f of gitLines(["diff", "--cached", "--name-only", "--diff-filter=ACMR"])) {
    if (SKIP.test(f)) continue;
    let content;
    try {
      content = git(["show", `:${f}`]);
    } catch {
      continue;
    }
    checkFileName(f, content);
    scanText(`${f} (preparado)`, content);
    scanned++;
  }
}
if (mode === "history") {
  // Solo las líneas añadidas en cada commit de todas las ramas y tags: lo que alguna vez se publicó.
  const log = git(["log", "--all", "-p", "--no-color", "--unified=0", "--format=%x00COMMIT %h"]);
  let commit = "";
  let file = "";
  for (const line of log.split("\n")) {
    if (line.startsWith("\0COMMIT ")) {
      commit = line.slice(8);
      scanned++;
    } else if (line.startsWith("+++ b/")) {
      file = line.slice(6);
      if (!SKIP.test(file)) checkFileName(`${commit}:${file}`, undefined);
    } else if (line.startsWith("+") && !line.startsWith("+++") && !SKIP.test(file)) {
      scanText(`${commit}:${file}`, line.slice(1));
    }
  }
}

// Línea base: hallazgos del HISTORIAL ya revisados (p. ej. un valor ficticio en un commit publicado). Solo aplica en
// modo --history; identifica el hallazgo por commit + archivo + regla, nunca por su valor.
const baseline = new Set();
if (mode === "history" && existsSync(".scan-baseline")) {
  for (const l of readFileSync(".scan-baseline", "utf8").split("\n")) {
    const m = /^([0-9a-f]{7,40}:\S+)\s{2,}([^#]+?)\s*(#.*)?$/.exec(l.trim());
    if (m && !l.trim().startsWith("#")) baseline.add(`${m[1]}  ${m[2]}`);
  }
}
const accepted = findings.filter((f) => baseline.has(f.replace(/^([0-9a-f]+:[^:]+):\d+/, "$1")));
const unique = [...new Set(findings.filter((f) => !accepted.includes(f)))];
if (accepted.length) console.error(`[scan] ${new Set(accepted).size} hallazgos del historial aceptados en .scan-baseline (revisados, sin secretos reales).`);
if (unique.length) {
  console.error(`[scan] ✗ ${unique.length} hallazgos (no se muestran los valores):\n  ${unique.join("\n  ")}`);
  console.error("[scan] Nada de credenciales, direcciones ni datos reales: usa datos ficticios (ZDEMO_*, DEVK900123, *.example). Bloqueado.");
  process.exit(1);
}
const what = { tree: "archivos", commit: "archivos (árbol completo + preparado)", staged: "archivos preparados", history: "commits del historial" }[mode];
console.error(`[scan] ✓ ${scanned} ${what} sin credenciales, direcciones ni datos de clientes (${custom.length} términos locales comprobados).`);
