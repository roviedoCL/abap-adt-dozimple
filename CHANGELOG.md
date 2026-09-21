# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/). Versionado [SemVer](https://semver.org/lang/es/).

## [Unreleased]

### Corregido
- Workflow de release: la comprobación de `latest` fallaba porque npm tarda unos segundos en propagar la etiqueta
  (la 1.0.0 se publicó bien, pero la release de GitHub no se creó y se completó a mano con los artefactos firmados del
  mismo run). Ahora reintenta durante 2 minutos, no republica una versión existente y actualiza la release si ya
  existe: reintentar un run es seguro.

## [1.0.0] - 2026-09-21

Primera versión estable, publicada en npm como `@dozimple/abap-adt` con procedencia.

### Seguridad
- El escáner de datos sensibles detecta tokens de npm y cualquier `_authToken` (p. ej. un `npm login` que escribe en
  el `.npmrc` del proyecto).
- **Parámetros desconocidos rechazados**: una llamada con un parámetro que la tool no declara (p. ej. `transprot` mal
  escrito) falla con la lista de parámetros admitidos y no ejecuta nada; antes se descartaba en silencio.
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
- **`run_atc(explain=N)` y `atc_quickfix(finding=N)` podían devolver el hallazgo de OTRO objeto**: el ATC se recordaba
  solo por sistema, así que pedir la documentación del hallazgo 1 de un objeto devolvía la del último objeto
  analizado, con apariencia correcta. Ahora se recuerda por sistema y objeto u orden; `explain` sobre un objeto aún
  no analizado ejecuta su ATC, y toda respuesta dice de qué objeto y de cuándo es el ATC. Test de regresión.
- Telemetría: un resultado negativo (sintaxis con errores, tests en rojo, activación rechazada) ya no cuenta como
  fallo del servidor; `usage_stats` lo muestra en su propia columna.
- Documentación de hallazgos ATC y correcciones de SAP: las entidades HTML se decodificaban con `&amp;` antes que el
  resto, así que un texto como `&amp;#39;` terminaba en `'` (doble desescape). Ahora hay un único limpiador de HTML
  (`core/feeds.ts`) que decodifica una sola vez y quita etiquetas hasta que no queda ninguna. Detectado por CodeQL.
- `edit_preflight`: el nombre del objeto se insertaba en la expresión regular que busca bloqueos del CTS escapando
  solo `/` y `$`; ahora se escapan todos los metacaracteres. Detectado por CodeQL.
- La comprobación de vistas y CDS bloqueaba CDS estándar legítimas como `I_USER`: los valores de sus anotaciones
  (`#CDS_MODELING_ASSOCIATION_TARGET`, 31 caracteres) se enviaban como nombres de vista a DD26S, cuyo campo es
  C(30). Detectado al probar contra un sistema real, no en fixtures; cubierto por test de regresión.

- NW 7.50 (validado en vivo en ECC 6.0 EHP8): `run_atc` sobre una orden hace una corrida única sobre sus objetos
  cuando el release no admite la orden como conjunto ATC; `edit_preflight` acota las órdenes candidatas a 10; el
  smoke test no aborta ante una llamada lenta.

### Añadido
- Workflow de release (`release.yml`): al crear un tag `vX.Y.Z`, tests, auditoría, escáner, paquete con atestación de
  procedencia (Sigstore) y SBOM; tras la aprobación manual del environment `release`, publicación en npm con
  procedencia por trusted publishing (OIDC, sin tokens guardados) y release de GitHub con paquete, atestación y SBOM.
- **`function_modules`**: módulos de función de un grupo (texto en el idioma de la conexión, tipo RFC / actualización),
  o el grupo y los hermanos de un módulo. Funciona con namespaces.
- **`run_atc` sobre implementaciones de ampliación** (`object_type: ENHO`, cualquier subtipo).
- **`close_gap`**: marca como resuelto un hueco anotado con `report_gap`, con una nota, sin borrarlo; `usage_stats`
  separa pendientes y cerrados.
- **Tipo de objeto resuelto cuando la coincidencia es única**: pedir `PROG` para un include o `TABL` para una
  estructura resuelve el objeto y la respuesta lo anota («se pidió PROG X; en el sistema es PROG/I»). Un grupo de
  funciones nunca se toma por un módulo: el error indica cómo listar sus módulos.
- **Avisos de la orden antes de escribir** (vista previa de `write_source` y `write_text_elements`, `edit_preflight`
  y tras `create_transport`): orden sin sistema destino (lo guardado no viajaría), orden o tarea de otra persona,
  orden no modificable.

### Cambiado
- Paquete npm `@dozimple/abap-adt` (antes `abap-adt-dozimple`, privado): solo `dist`, documentación, licencias,
  ejemplo de configuración y `set-password.sh`; la versión que anuncia el servidor sale de `package.json`.
- Licencia: Apache-2.0 (antes, todos los derechos reservados). El componente SAP de DoZimple Transport Risk sigue
  siendo propietario y no forma parte del repositorio.
- README principal en inglés, con versión en español en `README.es.md`.
