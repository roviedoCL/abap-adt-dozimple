# Seguridad — abap-adt-doZimple

Criterio del proyecto: **nada que afecte la ciberseguridad** de los clientes ni de DoZimple. Un cambio que debilite
algo de este documento no se acepta aunque añada funcionalidad.

## Modelo de amenazas

| Activo | Amenaza | Control |
|---|---|---|
| Credenciales SAP | Filtrado en archivos, logs, respuestas o procesos hijo | Llavero del SO (`security`, `execFile` sin shell); la configuración rechaza contraseñas; nunca se escriben en logs ni en respuestas; los procesos hijo reciben solo `HOME`, `PATH`, `USER`, `SHELL`, `TERM` |
| Sistemas SAP | Cambios no deseados por un agente | `read` / `exec` / `write` por tool; `write` solo en DEV con `allowWrite`; QAS y PRD nunca; tools de escritura ocultas si no hay sistema que la permita; sin liberar, importar ni borrar |
| Orden de transporte | El cambio cae en una orden ajena | `decideTransport`: orden explícita obligatoria; si hay bloqueo CTS de otra orden, se para sin escribir |
| Datos sensibles en SAP | Lectura de hashes, almacén seguro o PSE por SQL | `assertNotSensitive` bloquea USR02/USH02/USRPWDHISTORY, RSECTAB/RSECACTB, SSF_PSE_* y columnas de hash, también en subconsultas y JOIN |
| SQL | Escritura o varias sentencias | Solo `SELECT`/`WITH`, sin `;`; la vista previa de ADT es de solo lectura; literales escapados (`sqlLiteral`) |
| Red | Exposición de un puerto | Solo stdio; no se abre ningún puerto |
| TLS | Intercepción (MitM) | Verificación por defecto; `caFile` para certificados propios; `allowSelfSigned` marcado con ⚠ |
| Datos de clientes | Salida a internet vía búsqueda de documentación | Online apagado por defecto; si se habilita, `assertPublicQuery` bloquea objetos Z/Y, namespaces, órdenes, sistemas, SID, usuarios, dominios de host y términos configurados |
| Dependencias de terceros | Vulnerabilidades o código malicioso | 4 dependencias de producción con versión exacta y lockfile; `npm audit` en `npm run security`; los MCP de terceros solo como proceso hijo aislado tras revisión |
| Inyección de instrucciones | Contenido de SAP o de la web que intenta dirigir al agente | Contenido externo marcado como dato; escritura solo por tools explícitas y con política |
| Estado local | Lectura por otros usuarios del equipo | Carpetas `700`, archivos `600`; el registro de uso no guarda argumentos |
| Repositorio | Credenciales o datos de clientes en el historial | `scripts/scan-sensitive.mjs` en `pre-commit` y en `npm run security`, con los términos prohibidos leídos de la configuración local (nunca listados en el repo) |

## Verificación

```sh
npm run security   # npm audit de producción + escáner de credenciales y datos de clientes
npm test           # incluye tests de política: PRD sin escritura, SQL sensible, consultas públicas, orden de transporte
```

## Reportar un problema

Contacto a través de https://dozimple.cl. No publiques detalles de una vulnerabilidad antes de que esté corregida.
