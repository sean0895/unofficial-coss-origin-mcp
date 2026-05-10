import { describe, expect, it, beforeAll } from "bun:test";
import { loadSnapshot, type Snapshot } from "../src/snapshot.js";
import { allTools } from "../src/tools.js";

let snapshot: Snapshot;
const tools = allTools();

const call = async (name: string, args: unknown): Promise<unknown> => {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`unknown tool: ${name}`);
  const parsed = tool.inputSchema.safeParse(args ?? {});
  if (!parsed.success) throw new Error(parsed.error.message);
  return tool.handler(parsed.data, snapshot);
};

beforeAll(async () => {
  snapshot = await loadSnapshot();
});

describe("find_recipe", () => {
  it("returns ranked plans for a typical intent", async () => {
    const out = (await call("find_recipe", { intent: "loading button", limit: 5 })) as {
      results: Array<{ score: number; plan: { id: string; primitives: string[] } }>;
    };
    expect(out.results.length).toBeGreaterThan(0);
    expect(out.results[0]?.plan.primitives).toContain("Button");
  });

  it("filters by component", async () => {
    const out = (await call("find_recipe", { intent: "popover", component: "popover", limit: 10 })) as {
      results: Array<{ plan: { id: string } }>;
    };
    expect(out.results.length).toBeGreaterThan(0);
  });

  it("returns suggestions on empty match", async () => {
    const out = (await call("find_recipe", { intent: "qzqzqzqz", limit: 5 })) as {
      results: unknown[];
      suggestions: string[];
    };
    expect(out.results.length).toBe(0);
    expect(Array.isArray(out.suggestions)).toBe(true);
  });
});

describe("get_recipe", () => {
  it("resolves a known recipe to a structured plan", async () => {
    const out = (await call("get_recipe", { id: "recipe:p-button-1" })) as {
      id: string;
      primitives: string[];
      source_ref: string;
    };
    expect(out.id).toBe("recipe:p-button-1");
    expect(out.primitives).toContain("Button");
    expect(out.source_ref).toContain("p-button-1");
  });

  it("never returns raw JSX in the plan", async () => {
    const out = (await call("get_recipe", { id: "recipe:p-popover-3" })) as Record<string, unknown>;
    expect(JSON.stringify(out)).not.toContain("<PopoverTrigger");
    expect(JSON.stringify(out)).not.toContain("export default");
  });

  it("returns not_found on missing id", async () => {
    const out = (await call("get_recipe", { id: "recipe:does-not-exist" })) as { error?: string };
    expect(out.error).toBe("not_found");
  });
});

describe("list_variants", () => {
  it("lists every recipe for a primitive", async () => {
    const out = (await call("list_variants", { component: "button" })) as {
      count: number;
      variants: Array<{ id: string }>;
    };
    expect(out.count).toBeGreaterThan(20);
    expect(out.variants.every((v) => v.id.startsWith("recipe:p-button"))).toBe(true);
  });
});

describe("list_components / get_component", () => {
  it("lists all components", async () => {
    const out = (await call("list_components", {})) as { components: unknown[] };
    expect(out.components.length).toBeGreaterThanOrEqual(50);
  });
  it("get one by name", async () => {
    const out = (await call("get_component", { name: "popover" })) as { name: string };
    expect(out.name).toBe("popover");
  });
});

describe("easings", () => {
  it("lists 25 easings", async () => {
    const out = (await call("list_easings", {})) as { easings: unknown[] };
    expect(out.easings.length).toBe(25);
  });
  it("get_easing returns curve + use_cases", async () => {
    const out = (await call("get_easing", { name: "ease-out-quad" })) as {
      cubic_bezier: number[];
      use_cases: string[];
    };
    expect(out.cubic_bezier.length).toBe(4);
    expect(out.use_cases.length).toBeGreaterThan(0);
  });
  it("missing easing returns hint list", async () => {
    const out = (await call("get_easing", { name: "ease-bounce" })) as { error: string; available: string[] };
    expect(out.error).toBe("not_found");
    expect(out.available.length).toBe(25);
  });
});

describe("docs", () => {
  it("search_docs hits", async () => {
    const out = (await call("search_docs", { query: "button" })) as { results: unknown[] };
    expect(out.results.length).toBeGreaterThan(0);
  });
  it("get_doc by slug", async () => {
    const out = (await call("get_doc", { slug: "components/button" })) as {
      title: string;
      body_markdown: string;
    };
    expect(out.body_markdown.length).toBeGreaterThan(100);
  });
});

describe("lint_jsx", () => {
  it("flags hex colors", async () => {
    const out = (await call("lint_jsx", { source: 'const a = <div className="bg-[#ff0000]" />;' })) as {
      ok: boolean;
      violations: Array<{ rule: string }>;
    };
    expect(out.ok).toBe(false);
    expect(out.violations.some((v) => v.rule === "no-hex-color")).toBe(true);
  });

  it("flags Tailwind color scales", async () => {
    const out = (await call("lint_jsx", { source: '<div className="bg-blue-500 text-white" />' })) as {
      ok: boolean;
      violations: Array<{ rule: string }>;
    };
    expect(out.ok).toBe(false);
    expect(out.violations.some((v) => v.rule === "no-tailwind-color-scale")).toBe(true);
  });

  it("flags raw <button>", async () => {
    const out = (await call("lint_jsx", { source: "<button>Click</button>" })) as {
      violations: Array<{ rule: string }>;
    };
    expect(out.violations.some((v) => v.rule === "no-raw-html-element")).toBe(true);
  });

  it("clean source passes", async () => {
    const out = (await call("lint_jsx", {
      source: '<Button variant="outline" size="sm">Click</Button>',
    })) as { ok: boolean };
    expect(out.ok).toBe(true);
  });
});

describe("compare_to_recipe", () => {
  it("flags missing primitives vs a known recipe", async () => {
    const draft = '<Popover><div>raw</div></Popover>';
    const out = (await call("compare_to_recipe", { source: draft, recipe_id: "recipe:p-popover-3" })) as {
      missing_primitives: string[];
    };
    expect(out.missing_primitives.length).toBeGreaterThan(0);
    expect(out.missing_primitives).toContain("Avatar");
  });
});

describe("suggest_recipe", () => {
  it("returns close matches for a Button-only draft", async () => {
    const draft = '<Button variant="outline" size="sm">Click</Button>';
    const out = (await call("suggest_recipe", { source: draft, top_k: 3 })) as {
      suggestions: Array<{ id: string; score: number }>;
    };
    expect(out.suggestions.length).toBeGreaterThan(0);
    expect(out.suggestions[0]?.id).toMatch(/recipe:p-button-/);
  });
});

describe("verify_snapshot", () => {
  it("returns the manifest", async () => {
    const out = (await call("verify_snapshot", {})) as { hash: string; counts: Record<string, number> };
    expect(out.hash).toMatch(/^[0-9a-f]{16}$/);
    expect(out.counts.recipe).toBeGreaterThan(400);
  });
});
