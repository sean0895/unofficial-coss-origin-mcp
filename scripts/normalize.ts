#!/usr/bin/env bun
/**
 * Normalizer — raw .cache/raw → structured knowledge/ shards.
 *
 * Reads:
 *   .cache/raw/registry.json
 *   .cache/raw/items/*.json
 *   .cache/raw/docs/*.md + *.meta.json
 *
 * Writes:
 *   knowledge/components.json
 *   knowledge/recipes.json
 *   knowledge/easings.json
 *   knowledge/docs.json
 *   knowledge/tokens.json
 *   knowledge/hooks.json
 *   knowledge/libs.json
 *   knowledge/intents.json   (taxonomy of intent_tags → recipe ids)
 *
 * Extraction is regex-based (deterministic). JSX is well-formed enough that we
 * don't need a full AST for snapshot ingestion.
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import type {
  ComponentNode,
  RecipeNode,
  EasingNode,
  DocNode,
  TokenNode,
  HookNode,
  LibNode,
} from "../src/types";

const CACHE_ROOT = join(process.cwd(), ".cache", "raw");
const KNOWLEDGE_ROOT = join(process.cwd(), "knowledge");
const REGISTRY_BASE = "https://coss.com/ui/r";
const DOCS_BASE = "https://coss.com/ui/docs";

interface RawItem {
  $schema?: string;
  name: string;
  type: string;
  description?: string;
  categories?: string[];
  dependencies?: string[];
  registryDependencies?: string[];
  files?: Array<{ path: string; type: string; content: string }>;
}

const sha = (s: string): string => createHash("sha256").update(s).digest("hex").slice(0, 16);

const stripCossPrefix = (dep: string): string => dep.replace(/^@coss\//, "");

const extractImports = (source: string): { primitives: string[]; rawImports: string[] } => {
  const primitives = new Set<string>();
  const rawImports: string[] = [];
  const importRe = /import\s+(?:type\s+)?(?:\{([^}]+)\}|\*\s+as\s+\w+|\w+)\s+from\s+["']([^"']+)["']/g;
  for (const match of source.matchAll(importRe)) {
    const [, named, fromPath] = match;
    if (!fromPath) continue;
    rawImports.push(fromPath);
    if (fromPath.includes("/registry/default/ui/") && named) {
      for (const n of named.split(",")) {
        const id = n.trim().split(/\s+as\s+/)[0]?.trim();
        if (id) primitives.add(id);
      }
    }
  }
  return { primitives: [...primitives].sort(), rawImports: [...new Set(rawImports)].sort() };
};

const extractVariantKeys = (source: string): Record<string, string[]> => {
  const keys: Record<string, Set<string>> = {};
  const elementRe = /<([A-Z][A-Za-z0-9]*)\b([^>]*)\/?>/g;
  for (const match of source.matchAll(elementRe)) {
    const [, tag, attrsRaw] = match;
    if (!tag || !attrsRaw) continue;
    const attrRe = /(\w+)=\{?["']([^"'}]+)["']\}?/g;
    for (const a of attrsRaw.matchAll(attrRe)) {
      const [, attr, value] = a;
      if (!attr || !value) continue;
      if (["variant", "size", "color", "tone", "intent", "shape"].includes(attr)) {
        const k = `${tag}.${attr}`;
        keys[k] ??= new Set();
        keys[k].add(value);
      }
    }
  }
  return Object.fromEntries(
    Object.entries(keys).map(([k, v]) => [k, [...v].sort()]),
  );
};

const extractClassNameTokens = (source: string): string[] => {
  const tokens = new Set<string>();
  const classRe = /className=(?:"([^"]+)"|\{`([^`]+)`\}|\{cn\(([^)]+)\)\})/g;
  const collect = (s: string): void => {
    for (const t of s.split(/\s+/)) {
      const trimmed = t.trim().replace(/[`"',]/g, "");
      if (trimmed && /^[a-z][\w:/-]+$/.test(trimmed)) tokens.add(trimmed);
    }
  };
  for (const match of source.matchAll(classRe)) {
    const [, plain, tpl, cnArgs] = match;
    if (plain) collect(plain);
    if (tpl) collect(tpl);
    if (cnArgs) collect(cnArgs);
  }
  return [...tokens].sort();
};

const extractEasings = (source: string): string[] => {
  const easings = new Set<string>();
  for (const m of source.matchAll(/\b(ease(?:-(?:in|out|in-out))?(?:-(?:sine|quad|cubic|quart|quint|expo|circ|back))?)\b/g)) {
    const v = m[1];
    if (v && v !== "ease") easings.add(v);
  }
  return [...easings].sort();
};

const extractStates = (source: string, primitives: string[]): string[] => {
  const states = new Set<string>();
  if (/loading\s*=\s*\{?true\}?|loading=\{loading\}|loading\b/.test(source)) states.add("loading");
  if (/disabled/i.test(source)) states.add("disabled");
  if (/data-pressed|aria-pressed/.test(source)) states.add("pressed");
  if (/hover:|data-hover/.test(source)) states.add("hover");
  if (/focus:|focus-visible:|data-focused/.test(source)) states.add("focus");
  if (/data-state=["']open|aria-expanded/.test(source)) states.add("open");
  if (/data-state=["']checked|aria-checked/.test(source)) states.add("checked");
  if (primitives.includes("Skeleton") || /animate-pulse|skeleton/i.test(source)) states.add("loading");
  return [...states].sort();
};

const inferIntentTags = (
  name: string,
  description: string | undefined,
  categories: string[],
  primitives: string[],
  states: string[],
): string[] => {
  const tags = new Set<string>();
  const haystack = `${name} ${description ?? ""}`.toLowerCase();

  const slugify = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, "-");
  for (const cat of categories) tags.add(`component:${slugify(cat)}`);
  for (const [pattern, tag] of [
    [/loading|spinner/, "loading-state"],
    [/empty/, "empty-state"],
    [/error|destructive/, "error-state"],
    [/success/, "success-state"],
    [/warning/, "warning-state"],
    [/social|google|github|apple|twitter|discord/, "social-auth"],
    [/login|sign[- ]?in|signup|register/, "auth"],
    [/search|filter|command|palette/, "search"],
    [/sort|order/, "sort"],
    [/pagination|page/, "pagination"],
    [/range/, "date-range"],
    [/preset/, "presets"],
    [/multi(-|\s)?(select|month|step)/, "multi"],
    [/notification|toast|banner/, "notification"],
    [/profile|user|avatar/, "user-context"],
    [/menu|dropdown/, "menu"],
    [/tooltip|popover|hover-card|preview/, "anchored-overlay"],
    [/sheet|drawer|dialog|modal/, "modal"],
    [/timeline|history|activity/, "feed"],
    [/upload|file/, "file-upload"],
    [/calendar|date|time/, "datetime"],
    [/keyboard|kbd|shortcut/, "keyboard"],
    [/group|stack/, "grouping"],
    [/responsive|mobile/, "responsive"],
  ] as const) {
    if (pattern.test(haystack)) tags.add(tag);
  }
  if (states.includes("loading")) tags.add("loading-state");
  if (primitives.includes("Spinner")) tags.add("loading-state");
  if (primitives.includes("Skeleton")) tags.add("skeleton-loading");

  return [...tags].sort();
};

const guessComponentForRecipe = (item: RawItem, primitives: string[]): string | null => {
  // Prefer the component named in the particle id (p-popover-3 → "popover"),
  // matched against categories. Fall back to single-category, then primitive.
  const nameMatch = item.name.match(/^p-([a-z-]+?)(?:-\d+)?$/);
  const fromName = nameMatch?.[1];
  const cats = item.categories ?? [];
  if (fromName && cats.includes(fromName)) return fromName;
  if (fromName) return fromName;
  if (cats.length === 1) return cats[0]!;
  return primitives[0]?.toLowerCase() ?? null;
};

const buildRelated = (
  recipes: RecipeNode[],
): Map<string, string[]> => {
  const related = new Map<string, string[]>();
  for (const a of recipes) {
    const candidates: Array<{ id: string; score: number }> = [];
    for (const b of recipes) {
      if (a.id === b.id) continue;
      if (a.component !== b.component) continue;
      const aPrim = new Set(a.primitives);
      const bPrim = new Set(b.primitives);
      const overlap = [...aPrim].filter((p) => bPrim.has(p)).length;
      const tagOverlap = a.intent_tags.filter((t) => b.intent_tags.includes(t)).length;
      const score = overlap * 2 + tagOverlap;
      if (score > 1) candidates.push({ id: b.id, score });
    }
    candidates.sort((x, y) => y.score - x.score);
    related.set(a.id, candidates.slice(0, 6).map((c) => c.id));
  }
  return related;
};

const CANONICAL_EASINGS: EasingNode[] = (() => {
  // Penner curves — public-domain math, mirrored by COSS Origin.
  // Sources: https://easings.net/, Tailwind v4 timing fns.
  const families: Record<string, [number, number, number, number][]> = {
    sine: [
      [0.12, 0, 0.39, 0],
      [0.61, 1, 0.88, 1],
      [0.37, 0, 0.63, 1],
    ],
    quad: [
      [0.11, 0, 0.5, 0],
      [0.5, 1, 0.89, 1],
      [0.45, 0, 0.55, 1],
    ],
    cubic: [
      [0.32, 0, 0.67, 0],
      [0.33, 1, 0.68, 1],
      [0.65, 0, 0.35, 1],
    ],
    quart: [
      [0.5, 0, 0.75, 0],
      [0.25, 1, 0.5, 1],
      [0.76, 0, 0.24, 1],
    ],
    quint: [
      [0.64, 0, 0.78, 0],
      [0.22, 1, 0.36, 1],
      [0.83, 0, 0.17, 1],
    ],
    expo: [
      [0.7, 0, 0.84, 0],
      [0.16, 1, 0.3, 1],
      [0.87, 0, 0.13, 1],
    ],
    circ: [
      [0.55, 0, 1, 0.45],
      [0, 0.55, 0.45, 1],
      [0.85, 0, 0.15, 1],
    ],
    back: [
      [0.36, 0, 0.66, -0.56],
      [0.34, 1.56, 0.64, 1],
      [0.68, -0.6, 0.32, 1.6],
    ],
  };
  const directions: Array<["in" | "out" | "in-out", number]> = [
    ["in", 0],
    ["out", 1],
    ["in-out", 2],
  ];
  const useCases: Record<string, string[]> = {
    sine: ["subtle drift", "ambient transitions"],
    quad: ["default UI motion", "buttons", "hovers"],
    cubic: ["card lift", "menu open"],
    quart: ["dialog open", "drawer slide"],
    quint: ["full-screen takeover"],
    expo: ["dramatic reveals", "splash"],
    circ: ["arc / orbit motion"],
    back: ["playful overshoot", "celebratory"],
  };
  const durations: Record<string, number[]> = {
    sine: [120, 160, 200],
    quad: [120, 160, 200],
    cubic: [180, 240, 320],
    quart: [240, 320, 400],
    quint: [320, 400, 480],
    expo: [240, 320, 480],
    circ: [240, 320, 400],
    back: [320, 400, 480],
  };
  const out: EasingNode[] = [
    {
      id: "easing:linear",
      kind: "easing",
      name: "linear",
      cubic_bezier: [0, 0, 1, 1],
      family: "linear",
      direction: "linear",
      use_cases: ["progress fills", "scrubbers"],
      pairs_well_with_durations_ms: [200, 400, 800],
    },
  ];
  for (const [family, curves] of Object.entries(families)) {
    for (const [dirName, idx] of directions) {
      const curve = curves[idx];
      if (!curve) continue;
      const name = `ease-${dirName}-${family}`;
      out.push({
        id: `easing:${name}`,
        kind: "easing",
        name,
        cubic_bezier: curve,
        family: family as EasingNode["family"],
        direction: dirName,
        use_cases: useCases[family] ?? [],
        pairs_well_with_durations_ms: durations[family] ?? [200],
      });
    }
  }
  return out;
})();

const main = async (): Promise<void> => {
  const components: ComponentNode[] = [];
  const recipes: RecipeNode[] = [];
  const docs: DocNode[] = [];
  const tokens: TokenNode[] = [];
  const hooks: HookNode[] = [];
  const libs: LibNode[] = [];

  const itemFiles = await readdir(join(CACHE_ROOT, "items"));
  for (const f of itemFiles) {
    if (!f.endsWith(".json")) continue;
    const raw = await readFile(join(CACHE_ROOT, "items", f), "utf-8");
    const item: RawItem = JSON.parse(raw);
    const source = item.files?.[0]?.content ?? "";
    const sourceHash = sha(source);

    if (item.type === "registry:ui") {
      const { primitives } = extractImports(source);
      components.push({
        id: `component:${item.name}`,
        kind: "component",
        name: item.name,
        description: item.description,
        doc_slug: `components/${item.name}`,
        registry_url: `${REGISTRY_BASE}/${item.name}.json`,
        primitives_used: primitives,
        source_paths: item.files?.map((x) => x.path) ?? [],
        source_hash: sourceHash,
      });
    } else if (item.type === "registry:block") {
      const { primitives, rawImports } = extractImports(source);
      const variantKeys = extractVariantKeys(source);
      const classTokens = extractClassNameTokens(source);
      const easings = extractEasings(source);
      const states = extractStates(source, primitives);
      const component = guessComponentForRecipe(item, primitives);
      const tags = inferIntentTags(
        item.name,
        item.description,
        item.categories ?? [],
        primitives,
        states,
      );
      recipes.push({
        id: `recipe:${item.name}`,
        kind: "recipe",
        name: item.name,
        description: item.description,
        component,
        categories: item.categories ?? [],
        registry_dependencies: (item.registryDependencies ?? []).map(stripCossPrefix),
        primitives,
        imports: rawImports,
        intent_tags: tags,
        variant_keys: variantKeys,
        className_tokens: classTokens,
        easing_classes: easings,
        states_inferred: states,
        related: [], // filled below
        registry_url: `${REGISTRY_BASE}/${item.name}.json`,
        source_paths: item.files?.map((x) => x.path) ?? [],
        source_hash: sourceHash,
      });
    } else if (item.type === "registry:hook") {
      hooks.push({
        id: `hook:${item.name}`,
        kind: "hook",
        name: item.name,
        description: item.description,
        signature: source.match(/export function (\w+)\([^)]*\)[^{]*/)?.[0],
        source_paths: item.files?.map((x) => x.path) ?? [],
      });
    } else if (item.type === "registry:lib") {
      const exportNames = Array.from(source.matchAll(/export (?:const|function|class) (\w+)/g)).map((m) => m[1]!);
      libs.push({
        id: `lib:${item.name}`,
        kind: "lib",
        name: item.name,
        description: item.description,
        exports: exportNames,
        source_paths: item.files?.map((x) => x.path) ?? [],
      });
    }
    // registry:font and registry:style are dropped — no agent value.
  }

  const docFiles = await readdir(join(CACHE_ROOT, "docs"));
  for (const f of docFiles) {
    if (!f.endsWith(".md")) continue;
    const safe = f.replace(/\.md$/, "");
    const slug = safe.replace(/__/g, "/");
    const body = await readFile(join(CACHE_ROOT, "docs", f), "utf-8");
    const titleMatch = body.match(/^#\s+(.+)$/m);
    let category: DocNode["category"] = "guide";
    if (slug.startsWith("components/")) category = "component";
    else if (slug.startsWith("hooks/")) category = "hook";
    else if (["index", "get-started", "roadmap"].includes(slug)) category = "intro";
    docs.push({
      id: `doc:${slug}`,
      kind: "doc",
      slug,
      title: titleMatch?.[1] ?? slug,
      url: `${DOCS_BASE}/${slug}.md`,
      category,
      body_markdown: body,
      body_hash: sha(body),
    });
  }

  // Cross-link related recipes by shared primitives + intent tags.
  const relatedMap = buildRelated(recipes);
  for (const r of recipes) r.related = relatedMap.get(r.id) ?? [];

  // Intent taxonomy.
  const intents: Record<string, string[]> = {};
  for (const r of recipes) {
    for (const t of r.intent_tags) {
      intents[t] ??= [];
      intents[t].push(r.id);
    }
  }

  const writeShard = async (name: string, data: unknown): Promise<void> => {
    await writeFile(join(KNOWLEDGE_ROOT, `${name}.json`), JSON.stringify(data, null, 2));
  };

  await writeShard("components", components);
  await writeShard("recipes", recipes);
  await writeShard("easings", CANONICAL_EASINGS);
  await writeShard("docs", docs);
  await writeShard("tokens", tokens); // populated in indexer pass from globals.css if available
  await writeShard("hooks", hooks);
  await writeShard("libs", libs);
  await writeShard("intents", intents);

  console.log(
    `[normalize] components=${components.length} recipes=${recipes.length} easings=${CANONICAL_EASINGS.length} docs=${docs.length} hooks=${hooks.length} libs=${libs.length} intents=${Object.keys(intents).length}`,
  );
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
