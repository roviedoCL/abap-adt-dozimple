---
name: nueva-tool
description: Añadir una tool al MCP abap-adt-doZimple. Úsala cuando el usuario pida una tool nueva, cuando usage_stats muestre un hueco repetido, o al convertir un rodeo manual (SE11, SE01, SQL a mano) en tool.
---

# Añadir una tool a abap-adt-doZimple

Una tool es **un archivo** en `src/tools/<área>/<nombre>.ts` que exporta por defecto `defineTool({...})`
(o un array). El registro la carga sola: no hay que tocar `index.ts`.

## 1. Antes de escribir

1. **¿Existe ya?** `grep -rn "name:" src/tools`. Si una tool casi lo hace, amplíala.
2. **¿Qué método de `abap-adt-api` lo cubre?**
   `grep -nE '^\s+[a-zA-Z]+\(' node_modules/abap-adt-api/build/AdtClient.d.ts`. Casi todo lo que hace Eclipse
   está ahí. Si no está, las tablas de sistema por `sap.query(...)` suelen bastar (E070/E071, TADIR, TLOCK,
   DD03L, TMSBUFREQ…).
3. **¿Qué endpoint ADT usa?** Míralo en el `.js` del método (`grep -n "function <método>" -A15
   node_modules/abap-adt-api/build/api/*.js`) y ponlo en `requires.adt`. No apaga la tool: si SAP responde 404 y
   el discovery tampoco lo lista, el error sale como `CAPABILITY` en vez de «no encontrado». El discovery no es
   exhaustivo (en un S/4 2023 `/runtime/dumps` funciona sin figurar), así que nunca lo uses para afirmar que algo falta.
3b. **Cabecera `Accept`**: si llamas a `c.httpClient.request` a mano, prueba los tipos que acepta el recurso; un
   `406` significa tipo no aceptado, no que el recurso no exista (el dump da 406 con `text/plain`, va con `text/html`).
4. **Acceso**: `read`, `exec` (ejecuta código: solo DEV), `write` (modifica: solo DEV con allowWrite), `local`.
   ¿Es de un solo cliente? → `requires.module` y carpeta `src/tools/<cliente>/`.
5. **¿Viene de un MCP de terceros?** Nunca como dependencia npm de este proceso. Primero la revisión de seguridad
   (veredicto APTO / CON CONDICIONES en `../vendor/README.md`), después instalarlo en `../vendor/`, declararlo en
   `sidecars.<nombre>` de `systems.json` y envolver solo las tools útiles en `src/tools/<nombre>/` con
   `requires: { sidecar: "<nombre>" }` (y `online: true` si envían la consulta a internet; entonces pasar la consulta
   por `assertPublicQuery`). Modelo: `src/tools/docs/docs.ts`.

## 2. Plantilla

```ts
import { z } from "zod";
import { resolveObject, TYPE_HELP } from "../../core/objects.js";
import { defineTool } from "../../core/tool.js";

export default defineTool({
  name: "verbo_objeto",                // snake_case, único
  title: "Título corto en español",
  description:
    "Qué hace y CUÁNDO usarla (es lo que lee el modelo para elegirla). Límites conocidos incluidos.",
  access: "read",
  requires: { adt: ["/sap/bc/adt/..."] },
  input: {
    object_name: z.string().min(1),
    object_type: z.string().optional().describe(TYPE_HELP),
  },
  async run({ object_name, object_type }, { sap, system }) {
    const c = await sap.adt();                       // cliente de lectura (stateless)
    const obj = await resolveObject(c, object_name, object_type);
    // ... llamada a abap-adt-api ...
    return "texto";                                  // o { text, isError: true }
  },
});
```

`system` no se declara: el registro lo añade a toda tool que no sea `local`.

## 3. Reglas que no se negocian

- **Nunca convertir un fallo en vacío o en éxito.** Deja que la excepción suba (el registro la clasifica) o
  lanza `new ToolError(kind, mensaje, pista)`. Si la operación se ejecutó y no hay datos, dilo: «se ejecutó y no
  devolvió filas», no `""`.
- **Resultado negativo = `isError: true`**: activación fallida, tests rojos, sintaxis con errores.
- **Topes explícitos**: si hay límite de filas o de objetos, avisa cuando se alcanza.
- **Escritura**: usa `sap.stateful(async (s) => { lock → ... → finally unLock })` y `decideTransport` para la
  orden. Nunca elijas una orden por el usuario.
- **Nada de credenciales** en salidas ni logs. Logs solo a `stderr` (stdout es el canal MCP).
- **No exponer** liberar/borrar órdenes ni borrar objetos.

## 4. Probar

1. Test en `test/`: la lógica pura (decisiones, parseos) con datos controlados; la llamada a SAP es fontanería.
   Los tests deben usar `ABAP_DZ_STATE_DIR` temporal (ya lo hacen los existentes con `beforeAll`).
2. `npm test && npm run build`.
3. `npm run smoke -- <SISTEMA>` o, para la tool nueva, una llamada real desde el cliente tras reconectar el MCP
   (`/mcp` en Claude Code). Probar en un ECC 7.50 y en un S/4 si la tool aspira a ambos.
4. Añadir la fila en la tabla de tools del README y quitarla de «Siguientes candidatas».
