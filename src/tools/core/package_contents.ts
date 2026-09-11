import { z } from "zod";
import { ToolError } from "../../core/errors.js";
import { sqlLiteral } from "../../core/objects.js";
import { defineTool } from "../../core/tool.js";

export default defineTool({
  name: "package_contents",
  title: "Contenido de un paquete",
  description:
    "Objetos de un paquete de desarrollo agrupados por tipo, con sus subpaquetes (TADIR/TDEVC, cualquier release). " +
    "Con recursive=true incluye los subpaquetes. Dice también si el paquete viaja (conexión al CTS).",
  access: "read",
  input: {
    package: z.string().min(1),
    recursive: z.boolean().default(false),
    object_type: z.string().optional().describe("Filtrar por tipo TADIR: PROG, CLAS, FUGR, TABL, DDLS…"),
    max_objects: z.number().int().min(1).max(5000).default(500),
  },
  async run({ package: pkg, recursive, object_type, max_objects }, { sap }) {
    const root = pkg.trim().toUpperCase();
    const head = await sap.query(`SELECT devclass, parentcl, korrflag, dlvunit, pdevclass FROM tdevc WHERE devclass = ${sqlLiteral(root)}`, 1);
    const h = head.values[0];
    if (!h) throw new ToolError("NOT_FOUND", `El paquete ${root} no existe en este sistema.`);
    const txt = await sap.query(`SELECT ctext FROM tdevct WHERE devclass = ${sqlLiteral(root)}`, 1);

    // Árbol de subpaquetes (hasta 5 niveles si es recursivo).
    const packages = [root];
    const subs: string[] = [];
    let frontier = [root];
    for (let level = 0; level < (recursive ? 5 : 1) && frontier.length; level++) {
      const r = await sap.query(`SELECT devclass FROM tdevc WHERE parentcl IN ( ${frontier.map(sqlLiteral).join(", ")} )`, 2000);
      frontier = r.values.map((v) => v.DEVCLASS as string);
      subs.push(...frontier);
      if (recursive) packages.push(...frontier);
    }

    const typeFilter = object_type ? ` AND object = ${sqlLiteral(object_type.toUpperCase())}` : "";
    const objs = await sap.query(
      `SELECT devclass, object, obj_name FROM tadir WHERE pgmid = 'R3TR' AND devclass IN ( ${packages.map(sqlLiteral).join(", ")} )` +
        `${typeFilter} AND object <> 'DEVC' ORDER BY object, obj_name`,
      max_objects,
    );

    const byType = new Map<string, string[]>();
    for (const o of objs.values) {
      const label = recursive && o.DEVCLASS !== root ? `${o.OBJ_NAME} [${o.DEVCLASS}]` : o.OBJ_NAME;
      byType.set(o.OBJECT, [...(byType.get(o.OBJECT) ?? []), label]);
    }
    const lines = [
      `${root} «${txt.values[0]?.CTEXT ?? ""}»` +
        (h.PARENTCL ? ` · dentro de ${h.PARENTCL}` : "") +
        ` · ${h.KORRFLAG === "X" ? "transportable" : "local/sin CTS: sus objetos NO viajan"}` +
        (h.DLVUNIT ? ` · componente ${h.DLVUNIT}` : ""),
    ];
    if (subs.length) lines.push(`Subpaquetes${recursive ? "" : " (directos)"}: ${subs.join(", ")}`);
    lines.push("", `${objs.values.length} objetos${objs.values.length >= max_objects ? ` (tope de ${max_objects} alcanzado)` : ""}:`);
    for (const [type, names] of byType) lines.push(`  ${type} (${names.length}): ${names.join(", ")}`);
    if (!byType.size) lines.push("  (sin objetos)");
    return lines.join("\n");
  },
});
