/**
 * Tool registry — every MCP tool the server exposes.
 *
 * Design contract:
 *   - Tools NEVER return raw JSX as primary output. Recipes are returned as
 *     ComposedPlan structures: ingredients + rules + source_ref. Agent
 *     composes locally using primitives it already owns.
 *   - Every response carries `snapshot_version` so the agent can verify.
 *   - On miss, return null + suggestions, never invent.
 */

import { z } from "zod";
import type { Snapshot } from "./snapshot.js";
import type { ComposedPlan, RecipeNode } from "./types.js";
import { compareToRecipe, lintJsx, suggestRecipe } from "./lint.js";

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: z.ZodType<unknown>;
  handler: (args: unknown, snapshot: Snapshot) => Promise<unknown> | unknown;
}

const planFromRecipe = (r: RecipeNode, version: string): ComposedPlan => {
  const variant_tokens: Record<string, string> = {};
  for (const [k, v] of Object.entries(r.variant_keys)) {
    if (v[0]) variant_tokens[k] = v[0];
  }
  return {
    id: r.id,
    intent: r.description ?? r.name,
    primitives: r.primitives,
    variant_tokens,
    composition: r.primitives.join(" + "),
    className_tokens: r.className_tokens,
    easing: r.easing_classes[0],
    states: r.states_inferred,
    a11y: deriveA11yRules(r),
    rules: deriveRules(r),
    source_ref: r.registry_url,
    snapshot_version: version,
  };
};

const deriveA11yRules = (r: RecipeNode): string[] => {
  const rules: string[] = [];
  if (r.primitives.some((p) => /Dialog|Sheet|Drawer|Modal/.test(p))) {
    rules.push("focus-trap on open", "escape closes", "return focus to trigger");
  }
  if (r.primitives.some((p) => /Popover|Tooltip|HoverCard|PreviewCard/.test(p))) {
    rules.push("aria-haspopup on trigger", "aria-expanded reflects open state");
  }
  if (r.primitives.includes("Spinner") || r.states_inferred.includes("loading")) {
    rules.push("aria-busy on loading", "disable interactions while loading");
  }
  if (r.primitives.some((p) => /Input|Textarea|Combobox|Select/.test(p))) {
    rules.push("associate <Label> with control", "aria-invalid on validation error");
  }
  if (r.primitives.includes("Button")) {
    rules.push("aria-label on icon-only button");
  }
  return rules;
};

const deriveRules = (r: RecipeNode): string[] => {
  const rules: string[] = [
    "Compose with the primitives listed above. Do NOT inline raw <button>/<input>/<dialog>.",
    "Use only the className tokens listed. No hex colors, no Tailwind color-scale (bg-blue-500, etc).",
  ];
  if (r.easing_classes.length) {
    rules.push(`Use easing class "${r.easing_classes[0]}" for motion.`);
  }
  if (r.primitives.includes("Spinner")) {
    rules.push("Spinner replaces icon during loading — never both.");
  }
  return rules;
};

const TOOLS: ToolDef[] = [
  {
    name: "find_recipe",
    description:
      "Flagship tool. Search COSS Origin recipes by intent (free-text). Returns ranked plans, NOT raw JSX. Use whenever building a UI block (loading button, date range, profile popover, empty state, etc). Examples: 'date range with presets', 'social login button', 'avatar with status badge', 'pagination with page size selector'.",
    inputSchema: z.object({
      intent: z.string().describe("Free-text description of what you're building"),
      component: z.string().optional().describe("Filter to one component (e.g. 'popover')"),
      limit: z.number().int().min(1).max(20).default(8),
    }),
    handler: (args, snapshot) => {
      const { intent, component, limit } = args as { intent: string; component?: string; limit: number };
      const hits = snapshot.search.recipes.search(intent, { prefix: true, fuzzy: 0.2 });
      const filtered = hits.filter((h) => !component || h.component === component);
      const plans = filtered.slice(0, limit).map((h) => {
        const r = snapshot.byId.get(h.id) as RecipeNode;
        return { score: h.score, plan: planFromRecipe(r, snapshot.manifest.snapshot_version) };
      });
      return {
        snapshot_version: snapshot.manifest.snapshot_version,
        results: plans,
        suggestions: plans.length === 0 ? listIntentSuggestions(snapshot, intent) : [],
      };
    },
  },
  {
    name: "get_recipe",
    description:
      "Get the full structured plan for one recipe by id (e.g. 'recipe:p-button-12'). Returns ingredients, variants, tokens, easing, states, a11y rules, and source_ref. Never returns raw JSX.",
    inputSchema: z.object({ id: z.string() }),
    handler: (args, snapshot) => {
      const { id } = args as { id: string };
      const r = snapshot.byId.get(id);
      if (!r || r.kind !== "recipe") return { error: "not_found", id, snapshot_version: snapshot.manifest.snapshot_version };
      return planFromRecipe(r, snapshot.manifest.snapshot_version);
    },
  },
  {
    name: "list_variants",
    description:
      "List every recipe for one component (e.g. 'button' → 41 variants). Returns id + name + description per variant. Use when the agent wants to enumerate ALL ways COSS expresses this primitive before picking one.",
    inputSchema: z.object({ component: z.string() }),
    handler: (args, snapshot) => {
      const { component } = args as { component: string };
      const variants = snapshot.recipes
        .filter((r) => r.component === component)
        .map((r) => ({ id: r.id, name: r.name, description: r.description, intent_tags: r.intent_tags }));
      return {
        snapshot_version: snapshot.manifest.snapshot_version,
        component,
        count: variants.length,
        variants,
      };
    },
  },
  {
    name: "list_intents",
    description:
      "Returns the full intent taxonomy: every tag with the count of recipes carrying it. Use to discover what 'shapes' the COSS Origin library already supports.",
    inputSchema: z.object({}),
    handler: (_args, snapshot) => {
      const out = Object.entries(snapshot.intents).map(([tag, ids]) => ({ tag, count: ids.length })).sort(
        (a, b) => b.count - a.count,
      );
      return { snapshot_version: snapshot.manifest.snapshot_version, intents: out };
    },
  },
  {
    name: "list_components",
    description:
      "Returns every COSS UI primitive (55 components — Button, Popover, Calendar, etc) with its description and registry url. Use to ground the agent on what primitives ARE available before composing.",
    inputSchema: z.object({}),
    handler: (_args, snapshot) => ({
      snapshot_version: snapshot.manifest.snapshot_version,
      components: snapshot.components.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        doc_slug: c.doc_slug,
        registry_url: c.registry_url,
      })),
    }),
  },
  {
    name: "get_component",
    description:
      "Get one COSS primitive's contract: name, description, doc reference. Pair with list_variants to see how it's composed in practice.",
    inputSchema: z.object({ name: z.string() }),
    handler: (args, snapshot) => {
      const { name } = args as { name: string };
      const c = snapshot.components.find((x) => x.name === name);
      if (!c) return { error: "not_found", name, snapshot_version: snapshot.manifest.snapshot_version };
      return c;
    },
  },
  {
    name: "list_easings",
    description:
      "Returns all 25 COSS Origin easing classes (linear + 8 families × 3 directions). Each entry: name, cubic_bezier, family, direction, recommended use cases, paired durations.",
    inputSchema: z.object({}),
    handler: (_args, snapshot) => ({
      snapshot_version: snapshot.manifest.snapshot_version,
      easings: snapshot.easings,
    }),
  },
  {
    name: "get_easing",
    description:
      "Get one easing class by name (e.g. 'ease-out-quad'). Returns curve, family, direction, use_cases, paired durations.",
    inputSchema: z.object({ name: z.string() }),
    handler: (args, snapshot) => {
      const { name } = args as { name: string };
      const e = snapshot.easings.find((x) => x.name === name);
      if (!e) {
        return {
          error: "not_found",
          name,
          available: snapshot.easings.map((x) => x.name),
          snapshot_version: snapshot.manifest.snapshot_version,
        };
      }
      return e;
    },
  },
  {
    name: "search_docs",
    description:
      "Full-text search across the COSS Origin documentation (introduction, get-started, components, hooks). Returns ranked hits with title + snippet + slug.",
    inputSchema: z.object({
      query: z.string(),
      limit: z.number().int().min(1).max(20).default(8),
    }),
    handler: (args, snapshot) => {
      const { query, limit } = args as { query: string; limit: number };
      const hits = snapshot.search.docs.search(query, { fuzzy: 0.2, prefix: true });
      return {
        snapshot_version: snapshot.manifest.snapshot_version,
        results: hits.slice(0, limit).map((h) => {
          const d = snapshot.byId.get(h.id);
          if (!d || d.kind !== "doc") return null;
          return {
            id: d.id,
            slug: d.slug,
            title: d.title,
            url: d.url,
            score: h.score,
            snippet: d.body_markdown.slice(0, 320),
          };
        }).filter(Boolean),
      };
    },
  },
  {
    name: "get_doc",
    description:
      "Fetch a documentation page by slug (e.g. 'components/button', 'get-started', 'index'). Returns title + full markdown body + url.",
    inputSchema: z.object({ slug: z.string() }),
    handler: (args, snapshot) => {
      const { slug } = args as { slug: string };
      const d = snapshot.docs.find((x) => x.slug === slug);
      if (!d) {
        return {
          error: "not_found",
          slug,
          available: snapshot.docs.map((x) => x.slug),
          snapshot_version: snapshot.manifest.snapshot_version,
        };
      }
      return d;
    },
  },
  {
    name: "lint_jsx",
    description:
      "Lint agent-written JSX against COSS Origin rules. Catches hex colors, RGB/HSL inline colors, Tailwind color scales (bg-blue-500), raw <button>/<input>/<dialog>, and primitives imported from @coss paths that don't exist in the snapshot. Run AFTER drafting JSX, BEFORE writing the file.",
    inputSchema: z.object({ source: z.string() }),
    handler: (args, snapshot) => {
      const { source } = args as { source: string };
      return lintJsx(source, snapshot);
    },
  },
  {
    name: "compare_to_recipe",
    description:
      "Compare agent-written JSX to a known canonical recipe. Returns: missing_primitives, extra_primitives, missing_class_tokens, variant_drift. Use after the agent picks a recipe via find_recipe and writes the code, to verify fidelity.",
    inputSchema: z.object({ source: z.string(), recipe_id: z.string() }),
    handler: (args, snapshot) => {
      const { source, recipe_id } = args as { source: string; recipe_id: string };
      const r = snapshot.byId.get(recipe_id);
      if (!r || r.kind !== "recipe") {
        return { error: "recipe_not_found", recipe_id, snapshot_version: snapshot.manifest.snapshot_version };
      }
      return { ...compareToRecipe(source, r), snapshot_version: snapshot.manifest.snapshot_version };
    },
  },
  {
    name: "suggest_recipe",
    description:
      "Reverse lookup: agent has draft JSX, MCP returns the top-3 closest matching canonical recipes (Jaccard over primitives + class tokens). Use to discover whether the draft re-implements an existing pattern.",
    inputSchema: z.object({
      source: z.string(),
      top_k: z.number().int().min(1).max(10).default(3),
    }),
    handler: (args, snapshot) => {
      const { source, top_k } = args as { source: string; top_k: number };
      return {
        snapshot_version: snapshot.manifest.snapshot_version,
        suggestions: suggestRecipe(source, snapshot, top_k),
      };
    },
  },
  {
    name: "verify_snapshot",
    description:
      "Returns the snapshot manifest (hash, generated_at, counts, version) so the agent can verify which COSS Origin truth set is in play.",
    inputSchema: z.object({}),
    handler: (_args, snapshot) => snapshot.manifest,
  },
];

const listIntentSuggestions = (snapshot: Snapshot, query: string): string[] => {
  const q = query.toLowerCase();
  return Object.keys(snapshot.intents)
    .filter((t) => t.toLowerCase().includes(q.split(" ")[0] ?? ""))
    .slice(0, 8);
};

export const allTools = (): ToolDef[] => TOOLS;
