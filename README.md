# abap-adt-doZimple

**MCP de [DoZimple](https://dozimple.cl) para SAP ABAP.** Da a los agentes de IA (Claude Code, Kiro, cualquier
cliente MCP) acceso seguro y verificable a sistemas SAP: leer y revisar código, analizar órdenes de transporte,
ejecutar ATC y ABAP Unit, diagnosticar incidentes y — donde se habilite — guardar cambios con la orden correcta.

Un solo servidor para todos los sistemas SAP (ECC 6.0 / NW 7.50 y S/4HANA), que en cada sistema publica solo lo que
ese sistema soporta y que crece añadiendo un archivo por tool.

- Motor ADT: [`abap-adt-api`](https://github.com/marcellourbani/abap-adt-api) (MIT): cada tool es una capa fina
  sobre un método probado, sin reimplementar el protocolo.
- **45 tools** — 34 de SAP y 7 de documentación siempre disponibles, más 4 de escritura que solo aparecen donde se
  habilitan — y 3 flujos guiados.
- **Seguridad primero**: solo stdio, credenciales en el llavero del sistema operativo, nunca escribe en calidad ni
  productivo, bloquea la lectura de material de credenciales en SAP y filtra lo que sale a internet.

## Por qué

| | MCP ADT comunitario típico | MCP de extensión de IDE | Aceleradores de proveedores cloud | **abap-adt-doZimple** |
|---|---|---|---|---|
| Necesita el IDE abierto | No | Sí | No | No |
| Multi-sistema con roles | No | Sí, sin roles | Parcial | Sí: DEV / QAS / PRD con política distinta |
| Elegir la orden al guardar | — | No | Suele elegirla solo | Explícita; se para ante un bloqueo CTS ajeno |
| Resultado ante un fallo | Errores opacos | Correcto | Falsos verdes frecuentes | Error tipado; nunca vacío ni «OK» |
| Endpoints según release | Fijos | Fijos | Pensados para ABAP Cloud | Leídos del discovery de cada sistema |
| Tools por producto o cliente | — | — | — | Módulos que solo existen donde se habilitan |
| MCP de terceros | Dependencias mezcladas | — | — | Aislados como proceso hijo y filtrados |

La regla principal del servidor: **un fallo nunca se presenta como resultado vacío o como éxito**.

## Qué resuelve

**Revisión de código y pases**
- `transport_diff` — qué cambia de verdad una orden: por objeto, la versión grabada con la orden contra la anterior,
  en diff unificado y con la calidad de la evidencia.
- `transport_contents`, `co_change` (compañeros habituales que faltan en la orden), `inactive_objects`,
  `edit_preflight` (bloqueo CTS ajeno, objeto local, reparación, antes de tocar nada).

**Calidad y remediación ATC**
- `run_atc` (objeto u orden; P1/P2/P3; documentación del check con `explain`), `atc_quickfix` (las correcciones que
  ofrece SAP, calculadas sin guardar, con diff y sintaxis), `api_release_state` (estado de liberación y sucesor, en
  S/4), `syntax_check` (sintaxis real de SAP, también sobre código no guardado), `run_unit_tests`.

**Lectura y análisis**
- `get_source` (cualquier objeto; módulos de función sin saber el grupo; tablas en 7.50 vía DD03L), `search_objects`,
  `where_used`, `object_versions`, `sql_query` y `table_contents`, `package_contents`, `ddic_type_info`,
  `transaction_info`, `text_elements`.

**Diagnóstico de incidentes**
- `dumps` (ST22 con detalle), `jobs` (SM37), `application_log` (SLG1), `gateway_errors` (/IWFND/ERROR_LOG).

**Documentación SAP** (componente «docs», local)
- `abap_feature_matrix` («¿existe esta sintaxis en 7.50?»), `docs_search`/`docs_fetch` (keyword docs, Clean ABAP,
  DSAG, cheat sheets, RAP), `clean_core_objects`/`clean_core_object`, `abap_lint`, `docs_community_search`
  (solo con búsqueda online habilitada).

**Escritura** (solo en desarrollo y con `allowWrite`)
- `write_source` (chequea sintaxis → bloquea → decide la orden → guarda → activa), `activate`,
  `write_text_elements`, `create_transport`.

**Módulo `dz-transport-risk`** — ver [DoZimple Transport Risk](#dozimple-transport-risk) más abajo.

**Flujos guiados** (prompts MCP): `revisar_pase`, `remediar_atc`, `diagnosticar_ticket`.

**Crecimiento**: `report_gap` anota lo que ninguna tool cubre; `usage_stats` cruza esos huecos con el uso real para
decidir la siguiente tool. `sap_systems` muestra sistemas, conexión, release y qué funciona en cada uno.

## DoZimple Transport Risk

Módulo de este MCP para el producto **DoZimple Transport Risk**: dice, antes de liberar, si una orden o un pase
entero se puede llevar a calidad o productivo, y por qué no, en lenguaje de negocio para PMO, de consultor y de Basis.

| Tool | Qué responde |
|---|---|
| `analyze_transport_risk` | ¿Es seguro este pase? Tareas sin liberar, dependencias que no viajan (código y diccionario), acceso posicional que se rompe en silencio, bloqueos del CTS, colisiones, secuencia de importación y estado real en la cola |
| `import_health` | ¿Cómo van las importaciones a un destino? |
| `failure_ranking` | ¿Qué objetos fallan más al importar? |
| `change_audit` | Evidencia para auditoría de gestión de cambios |
| `object_transport_history` | ¿Qué órdenes tocaron este objeto y cuáles llegaron ya? |
| `remote_source` | El código tal como está hoy en el destino |
| `transport_source_check` | El código de una orden contra el destino: objetos ausentes y deriva de versión |

Funciona sobre cualquier pila ABAP con CTS (ECC y S/4HANA) y es de solo lectura en todos los sistemas. Requiere un
**componente SAP propietario de DoZimple** (servicio ICF en desarrollo y RFC de solo lectura en los destinos) que no
se distribuye en este repositorio. **Para implantarlo en su landscape: [dozimple.cl](https://dozimple.cl).**

Las tools solo aparecen en los sistemas que declaran `"modules": ["dz-transport-risk"]`; sin el componente instalado,
responden indicando qué falta y cómo obtenerlo.

## Garantías que aplica el servidor a cada tool

Las aplica `core/registry.ts → invoke()`, no cada tool:

1. **Sistema explícito.** Parámetro `system` > `ABAP_DZ_DEFAULT_SYSTEM` > `defaultSystem` > único configurado. Si
   hay varios y ninguno indicado, pide elegir. Cada respuesta empieza con `Sistema: X (de dónde salió)`.
2. **Política por rol.** `read` en todo sistema; `exec` solo en DEV; `write` solo en DEV con `allowWrite`. QAS y PRD
   no se escriben nunca, aunque se configure. Las tools de escritura no se publican si ningún sistema la permite.
3. **Capacidad.** El discovery ADT de cada sistema (caché de 7 días) es una pista, no un veto: la tool se intenta y
   solo un 404 real sobre un endpoint ausente del discovery se informa como `CAPABILITY`.
4. **Módulos y componentes.** Una tool de módulo solo existe en los sistemas que lo habilitan; una de un componente
   de terceros, solo si está configurado.
5. **Errores honestos.** `NETWORK`, `AUTH`, `NOT_FOUND`, `SAP`, `POLICY`, `CAPABILITY`, `MODULE`, `INPUT`; siempre
   con «no interpretes esto como un resultado vacío».
6. **Salida acotada.** 80.000 caracteres; lo recortado se dice, con cómo pedir el resto.
7. **Registro de uso local**: tool, sistema, duración, resultado y tipo de fallo. Nunca argumentos.

## Seguridad

Resumen; el modelo de amenazas completo está en [SECURITY.md](SECURITY.md).

| Riesgo | Cómo se cubre |
|---|---|
| Superficie de red | Solo stdio: no abre puertos. Llamadas salientes solo a los SAP configurados y, si se habilita, a la búsqueda de documentación (filtrada) |
| Credenciales | Llavero del sistema operativo; nunca en archivos, logs ni respuestas. La configuración rechaza contraseñas |
| TLS | Verificado por defecto; certificado propio con `caFile`. `allowSelfSigned` es último recurso y se marca con ⚠ |
| Material de credenciales en SAP | `sql_query` y `table_contents` bloquean hashes de contraseñas, almacén seguro y PSE, aunque el usuario SAP tenga autorización |
| Escritura | Desactivada por defecto; solo DEV con `allowWrite`; nunca liberar, importar ni borrar |
| MCP de terceros | Solo como proceso hijo aislado, con entorno mínimo; tools re-publicadas bajo esta política |
| Datos que salen a internet | Búsqueda online apagada por defecto; si se habilita, se bloquea toda consulta con objetos Z/Y, órdenes, sistemas, usuarios o nombres de cliente |
| Inyección de instrucciones | Contenido de SAP y de documentación marcado como dato; la escritura exige tools explícitas y política |
| Datos locales | Carpetas `700` y archivos `600`; el registro de uso no guarda argumentos |
| Cadena de suministro | 4 dependencias de producción con versión exacta y lockfile; `npm run security` (audit + escáner) |
| Repositorio | Sin credenciales ni datos de clientes: el escáner `pre-commit` lo verifica contra la configuración local |

## Instalación

```sh
npm ci && npm run build
mkdir -p ~/.config/abap-adt-dozimple
cp config/systems.example.json ~/.config/abap-adt-dozimple/systems.json   # editar sistemas y roles
scripts/set-password.sh MI_DEV                                           # pide la clave; va al llavero
npm run smoke -- MI_DEV                                                  # solo lecturas
git config core.hooksPath .githooks                                      # escáner antes de cada commit
```

Registro en un cliente MCP (por ejemplo `.mcp.json` de un proyecto):

```json
{ "mcpServers": { "abap-adt-doZimple": { "command": "node", "args": ["/ruta/a/abap-adt-doZimple/dist/index.js"] } } }
```

Componente de documentación (opcional): instalar `mcp-sap-docs` revisado en una carpeta `vendor/` y declararlo en
`sidecars.docs` (ver `config/systems.example.json`).

## Cómo crece

**Añadir una tool = añadir un archivo** en `src/tools/<área>/`; el registro la carga sola. Guía y plantilla: skill
[`nueva-tool`](.claude/skills/nueva-tool/SKILL.md). Un MCP de terceros se integra como componente aislado
(`sidecars.<nombre>`), nunca como dependencia de este proceso.

### Siguientes candidatas

| Candidata | Cómo | Para qué |
|---|---|---|
| `atc_exemption` | `atcExemptProposal` / `atcRequestExemption` (escritura, orden explícita) | Supresiones justificadas y trazables |
| `cds_sql` | `POST /sap/bc/adt/ddic/ddl/createstatements/{name}` (verificar en 7.50) | Rendimiento de vistas CDS |
| `compare_systems` | `get_source` en dos sistemas + `diffLines` | Diff DEV ↔ QAS ↔ PRD |
| `create_object` con orden | `validateNewObject`, `createObject` | Atar el objeto entero a una orden |
| `odata_get` | GET de solo lectura reutilizando la sesión | Validar conteos de servicios OData |
| `enhancements` | `objectEnhancements` + tablas de BAdI | Exits y BAdIs de un objeto |
| Puerta de calidad por orden | `run_atc(transport)` + `run_unit_tests` | Veredicto de calidad del pase |

---

© 2026 [DoZimple](https://dozimple.cl). Todos los derechos reservados — ver [LICENSE](LICENSE). Incluye software de
terceros bajo sus licencias: ver [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
