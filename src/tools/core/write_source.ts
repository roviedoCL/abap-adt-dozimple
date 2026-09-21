import { z } from "zod";
import { activateObject } from "../../core/activation.js";
import { isError, renderSyntax, syntaxCheck } from "../../core/checks.js";
import { CLASS_INCLUDES, resolveObject, sourceUrl, TYPE_HELP } from "../../core/objects.js";
import { diffLines, unified } from "../../core/diff.js";
import { assertTrkorr } from "../../core/policy.js";
import { decideTransport, orderHeaders, transportWarnings } from "../../core/transport.js";
import { defineTool } from "../../core/tool.js";

export default defineTool({
  name: "write_source",
  title: "Guardar fuente en SAP",
  description:
    "Sustituye la fuente COMPLETA de un objeto existente (o de un include de clase), en la orden indicada. " +
    "Antes comprueba la sintaxis del código nuevo y, si hay errores, no escribe nada. Si el objeto está bloqueado en " +
    "otra orden, se para y lo explica en vez de guardar donde SAP quiera. Luego activa (activate=false para no hacerlo). " +
    "Para clases, escribe la clase entera en una sola llamada. Llama antes a edit_preflight.",
  access: "write",
  input: {
    object_name: z.string().min(1),
    object_type: z.string().optional().describe(TYPE_HELP),
    include: z.enum(CLASS_INCLUDES).default("main"),
    source: z.string().min(1).describe("Fuente completa nueva"),
    transport: z.string().optional().describe("Orden (o tarea) donde debe ir el cambio. Obligatoria salvo objetos locales"),
    activate: z.boolean().default(true),
    skip_syntax_check: z.boolean().default(false),
  },
  async preview({ object_name, object_type, include, source, transport, activate, skip_syntax_check }, { sap, system }) {
    const requested = transport ? assertTrkorr(transport) : undefined;
    const c = await sap.adt();
    const obj = await resolveObject(c, object_name, object_type);
    const url = await sourceUrl(c, obj, include);
    const current = await c.getObjectSource(url);
    const out = [
      `${obj.name} (${obj.type})${include !== "main" ? ` · include ${include}` : ""} · paquete ${obj.packageName ?? "?"}`,
      `Orden: ${requested ?? "ninguna indicada (solo vale para objetos locales)"} · activar después: ${activate ? "sí" : "no"}`,
    ];
    // Los avisos de la orden van arriba: son lo que más daño hace si se pasa por alto.
    if (requested) {
      const warn = await transportWarnings(sap, requested, system.user);
      out.push(warn.length ? `⚠ AVISOS DE LA ORDEN ${requested}:\n${warn.map((w) => "  ⚠ " + w).join("\n")}` : `Orden ${requested}: modificable, con destino y del usuario de esta conexión.`);
    }
    if (skip_syntax_check) out.push("Sintaxis: NO se comprobará (skip_syntax_check=true).");
    else {
      const msgs = await syntaxCheck(c, obj, url, source);
      out.push(msgs.some(isError) ? `Sintaxis: CON ERRORES, la escritura se detendrá.\n${renderSyntax(msgs)}` : `Sintaxis: sin errores${msgs.length ? ` (${msgs.length} avisos)` : ""}.`);
    }
    const ops = diffLines(current, source);
    if (!ops) out.push("", "Cambio: el objeto se reescribe casi entero (demasiadas diferencias para mostrarlas como diff).");
    else {
      const u = unified(ops, 3);
      const lines = u.text.split("\n");
      out.push("", u.hunks ? `Cambio: +${u.added} −${u.removed} en ${u.hunks} bloques` : "Cambio: ninguno (la fuente es idéntica a la guardada).");
      if (u.hunks) out.push(lines.slice(0, 400).join("\n") + (lines.length > 400 ? `\n[… ${lines.length - 400} líneas más de diff]` : ""));
    }
    out.push("", "Si el objeto está bloqueado en otra orden, la escritura se detendrá sin guardar (compruébalo antes con edit_preflight).");
    return out.join("\n");
  },
  async run({ object_name, object_type, include, source, transport, activate, skip_syntax_check }, { sap }) {
    const requested = transport ? assertTrkorr(transport) : undefined;
    const c = await sap.adt();
    const obj = await resolveObject(c, object_name, object_type);
    const url = await sourceUrl(c, obj, include);

    if (!skip_syntax_check) {
      const msgs = await syntaxCheck(c, obj, url, source);
      if (msgs.some(isError)) {
        return { text: `No se escribió nada: el código nuevo tiene errores de sintaxis.\n\n${renderSyntax(msgs)}`, isError: true };
      }
    }

    const saved = await sap.stateful(async (s) => {
      const lock = await s.lock(obj.uri);
      try {
        const parent = lock.CORRNR ? (await orderHeaders(sap, [lock.CORRNR])).get(lock.CORRNR)?.parent : undefined;
        const d = decideTransport(lock, requested, parent);
        if (!d.ok) return d;
        await s.setObjectSource(url, source, lock.LOCK_HANDLE, d.corrNr || undefined);
        return d;
      } finally {
        await s.unLock(obj.uri, lock.LOCK_HANDLE).catch(() => undefined);
      }
    });

    if (!saved.ok) return { text: saved.reason, isError: true };
    let text = `${obj.name}${include !== "main" ? ` (${include})` : ""} guardado. ${saved.note}`;
    if (!activate) return `${text}\nSin activar (activate=false): queda como versión inactiva.`;
    const act = await activateObject(c, obj);
    text += `\n\n${act.text}`;
    return { text, isError: !act.ok };
  },
});
