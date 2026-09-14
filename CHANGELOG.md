# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/). Versionado [SemVer](https://semver.org/lang/es/).

## [Unreleased]

### Seguridad
- **Escrituras con confirmación humana obligatoria.** `write_source`, `activate`, `write_text_elements` y
  `create_transport` devuelven primero una vista previa (sintaxis real de SAP y diff) y solo escriben tras la
  confirmación: por elicitación MCP si el cliente la soporta, o con un token de un solo uso atado a tool, sistema y
  argumentos exactos (10 minutos). Anotación MCP `destructiveHint` en las tools de escritura.
- **Registro de auditoría encadenado por hash** (`audit.jsonl`) de toda escritura y ejecución: intención, resultado y
  denegaciones, con la huella sha256 del contenido y nunca el contenido. Fail-closed: sin registro no se escribe
  (probado con disco lleno y permiso denegado). Verificación con `npm run audit:verify`.
- **Clases de datos por sistema** (`test` / `masked` / `prod`): en sistemas con datos productivos, columnas personales
  enmascaradas, prohibición de usarlas en WHERE, alias o expresiones, y tope de filas (200 por defecto).
- **Veto de material sensible también a través de vistas y CDS**: resolución de tablas base por DD26S y
  DDLDEPENDENCY + fuente DDL, hasta 3 niveles, falla cerrado. Nuevos vetos: datos de personal (PA\*, PB\*, PCL1-5,
  HRPY_\*), USRACL, SNAP y OA2C_\*. Validado contra un S/4HANA 2023 real: bloquea la vista estándar
  `PUSER_ADDR_EMAIL` y la CDS `P_USER_ADDR`, que leen USR02 sin nombrarla.
- `table_contents`: el filtro ya no admite subconsultas, UNION, comentarios ni comillas sin cerrar.
- ABAP Unit solo ejecuta tests `RISK LEVEL HARMLESS` y `DURATION SHORT`, de forma explícita.
- Componente de documentación con entorno explícito mínimo; `docs_fetch` valida la forma de los ids y los ids online
  pasan el filtro de datos de cliente.
- `systems.json` se rechaza si otros usuarios pueden modificarlo; el sistema por defecto por variable de entorno se
  identifica en cada respuesta y, si no existe, es error.
- Toda respuesta con contenido de SAP se marca como dato, nunca instrucciones.
- Credenciales en Linux vía Secret Service (`secret-tool`); `set-password.sh --strict` (opt-in) en macOS.
- Cadena de suministro: `ignore-scripts`, `npm audit signatures` y SBOM CycloneDX en CI.
- Nuevo [modelo de amenazas](docs/THREAT_MODEL.md) (STRIDE y OWASP Top 10 para aplicaciones LLM) y política de
  divulgación coordinada a 90 días.

### Corregido
- La comprobación de vistas y CDS bloqueaba CDS estándar legítimas como `I_USER`: los valores de sus anotaciones
  (`#CDS_MODELING_ASSOCIATION_TARGET`, 31 caracteres) se enviaban como nombres de vista a DD26S, cuyo campo es
  C(30). Detectado al probar contra un sistema real, no en fixtures; cubierto por test de regresión.

- NW 7.50 (validado en vivo en ECC 6.0 EHP8): `run_atc` sobre una orden hace una corrida única sobre sus objetos
  cuando el release no admite la orden como conjunto ATC; `edit_preflight` acota las órdenes candidatas a 10; el
  smoke test no aborta ante una llamada lenta.
