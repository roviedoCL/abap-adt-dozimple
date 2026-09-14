# Contributing to abap-adt-doZimple

**English** · [Español](#contribuir-español)

Thanks for helping. This server talks to real SAP systems, so the bar is: **nothing that weakens security or turns a
failure into a false success.**

## Reporting bugs and requesting features
- Bugs and feature requests: [GitHub issues](../../issues). Include version or commit, SAP release (e.g. NW 7.50,
  S/4HANA 2023), the tool, what you expected and what happened.
- **Security vulnerabilities: never in a public issue.** Follow [SECURITY.md](SECURITY.md).
- **Never paste customer data** (system names, hosts, users, transports, Z objects, tickets, credentials) in issues,
  PRs or commits. Use fictitious data: `ZDEMO_*`, `DEVK900123`, `*.example`.

## Development setup
```sh
npm ci --ignore-scripts
git config core.hooksPath .githooks   # pre-commit scanner for secrets and customer data
npm run check                         # tests + build + npm audit + signatures + scanner
```
Node.js 22+. To try tools against a system, see *Installation* in the [README](README.md); `npm run smoke -- <SYSTEM>`
only reads.

## Pull requests
- `main` is protected: every change goes through a PR and the CI must pass (tests, build, audit, registry signatures,
  SBOM, secret scanner, generated docs up to date). CodeQL runs on every PR.
- Commit messages with a prefix: `feat:`, `fix:`, `sec:`, `docs:`, `chore:`, `ci:`, `revert:`.
- If you change a tool's description, parameters or the catalog, run `npm run docs` and commit the regenerated
  `README.md`, `README.es.md` and `docs/TOOLS.md`.
- Adding a tool = adding one file; follow the [`nueva-tool`](.claude/skills/nueva-tool/SKILL.md) guide.

## Test policy
- **Every new tool, behaviour change or bug fix comes with automated tests** in `test/` (Vitest, `npm test`).
- **Security controls need adversarial tests**: show the attack or misuse is blocked (e.g. a view that reads a vetoed
  table, a write without confirmation, a tampered audit log), not only the happy path.
- Tests use fictitious data and a temporary state directory (`ABAP_DZ_STATE_DIR`); they never need a SAP system.
- Logic that depends on a SAP release is validated live on at least one system before release, and the result is
  noted in the PR.

## Code standards
- TypeScript with `strict: true`; the build must have no type errors.
- Never convert an error into an empty result or success; use typed errors (`ToolError`).
- No credentials in outputs or logs; logs go to stderr (stdout is the MCP channel).
- Match the surrounding style. Code comments and tool descriptions are in Spanish; English contributions are welcome.

By contributing you agree your contribution is licensed under the [Apache License 2.0](LICENSE).

---

## Contribuir (español)

- **Errores y propuestas:** en [issues](../../issues), con versión o commit, release SAP, tool, qué esperabas y qué pasó.
- **Vulnerabilidades:** nunca en un issue público; ver [SECURITY.md](SECURITY.md).
- **Nunca datos de clientes** en issues, PRs ni commits: usa datos ficticios (`ZDEMO_*`, `DEVK900123`, `*.example`).
- **Entorno:** `npm ci --ignore-scripts`, `git config core.hooksPath .githooks` y `npm run check` antes de abrir la PR.
- **PRs:** `main` está protegida; CI obligatorio; prefijos de commit; `npm run docs` si cambias descripciones o el catálogo.
- **Política de tests:** toda tool nueva, cambio de comportamiento o corrección trae tests automáticos; los controles
  de seguridad, tests adversariales; nada de datos reales; lo que depende del release SAP se valida en vivo antes de
  publicar.
- **Código:** TypeScript `strict`; errores tipados, nunca vacíos ni éxitos falsos; sin credenciales en salidas; logs a
  stderr.

Al contribuir aceptas que tu aporte se licencia bajo [Apache-2.0](LICENSE).
