import { z } from "zod";
import { isError, renderSyntax, syntaxCheck } from "../../core/checks.js";
import { CLASS_INCLUDES, resolveObject, sourceUrl, TYPE_HELP } from "../../core/objects.js";
import { defineTool } from "../../core/tool.js";

export default defineTool({
  name: "syntax_check",
  title: "Chequeo de sintaxis SAP",
  description:
    "Chequeo de sintaxis real de SAP (no abaplint). Si pasas `source`, se comprueba ESE código sin guardarlo: sirve " +
    "para validar un cambio antes de escribirlo. Sin `source`, comprueba lo último guardado.",
  access: "read",
  requires: { adt: ["/sap/bc/adt/checkruns"] },
  input: {
    object_name: z.string().min(1),
    object_type: z.string().optional().describe(TYPE_HELP),
    include: z.enum(CLASS_INCLUDES).default("main"),
    source: z.string().optional().describe("Fuente completa a comprobar (sin guardar)"),
    main_program: z.string().optional().describe("URI del programa principal, solo para includes ambiguos"),
  },
  output: {
    object: z.string(),
    checked: z.enum(["proposed", "saved"]).describe("proposed = la fuente pasada sin guardar; saved = lo último guardado"),
    errors: z.number().int(),
    warnings: z.number().int(),
    messages: z.array(z.object({ severity: z.string(), line: z.number(), offset: z.number(), text: z.string(), uri: z.string() })),
  },
  async run({ object_name, object_type, include, source, main_program }, { sap }) {
    const c = await sap.adt();
    const obj = await resolveObject(c, object_name, object_type);
    const url = await sourceUrl(c, obj, include);
    const content = source ?? (await c.getObjectSource(url, { version: "inactive" }));
    const msgs = await syntaxCheck(c, obj, url, content, main_program);
    const what = source ? "fuente propuesta (no guardada)" : "última versión guardada";
    const errs = msgs.filter(isError).length;
    const structured = {
      object: obj.name,
      checked: source ? "proposed" : "saved",
      errors: errs,
      warnings: msgs.length - errs,
      messages: msgs.map((m) => ({ severity: m.severity ?? "", line: m.line, offset: m.offset, text: m.text, uri: m.uri })),
    };
    if (!msgs.length) return { text: `${obj.name}: sin errores ni avisos de sintaxis (${what}, comprobado por SAP).`, structured };
    return {
      text: `${obj.name}: ${errs} errores, ${msgs.length - errs} avisos (${what}).\n\n${renderSyntax(msgs)}`,
      isError: errs > 0,
      structured,
    };
  },
});
