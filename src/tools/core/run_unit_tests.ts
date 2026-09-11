import { z } from "zod";
import { resolveObject, TYPE_HELP } from "../../core/objects.js";
import { defineTool } from "../../core/tool.js";

export default defineTool({
  name: "run_unit_tests",
  title: "Ejecutar ABAP Unit",
  description:
    "Ejecuta los tests ABAP Unit de una clase o programa y devuelve el resultado por método, con el detalle de cada " +
    "fallo. Si no hay clases de test lo dice: cero tests no es un éxito.",
  access: "exec",
  requires: { adt: ["/sap/bc/adt/abapunit/testruns"] },
  input: {
    object_name: z.string().min(1),
    object_type: z.string().default("CLAS").describe(TYPE_HELP),
  },
  async run({ object_name, object_type }, { sap }) {
    const c = await sap.adt();
    const obj = await resolveObject(c, object_name, object_type);
    const classes = await c.unitTestRun(obj.uri);
    if (!classes.length) return { text: `${obj.name}: no se encontraron clases de test. No se ejecutó nada.`, isError: true };

    let pass = 0;
    let fail = 0;
    const lines: string[] = [];
    for (const cl of classes) {
      for (const a of cl.alerts) lines.push(`  ! ${cl["adtcore:name"]}: ${a.title} ${a.details.join(" ")}`);
      for (const m of cl.testmethods) {
        const bad = m.alerts.filter((a) => a.severity !== "tolerable" && a.kind !== "warning");
        if (bad.length) {
          fail++;
          lines.push(`  ✗ ${cl["adtcore:name"]}->${m["adtcore:name"]}`);
          for (const a of bad) {
            lines.push(`      ${a.kind}: ${a.title}`);
            for (const d of a.details) lines.push(`        ${d}`);
            const top = a.stack[0];
            if (top) lines.push(`        en ${top["adtcore:name"]} ${top["adtcore:uri"]?.match(/#start=(\d+)/)?.[1] ? "L" + top["adtcore:uri"].match(/#start=(\d+)/)![1] : ""}`);
          }
        } else {
          pass++;
          lines.push(`  ✓ ${cl["adtcore:name"]}->${m["adtcore:name"]} (${m.executionTime}s)`);
        }
      }
    }
    const classAlerts = classes.some((cl) => cl.alerts.length);
    return {
      text: `${obj.name}: ${pass} verdes, ${fail} rojos${classAlerts ? ", con alertas de clase" : ""}.\n\n${lines.join("\n")}`,
      isError: fail > 0 || classAlerts,
    };
  },
});
