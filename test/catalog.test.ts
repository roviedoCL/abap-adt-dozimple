import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CREDITS, GROUPS } from "../src/core/catalog.js";
import { loadTools } from "../src/core/registry.js";

describe("catálogo funcional", () => {
  it("toda tool está en exactamente un grupo, y todo lo del catálogo existe", async () => {
    const names = (await loadTools(join(__dirname, "..", "src", "tools"))).map((d) => d.name).sort();
    const listed = GROUPS.flatMap((g) => g.tools.map((t) => t.name));
    expect(new Set(listed).size, "tool repetida en dos grupos").toBe(listed.length);
    expect([...listed].sort()).toEqual(names);
  });
  it("todo crédito citado existe y tiene autor, url y licencia", () => {
    for (const g of GROUPS) for (const t of g.tools) for (const c of t.credits) expect(CREDITS[c], `${t.name}: ${c}`).toBeDefined();
    for (const c of Object.values(CREDITS)) {
      expect(c.by.length).toBeGreaterThan(2);
      expect(c.url).toMatch(/^https:\/\//);
      expect(c.license.length).toBeGreaterThan(1);
    }
  });
});

describe("README en inglés", () => {
  it("todo grupo, tool y flujo guiado tiene su texto en inglés, y no sobra ninguno", async () => {
    const { GROUPS_EN, PROMPTS_EN, TOOLS_EN } = await import("../src/core/catalog.en.js");
    const { PROMPT_META } = await import("../src/core/prompts.js");
    expect(Object.keys(GROUPS_EN).sort()).toEqual(GROUPS.map((g) => g.id).sort());
    expect(Object.keys(TOOLS_EN).sort()).toEqual(GROUPS.flatMap((g) => g.tools.map((t) => t.name)).sort());
    expect(Object.keys(PROMPTS_EN).sort()).toEqual(Object.keys(PROMPT_META).sort());
    for (const [name, text] of Object.entries(TOOLS_EN)) expect(text, name).toMatch(/^\*\*.+\*\* .{20,}/);
  });
});
