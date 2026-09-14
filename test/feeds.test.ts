import { describe, expect, it } from "vitest";
import { decodeEntities, htmlToText, stripTags } from "../src/core/feeds.js";

describe("limpieza de HTML de SAP", () => {
  it("decodifica &amp; el último: nunca decodifica dos veces", () => {
    expect(decodeEntities("&amp;lt;b&amp;gt; &amp;#39;x&amp;#39;")).toBe("&lt;b&gt; &#39;x&#39;");
    expect(decodeEntities("a &lt; b &amp;&amp; c &gt; d &quot;e&quot; &#39;f&#39; &#65;")).toBe("a < b && c > d \"e\" 'f' A");
  });
  it("quita etiquetas anidadas o partidas sin dejar restos de <script", () => {
    expect(stripTags("<scr<script>ipt>alert(1)</script>")).not.toMatch(/<\s*script/i);
    expect(stripTags("<<b>script>x")).not.toMatch(/<\s*script/i);
    expect(stripTags("<p>hola <b>mundo</b></p>", "")).toBe("hola mundo");
  });
  it("htmlToText conserva estructura, quita script/style y decodifica una sola vez", () => {
    const t = htmlToText("<style>x{}</style><h1>Error</h1><p>a &lt; b</p><table><tr><td>K</td><td>V</td></tr></table><script>evil()</script>&amp;lt;");
    expect(t).toContain("Error");
    expect(t).toContain("a < b");
    expect(t).toMatch(/K\s*\tV|K\s+V/);
    expect(t).not.toMatch(/evil|x\{\}/);
    expect(t.endsWith("&lt;")).toBe(true);
    expect(htmlToText("a<scr<script>x</script>ipt>alert(1)</script>b")).not.toMatch(/<\s*script|alert/i);
  });
});
