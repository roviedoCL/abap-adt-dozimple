# Commit security procedure / Procedimiento de seguridad en cada commit

**English** · [Español](#español)

Leaked credentials and addresses in repositories are one of the most common ways in. This repository never contains
credentials, internal addresses or customer data, and that is checked **on the whole code, every time**, by machines
— not left to memory.

## Four layers

| When | What is checked | Blocks | Enforced by |
|---|---|---|---|
| **Every commit** (`pre-commit`) | The **whole working tree** (tracked and new files) **plus the exact content being committed** (the index, not the disk) | The commit | Local hook |
| **Every push** (`pre-push`) | **Every line ever added** in every commit of every branch | The push | Local hook |
| **Every pull request and push to `main`** (CI) | The whole tree **and the whole history** (full clone) | The merge: `main` requires the CI | GitHub branch protection |
| **Every push to GitHub** | Known provider secrets (tokens of GitHub, npm, AWS, Google, Slack…) | The push | GitHub secret scanning with push protection |

The CI layer cannot be skipped: `main` only accepts changes through a pull request with the CI green, also for
administrators.

## What is detected

- **Credentials:** private keys, AWS/Google keys, GitHub/GitLab/npm/Slack tokens, JWTs, `Authorization` headers
  with a value, passwords and connection strings with a key, assigned secrets (`api_key = "…"`), URLs with user and
  password, webhooks with a secret.
- **Addresses:** real IP addresses (private and public; documentation ranges and loopback are allowed), hosts with
  typical SAP ports (443NN, 80NN, 5NN00…) and internal domains (`.local`, `.corp`, `.internal`, `.intranet`…).
- **Dangerous files, by name:** `.env`, certificates and keys (`.pem`, `.key`, `.p12`, `.pfx`, `.pse`…), SSH keys,
  the real `systems.json`, an `.npmrc` with credentials.
- **Customer data (local only):** system ids, SIDs, users, host domains and private terms read from your local
  configuration (`~/.config/abap-adt-dozimple/`), plus transports with a real SID. The list itself is never in the
  repository.

The value found is **never printed**: only file, line and type.

## Setup, once per clone

```sh
npm run hooks        # = git config core.hooksPath .githooks
```

Run it by hand whenever you want:

```sh
node scripts/scan-sensitive.mjs            # whole tree
node scripts/scan-sensitive.mjs --history  # whole history
npm run security                           # npm audit + registry signatures + both scans
```

## If something is found

1. **Do not bypass it** (`--no-verify` only moves the problem to the CI and to the history).
2. Replace the value with fictitious data (`ZDEMO_*`, `DEVK900123`, `*.example`, `192.0.2.x`) or read it from the
   OS keychain / an environment variable.
3. **If a real secret was already committed or pushed, rotate it immediately**: deleting it from the file does not
   remove it from the history or from existing clones. Then rewrite the history and ask GitHub Support to purge
   cached views.
4. Tools and assistants can write files too (an `npm login` run inside the repository wrote a token into `.npmrc`;
   the scanner stopped it): the check exists precisely so that nobody has to notice.

The tests in `test/scan-sensitive.test.ts` seed fake credentials, addresses and dangerous files in a temporary
repository and require every one to be caught, including a secret committed and later deleted (found in history).

---

## Español

Las credenciales y direcciones filtradas en repositorios son una de las vías de ataque más comunes. Este repositorio
nunca contiene credenciales, direcciones internas ni datos de clientes, y eso se comprueba **sobre el código completo,
siempre**, de forma automática: no depende de acordarse.

### Cuatro capas

| Cuándo | Qué se revisa | Bloquea | Lo garantiza |
|---|---|---|---|
| **Cada commit** (`pre-commit`) | **Todo el árbol** (archivos versionados y nuevos) **más el contenido exacto que entra en el commit** (el índice, no el disco) | El commit | Hook local |
| **Cada push** (`pre-push`) | **Cada línea añadida alguna vez** en todos los commits de todas las ramas | El push | Hook local |
| **Cada pull request y push a `main`** (CI) | Todo el árbol **y todo el historial** (clon completo) | La fusión: `main` exige el CI | Protección de rama en GitHub |
| **Cada push a GitHub** | Secretos de proveedores conocidos (tokens de GitHub, npm, AWS, Google, Slack…) | El push | Secret scanning de GitHub con push protection |

La capa de CI no se puede saltar: `main` solo acepta cambios por pull request con el CI en verde, también para
administradores.

### Qué se detecta

- **Credenciales:** claves privadas, claves de AWS y Google, tokens de GitHub, GitLab, npm y Slack, JWT, cabeceras
  `Authorization` con valor, contraseñas y cadenas de conexión con clave, secretos asignados (`api_key = "…"`), URLs
  con usuario y contraseña, webhooks con secreto.
- **Direcciones:** IPs reales (privadas y públicas; se permiten los rangos de documentación y loopback), hosts con
  puertos típicos de SAP (443NN, 80NN, 5NN00…) y dominios internos (`.local`, `.corp`, `.internal`, `.intranet`…).
- **Archivos peligrosos por su nombre:** `.env`, certificados y claves (`.pem`, `.key`, `.p12`, `.pfx`, `.pse`…),
  claves SSH, el `systems.json` real, un `.npmrc` con credenciales.
- **Datos de clientes (solo en local):** ids de sistema, SID, usuarios, dominios y términos privados leídos de tu
  configuración local (`~/.config/abap-adt-dozimple/`), y órdenes con un SID real. La lista nunca está en el repo.

Nunca se imprime el valor encontrado: solo archivo, línea y tipo.

### Activarlo, una vez por clon

```sh
npm run hooks        # = git config core.hooksPath .githooks
```

Y a mano cuando quieras: `node scripts/scan-sensitive.mjs` (árbol), `--history` (historial), o `npm run security`
(auditoría de dependencias, firmas y los dos escaneos).

### Si salta algo

1. **No lo saltes** (`--no-verify` solo mueve el problema al CI y al historial).
2. Sustituye el valor por datos ficticios (`ZDEMO_*`, `DEVK900123`, `*.example`, `192.0.2.x`) o léelo del llavero o
   de una variable de entorno.
3. **Si un secreto real ya se commiteó o se subió, rótalo de inmediato**: borrarlo del archivo no lo quita del
   historial ni de los clones. Después, reescribir el historial y pedir a GitHub Support la purga de su caché.
4. Las herramientas y los asistentes también escriben archivos (un `npm login` ejecutado dentro del repo escribió un
   token en `.npmrc`; el escáner lo paró): el control existe justamente para que nadie tenga que darse cuenta.
