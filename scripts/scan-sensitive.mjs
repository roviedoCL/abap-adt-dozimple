#!/usr/bin/env node
/**
 * Escáner de datos sensibles del repositorio. Falla (exit 1) si encuentra
 * credenciales o datos de clientes. Se ejecuta en el hook pre-commit y en
 * `npm run security`.
 *
 * La lista de términos prohibidos NO está en el repositorio (listarla sería
 * exponerla): se deduce de la configuración local de sistemas —ids, SID,
 * usuarios, dominios de los hosts, blockTerms— y de un archivo opcional de
 * términos privados, uno por línea:
 *   ~/.config/abap-adt-dozimple/private-terms.txt
 *
 *   node scripts/scan-sensitive.mjs            → archivos versionados + nuevos
 *   node scripts/scan-sensitive.mjs --staged   → solo lo que va en el commit
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

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

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const rules = [
  { name: "clave privada", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "clave AWS", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "token de API", re: /\b(sk-[A-Za-z0-9]{20,}|s2_[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{30,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/ },
  { name: "cabecera Authorization con valor", re: /authorization["']?\s*[:=]\s*["'](Basic|Bearer)\s+[A-Za-z0-9+/=._-]{12,}/i },
  { name: "contraseña en claro", re: /\b(password|passwd|pwd)["']?\s*[:=]\s*["'][^"'\s]{6,}["']/i, allow: /keychain|env:|<|\$\{|secreto/ },
  { name: "ruta personal", re: /\/Users\/[a-z0-9._-]+\//i },
];
const custom = terms();
// Términos cortos (SID, 3-4 caracteres) solo como palabra completa: un SID «S4X» no debe saltar en el campo «AS4XDATE».
for (const term of custom) {
  const re = term.length <= 4 ? new RegExp(`(^|[^A-Za-z0-9])${esc(term)}([^A-Za-z0-9]|$)`, "i") : new RegExp(esc(term), "i");
  rules.push({ name: "dato de cliente/sistema (configuración local)", re, hide: true });
}
// Órdenes de transporte con el SID real de un sistema configurado.
for (const sid of custom.filter((x) => /^[A-Za-z0-9]{3}$/.test(x))) rules.push({ name: "orden real", re: new RegExp(`\\b${esc(sid)}K\\d{6}\\b`, "i"), hide: true });

const staged = process.argv.includes("--staged");
const git = (args) => execFileSync("git", args, { encoding: "utf8" }).split("\n").filter(Boolean);
let files;
try {
  files = staged ? git(["diff", "--cached", "--name-only", "--diff-filter=ACMR"]) : [...new Set([...git(["ls-files"]), ...git(["ls-files", "--others", "--exclude-standard"])])];
} catch {
  console.error("[scan] No es un repositorio git.");
  process.exit(2);
}

const findings = [];
for (const f of files) {
  if (!existsSync(f) || statSync(f).size > 2_000_000 || /(^|\/)package-lock\.json$|\.(png|jpg|gif|ico|pdf|zip)$/i.test(f)) continue;
  const content = readFileSync(f, "utf8");
  content.split("\n").forEach((line, i) => {
    for (const r of rules) {
      const m = r.re.exec(line);
      if (m && !(r.allow && r.allow.test(line))) {
        // Nunca se imprime el valor encontrado: solo archivo, línea y tipo.
        findings.push(`${f}:${i + 1}  ${r.name}`);
      }
    }
  });
}

if (findings.length) {
  console.error(`[scan] ✗ ${findings.length} hallazgos (no se muestran los valores):\n  ${findings.join("\n  ")}`);
  console.error("[scan] Usa datos ficticios (ZDEMO_*, DEVK900123, *.example). Commit bloqueado.");
  process.exit(1);
}
console.error(`[scan] ✓ ${files.length} archivos sin credenciales ni datos de clientes (${custom.length} términos locales comprobados).`);
