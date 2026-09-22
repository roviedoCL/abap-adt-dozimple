/**
 * Pruebas basadas en propiedades (fast-check) de las funciones que reciben entrada hostil: el filtro de
 * `table_contents`, el saneado de errores, el HTML de la documentación y los feeds, los nombres que acaban en una
 * ruta ADT y la huella de los tokens de confirmación.
 *
 * Los tests de ejemplo comprueban los casos que ya conocemos; estos generan miles de entradas por ejecución y
 * afirman la **invariante**: lo que la función garantiza para cualquier entrada, no para una concreta.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { argsDigest, consumeToken, issueToken, stateOf } from "../src/core/confirm.js";
import { ToolError, sanitizeMessage } from "../src/core/errors.js";
import { htmlToText, neutralizeMarkup } from "../src/core/feeds.js";
import { adtPathName } from "../src/core/objects.js";
import { SAP_USER_RE } from "../src/core/policy.js";
import { assertSafeFragment } from "../src/tools/core/table_contents.js";

const runs = Number(process.env.FC_RUNS ?? 500);
const cfg = { numRuns: runs } as const;

/** Texto arbitrario, incluidos sustitutos sueltos y caracteres de control. */
const anyText = fc.string({ unit: "binary", maxLength: 400 });

describe("filtro de table_contents: solo condiciones", () => {
  const accepts = (s: string) => {
    try {
      assertSafeFragment(s, "where");
      return true;
    } catch (e) {
      expect(e).toBeInstanceOf(ToolError);
      return false;
    }
  };

  it("nunca acepta texto arbitrario que introduzca una cláusula o comillas sin cerrar", () => {
    // La propiedad que importa: por mucho que se combine, nada de lo que acepta contiene una segunda sentencia.
    const column = fc.constantFrom("werks", "lvorm", "matnr", "/dz/campo", "t~bukrs");
    const literal = fc.constantFrom("'1000'", "'X'", "''", "42", "3.14");
    const op = fc.constantFrom("=", "<>", ">=", "<=", "<", ">", "!=");
    const benigna = fc.tuple(column, op, literal).map(([c, o, l]) => `${c} ${o} ${l}`);
    const peligroso = fc.constantFrom(
      "UNION SELECT * FROM usr02",
      "; DELETE FROM lfa1",
      "AND ( SELECT single bname FROM usr02 ) = 'X'",
      "FOR UPDATE",
      "AND bname LIKE 'A%' INTO TABLE lt",
      "AND 'sin cerrar",
      "UP TO 1 ROWS",
      "CLIENT SPECIFIED",
      "INNER JOIN usr02 ON x = y",
      "GROUP BY bname",
      "ORDER BY bname",
      "BYPASSING BUFFER",
    );
    fc.assert(
      fc.property(benigna, peligroso, fc.boolean(), (ok, malo, antes) => {
        expect(accepts(antes ? `${malo} AND ${ok}` : `${ok} AND ${malo}`)).toBe(false);
      }),
      cfg,
    );
  });

  it("acepta las condiciones bien formadas que el usuario espera poder escribir", () => {
    // Una columna que se llame como una palabra de ABAP SQL se rechaza a propósito (un campo «BY» es indistinguible
    // de un «ORDER BY»), así que el generador las evita: aquí se comprueba que no hay rechazos de más.
    const RESERVADAS =
      /^(select|from|where|join|inner|outer|left|right|cross|union|intersect|except|into|group|order|by|having|up|to|rows|client|specified|using|exists|all|any|some|for|update|delete|insert|modify|distinct|single|with|as|case|when|then|else|end|bypassing|buffer|connection|appending|package|size|offset|fields|and|or|not|like|in|between|is|null|initial|escape)$/i;
    const column = fc.stringMatching(/^[A-Za-z_][A-Za-z0-9_]{0,20}$/).filter((c) => !RESERVADAS.test(c));
    const literal = fc.oneof(
      fc.integer({ min: 0, max: 999999 }).map(String),
      fc.stringMatching(/^[A-Za-z0-9 _.-]{0,10}$/).map((s) => `'${s}'`),
    );
    fc.assert(
      fc.property(fc.array(fc.tuple(column, literal), { minLength: 1, maxLength: 6 }), fc.boolean(), (pares, entre) => {
        const cond = pares.map(([c, l]) => `${c} = ${l}`).join(entre ? " AND " : " OR ");
        expect(accepts(cond)).toBe(true);
        expect(accepts(`( ${cond} )`)).toBe(true);
        expect(accepts(`NOT ( ${cond} )`)).toBe(true);
      }),
      cfg,
    );
  });

  it("los paréntesis sobrantes siempre se rechazan, en cualquier posición", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5 }), fc.boolean(), (n, abre) => {
        const cond = "werks = '1000'";
        expect(accepts(abre ? "(".repeat(n) + cond : cond + ")".repeat(n))).toBe(false);
      }),
      cfg,
    );
  });

  it("acepta o lanza ToolError, nunca otro error, con cualquier entrada", () => {
    fc.assert(
      fc.property(anyText, (s) => {
        accepts(s); // accepts() ya afirma que todo fallo es ToolError (mensaje para el usuario, no un fallo interno)
      }),
      cfg,
    );
  });
});

describe("saneado de mensajes de error", () => {
  it("no deja pasar la contraseña de una URL con credenciales", () => {
    const secreto = fc.stringMatching(/^[A-Za-z0-9]{8,20}$/);
    fc.assert(
      fc.property(secreto, secreto, fc.stringMatching(/^[a-z]{3,10}$/), anyText, (user, pass, host, cola) => {
        fc.pre(!cola.includes(pass));
        const out = sanitizeMessage(`Error al conectar con https://${user}:${pass}@${host}.example/path ${cola}`, 5000);
        expect(out).not.toContain(pass);
      }),
      cfg,
    );
  });

  it("no deja pasar el valor de una cabecera Authorization", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[A-Za-z0-9+/=]{12,40}$/), fc.constantFrom("Basic", "Bearer"), (tok, tipo) => {
        expect(sanitizeMessage(`{"authorization": "${tipo} ${tok}"}`, 5000)).not.toContain(tok);
      }),
      cfg,
    );
  });

  it("respeta el tope de longitud y no deja marcado con forma de etiqueta", () => {
    fc.assert(
      fc.property(anyText, fc.integer({ min: 10, max: 200 }), (s, max) => {
        const out = sanitizeMessage(s, max);
        expect(out.length).toBeLessThanOrEqual(max + 1); // +1 por el «…» del recorte
        expect(out).not.toMatch(/<[^>]{0,200}>/);
        expect(out).not.toMatch(/[\n\r\t]/); // una sola línea: no puede imitar la estructura de una respuesta
      }),
      cfg,
    );
  });
});

describe("HTML de documentación y feeds", () => {
  it("el texto resultante nunca contiene una etiqueta, aunque venga escapada o doblemente escapada", () => {
    const trozos = fc.constantFrom(
      "<script>alert(1)</script>",
      "&lt;script&gt;",
      "&amp;lt;img src=x onerror=1&amp;gt;",
      "&#60;iframe&#62;",
      "<!-- comentario -->",
      "<p>texto</p>",
      "</td><td>",
      "&amp;#39;",
      "a < b y c > d",
      "<?xml version='1.0'?>",
    );
    fc.assert(
      fc.property(fc.array(fc.oneof(trozos, anyText), { maxLength: 8 }), (partes) => {
        const out = htmlToText(partes.join(""));
        expect(out).not.toMatch(/<[A-Za-z!/?]/); // ninguna apertura con forma de etiqueta sobrevive
      }),
      cfg,
    );
  });

  it("neutralizeMarkup es idempotente y conserva el «<» del texto normal", () => {
    fc.assert(
      fc.property(anyText, (s) => {
        const una = neutralizeMarkup(s);
        expect(neutralizeMarkup(una)).toBe(una);
        expect(una.length).toBe(s.length);
      }),
      cfg,
    );
  });
});

describe("nombres de objeto en rutas ADT", () => {
  /**
   * Alfabeto dirigido: nombres con la pinta de los reales, mezclados con lo que serviría para recorrer la ruta.
   * Con texto puramente aleatorio la propiedad no vale nada, porque casi todo se rechaza por otros motivos.
   */
  const nombre = fc
    .array(fc.constantFrom("z", "A", "9", "_", "$", "/", ".", "..", "%2e", "~", ":", "?", "#", "&", "\\", " ", "cl_x"), {
      minLength: 1,
      maxLength: 12,
    })
    .map((p) => p.join(""));

  it("lo que acepta nunca puede recorrer la ruta ni salir del segmento", () => {
    fc.assert(
      fc.property(fc.oneof(nombre, anyText), (s) => {
        let out: string;
        try {
          out = adtPathName(s);
        } catch (e) {
          expect(e).toBeInstanceOf(ToolError);
          return;
        }
        // Solo caracteres de nombre o escapes percent: el «/» de un namespace sale como %2F y no abre otro segmento.
        expect(out).toMatch(/^(?:[a-z0-9_$]|%[0-9A-F]{2})+$/);
        expect(out).not.toContain("/");
        expect(out).not.toContain("..");
        expect(decodeURIComponent(out)).not.toMatch(/[.\\?#&;:@=+\s]/);
      }),
      cfg,
    );
  });
});

describe("usuarios SAP en filtros", () => {
  it("lo que acepta SAP_USER_RE no puede alterar la consulta ni el marcado", () => {
    fc.assert(
      fc.property(anyText, (s) => {
        if (!SAP_USER_RE.test(s)) return;
        expect(s.length).toBeLessThanOrEqual(12);
        expect(s).not.toMatch(/['"<>%*\s;()]/);
      }),
      cfg,
    );
  });
});

describe("token de confirmación de escritura", () => {
  const args = fc.dictionary(fc.stringMatching(/^[a-z][a-z0-9_]{0,8}$/), fc.oneof(fc.string(), fc.integer(), fc.boolean()), {
    maxKeys: 6,
  });

  it("la huella no depende del orden de las claves", () => {
    fc.assert(
      fc.property(args, (a) => {
        const mezclado = Object.fromEntries([...Object.entries(a)].reverse());
        expect(argsDigest("write_source", "DEV", mezclado)).toBe(argsDigest("write_source", "DEV", a));
      }),
      cfg,
    );
  });

  it("un token no vale para otros argumentos, otra tool u otro sistema", () => {
    fc.assert(
      fc.property(args, fc.string({ minLength: 1, maxLength: 20 }), (a, extra) => {
        const distinto = { ...a, __otro: extra };
        expect(consumeToken(issueToken("write_source", "DEV", a), "write_source", "DEV", distinto)).toBe("mismatch");
        expect(consumeToken(issueToken("write_source", "DEV", a), "activate", "DEV", a)).toBe("mismatch");
        expect(consumeToken(issueToken("write_source", "DEV", a), "write_source", "QAS", a)).toBe("mismatch");
      }),
      cfg,
    );
  });

  it("cada token se consume una sola vez", () => {
    fc.assert(
      fc.property(args, fc.integer({ min: 1, max: 4 }), (a, reintentos) => {
        const t = issueToken("write_source", "DEV", a);
        expect(consumeToken(t, "write_source", "DEV", a)).toBe("ok");
        for (let i = 0; i < reintentos; i++) expect(consumeToken(t, "write_source", "DEV", a)).toBe("unknown");
      }),
      cfg,
    );
  });

  it("la huella del estado cambia con el contenido y no con los finales de línea", () => {
    fc.assert(
      fc.property(fc.array(fc.stringMatching(/^[^\r\n]{0,20}$/), { minLength: 1, maxLength: 10 }), (lineas) => {
        expect(stateOf(lineas.join("\r\n"))).toBe(stateOf(lineas.join("\n")));
      }),
      cfg,
    );
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), fc.string({ minLength: 1 }), (a, b) => {
        fc.pre(a.replace(/\r\n?/g, "\n") !== b.replace(/\r\n?/g, "\n"));
        expect(stateOf(a)).not.toBe(stateOf(b));
      }),
      cfg,
    );
  });
});
