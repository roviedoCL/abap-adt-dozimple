/**
 * Genera docs/TOOLS.md desde el código: descripción, acceso, requisitos y
 * parámetros salen de cada ToolDef; grupo y créditos, del catálogo. Así la
 * referencia no se desincroniza nunca.   npm run docs
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ZodTypeAny } from "zod";
import { CORE_CREDITS, CREDITS, GROUPS } from "../core/catalog.js";
import { PROMPT_META } from "../core/prompts.js";
import { loadTools } from "../core/registry.js";
import type { ToolDef } from "../core/tool.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");

const ACCESS: Record<string, string> = {
  read: "Solo lectura",
  exec: "Ejecuta código (solo sistemas DEV)",
  write: "Escribe (solo DEV con `allowWrite`; nunca QAS/PRD)",
  local: "Local (no conecta a SAP)",
};

/** Tipo, valor por defecto y descripción de un parámetro zod. */
function describeParam(t: ZodTypeAny): { type: string; def?: string; desc: string; optional: boolean } {
  let cur: any = t;
  let optional = false;
  let def: string | undefined;
  let desc = cur.description ?? "";
  for (let i = 0; i < 6; i++) {
    const tn = cur._def?.typeName;
    if (tn === "ZodOptional") optional = true;
    else if (tn === "ZodDefault") {
      optional = true;
      def = JSON.stringify(cur._def.defaultValue());
    } else if (tn !== "ZodEffects") break;
    cur = cur._def.innerType ?? cur._def.schema;
    desc ||= cur.description ?? "";
  }
  const tn = cur._def?.typeName;
  let type = String(tn ?? "?").replace(/^Zod/, "").toLowerCase();
  if (tn === "ZodEnum") type = cur._def.values.map((v: string) => `\`${v}\``).join(" \\| ");
  if (tn === "ZodArray") {
    const el = cur._def.type;
    type = el._def?.typeName === "ZodObject" ? `lista de { ${Object.keys(el.shape).join(", ")} }` : `lista de ${describeParam(el).type}`;
  }
  return { type, def, desc: desc.replace(/\|/g, "\\|").replace(/\n/g, " "), optional };
}

function toolSection(d: ToolDef<any>, credits: Array<keyof typeof CREDITS>): string {
  const out: string[] = [`### \`${d.name}\` — ${d.title}`, "", d.description.replace(/\n+/g, " "), ""];
  const req: string[] = [];
  if (d.requires?.adt?.length) req.push(`endpoint ADT ${d.requires.adt.map((a) => `\`${a}\``).join(", ")}`);
  if (d.requires?.module) req.push(`módulo \`${d.requires.module}\` habilitado en el sistema`);
  if (d.requires?.sidecar) req.push(`componente \`${d.requires.sidecar}\` configurado`);
  if (d.requires?.online) req.push("búsqueda online habilitada (consulta filtrada)");
  out.push(`| | |`, `|---|---|`, `| **Acceso** | ${ACCESS[d.access]} |`);
  if (req.length) out.push(`| **Requiere** | ${req.join("; ")} |`);
  const c = credits.length
    ? credits.map((k) => `[${CREDITS[k].what}](${CREDITS[k].url}) — ${CREDITS[k].by} (${CREDITS[k].license}, ${CREDITS[k].kind})`).join("<br>")
    : "Desarrollo propio de DoZimple";
  out.push(`| **Créditos** | ${c} |`, "");

  const params = Object.entries(d.input as Record<string, ZodTypeAny>).map(([k, t]) => ({ k, ...describeParam(t) }));
  if (d.access !== "local") params.unshift({ k: "system", type: "string", def: undefined, desc: "Sistema SAP configurado. Obligatorio si hay varios y ninguno por defecto.", optional: true });
  if (d.access === "write") params.push({ k: "confirm_token", type: "string", def: undefined, desc: "Token de la vista previa. Sin él la tool no escribe: devuelve qué va a cambiar y el token, que se usa tras la conformidad del usuario (un solo uso, 10 min).", optional: true });
  if (params.length) {
    out.push("| Parámetro | Tipo | Por defecto | Descripción |", "|---|---|---|---|");
    for (const p of params) out.push(`| \`${p.k}\`${p.optional ? "" : " *"} | ${p.type} | ${p.def ?? ""} | ${p.desc} |`);
    out.push("", "\\* obligatorio", "");
  } else out.push("Sin parámetros.", "");
  return out.join("\n");
}

const defs = await loadTools(join(here, "..", "tools"));
const byName = new Map(defs.map((d) => [d.name, d]));
const total = defs.length;

const md: string[] = [
  "# Referencia de tools — abap-adt-doZimple",
  "",
  `Generado desde el código con \`npm run docs\`. ${total} tools en ${GROUPS.length} grupos y ${Object.keys(PROMPT_META).length} flujos guiados.`,
  "Producto de [DoZimple](https://dozimple.cl).",
  "",
  "## Índice",
  "",
  ...GROUPS.map((g) => `- [${g.title}](#${g.id}) — ${g.tools.length} tools: ${g.tools.map((t) => `\`${t.name}\``).join(", ")}`),
  "- [Flujos guiados](#flujos-guiados)",
  "- [Créditos del núcleo](#creditos-del-nucleo)",
  "",
];

for (const g of GROUPS) {
  md.push(`<a id="${g.id}"></a>`, `## ${g.title}`, "", `*${g.pitch}*`, "");
  for (const t of g.tools) {
    const d = byName.get(t.name);
    if (!d) throw new Error(`El catálogo cita ${t.name} y no existe`);
    md.push(toolSection(d, t.credits));
  }
}

md.push('<a id="flujos-guiados"></a>', "## Flujos guiados", "", "Prompts MCP: aparecen como comandos en el cliente (en Claude Code, `/mcp__abap-adt-doZimple__<nombre>`).", "");
md.push("| Flujo | Qué hace | Argumentos | Encadena |", "|---|---|---|---|");
for (const [name, p] of Object.entries(PROMPT_META)) md.push(`| \`${name}\` — ${p.title} | ${p.description} | ${p.args.map((a) => `\`${a}\``).join(", ")} | ${p.chain} |`);
md.push("", '<a id="creditos-del-nucleo"></a>', "## Créditos del núcleo", "", "Todas las tools se apoyan en:", "");
for (const k of CORE_CREDITS) md.push(`- [${CREDITS[k].what}](${CREDITS[k].url}) — ${CREDITS[k].by} (${CREDITS[k].license}, ${CREDITS[k].kind})`);
md.push("", "Licencias completas de las dependencias: [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).", "");

mkdirSync(join(root, "docs"), { recursive: true });
writeFileSync(join(root, "docs", "TOOLS.md"), md.join("\n"));
console.error(`docs/TOOLS.md: ${total} tools, ${GROUPS.length} grupos`);

// ── README: bloques generados entre marcadores ────────────────────────────
const ACCESS_SHORT: Record<string, string> = { read: "lectura", exec: "ejecuta (DEV)", write: "escribe (DEV autorizado)", local: "local" };
/** Primera frase: termina en punto seguido de mayúscula o fin (no corta «p. ej.»). */
const firstSentence = (s: string) => {
  const t = s.replace(/\n+/g, " ").replace(/\b(p\. ej|e\.g|i\.e)\./g, "$1\u0000"); // abreviaturas: no terminan frase
  return (t.match(/^.*?[.!?](?=\s+[A-ZÁÉÍÓÚÑ¿¡«`]|\s*$)/)?.[0] ?? t).replace(/\u0000/g, ".").trim();
};

const groupsBlock = [
  "| Grupo | Para qué | Tools |",
  "|---|---|---|",
  ...GROUPS.map((g) => `| [${g.title}](#g-${g.id}) | ${g.pitch} | ${g.tools.length} |`),
].join("\n");

const toolsBlock = GROUPS.map((g) =>
  [
    `<a id="g-${g.id}"></a>`,
    `### ${g.title}`,
    "",
    `*${g.pitch}*`,
    "",
    "| Tool | Qué hace | Acceso |",
    "|---|---|---|",
    ...g.tools.map((t) => {
      const d = byName.get(t.name)!;
      return `| [\`${t.name}\`](docs/TOOLS.md#${g.id}) | **${/[.?!]$/.test(d.title) ? d.title : d.title + "."}** ${firstSentence(d.description).replace(/\|/g, "\\|")} | ${ACCESS_SHORT[d.access]} |`;
    }),
    "",
  ].join("\n"),
).join("\n");

const promptsBlock = [
  "Aparecen como comandos en el cliente MCP (en Claude Code: `/mcp__abap-adt-doZimple__<nombre>`) y encadenan las tools",
  "con las reglas de trabajo de un consultor senior.",
  "",
  "| Flujo | Qué hace | Encadena |",
  "|---|---|---|",
  ...Object.entries(PROMPT_META).map(([n, p]) => `| \`${n}\` — ${p.title} | ${p.description} | ${p.chain} |`),
].join("\n");

const usedBy = new Map<string, string[]>();
for (const g of GROUPS) for (const t of g.tools) for (const c of t.credits) usedBy.set(c, [...(usedBy.get(c) ?? []), t.name]);
for (const c of CORE_CREDITS) usedBy.set(c, ["todas (núcleo)", ...(usedBy.get(c) ?? []).filter((x) => x !== "todas (núcleo)")]);
const KIND_ORDER = ["dependencia", "datos", "idea", "algoritmo"] as const;
const creditsBlock = [
  "| Proyecto | Autor / titular | Licencia | Tipo | Usado en |",
  "|---|---|---|---|---|",
  ...Object.entries(CREDITS)
    .sort((a, b) => KIND_ORDER.indexOf(a[1].kind) - KIND_ORDER.indexOf(b[1].kind))
    .map(([k, c]) => {
      const tools = usedBy.get(k) ?? [];
      const shown = tools.length > 6 ? `${tools.slice(0, 6).map((t) => (t.includes(" ") ? t : `\`${t}\``)).join(", ")} y ${tools.length - 6} más` : tools.map((t) => (t.includes(" ") ? t : `\`${t}\``)).join(", ");
      return `| [${c.what}](${c.url}) | ${c.by} | ${c.license} | ${c.kind} | ${shown} |`;
    }),
].join("\n");

const readmePath = join(root, "README.md");
let readme = readFileSync(readmePath, "utf8");
const put = (name: string, content: string) => {
  const re = new RegExp(`(<!-- ${name}:start -->)[\\s\\S]*?(<!-- ${name}:end -->)`);
  if (!re.test(readme)) throw new Error(`README sin marcadores ${name}`);
  readme = readme.replace(re, `$1\n${content}\n$2`);
};
put("groups", groupsBlock);
put("tools", toolsBlock);
put("prompts", promptsBlock);
put("credits", creditsBlock);
writeFileSync(readmePath, readme);
console.error("README.md: bloques generados actualizados");
