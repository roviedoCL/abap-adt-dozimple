import type { ADTClient } from "abap-adt-api";
import type { ResolvedObject } from "./objects.js";

export interface ActivationOutcome {
  ok: boolean;
  text: string;
}

/**
 * Activa y lo cuenta tal cual: errores, avisos y objetos que quedan
 * inactivos. Un fallo nunca se presenta como «ya estaba activo».
 */
export async function activateObject(c: ADTClient, obj: ResolvedObject): Promise<ActivationOutcome> {
  const r = await c.activate(obj.name, obj.uri);
  const errors = r.messages.filter((m) => ["E", "A", "X"].includes(m.type?.toUpperCase()));
  const lines = r.messages.map((m) => `  ${m.type}${m.line ? ` L${m.line}` : ""}  ${m.shortText}${m.objDescr ? `  [${m.objDescr}]` : ""}`);
  const inactive = r.inactive
    .map((i) => i.object?.["adtcore:name"])
    .filter(Boolean);
  const ok = r.success && errors.length === 0;
  const text =
    (ok ? `${obj.name} activado.` : `${obj.name} NO se activó.`) +
    (lines.length ? `\n\nMensajes:\n${lines.join("\n")}` : "") +
    (inactive.length ? `\n\nQuedan inactivos (actívalos juntos si dependen entre sí): ${inactive.join(", ")}` : "");
  return { ok, text };
}
