# abap-adt-doZimple

Servidor MCP de DoZimple (TypeScript, stdio) para SAP ABAP sobre `abap-adt-api`. Visión general, garantías y tools:
`README.md`. Modelo de amenazas: `SECURITY.md`. Para añadir una tool: skill `nueva-tool`.

- `src/core/` — configuración, credenciales (llavero), conexión y discovery, política, errores, registro
  (`invoke()` aplica todas las garantías), salida, telemetría, componentes aislados (`sidecar.ts`).
- `src/tools/<área>/` — una tool por archivo: `core/` común, `local/` sin SAP, `docs/` componente de documentación,
  `transport-risk/` módulo DoZimple Transport Risk.
- Configuración de sistemas fuera del repo: `~/.config/abap-adt-dozimple/systems.json` (sin contraseñas).

Comandos: `npm test`, `npm run build`, `npm run security`, `npm run smoke -- <SISTEMA>` (solo lecturas).

Reglas:
- Nunca convertir un fallo en vacío/éxito; nunca elegir orden de transporte por el usuario; nada de liberar ni
  borrar; sin credenciales en salidas; logs a stderr.
- **El repositorio no contiene credenciales ni datos de clientes** (nombres, hosts, usuarios, órdenes, objetos,
  tickets). En ejemplos y tests, datos ficticios: `ZDEMO_*`, `DEVK900123`, `*.example`. El hook `pre-commit`
  (`scripts/scan-sensitive.mjs`) lo comprueba contra la configuración local.
- Tras cambiar código: `npm run build` y reconectar el MCP en el cliente.
