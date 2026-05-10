/**
 * Snapshot loader — reads knowledge/* shards into memory + restores MiniSearch
 * indices. Single source of truth for the server runtime.
 */

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import MiniSearch from "minisearch";
import type {
  ComponentNode,
  RecipeNode,
  EasingNode,
  DocNode,
  TokenNode,
  HookNode,
  LibNode,
  SnapshotManifest,
} from "./types.js";

export interface Snapshot {
  manifest: SnapshotManifest;
  components: ComponentNode[];
  recipes: RecipeNode[];
  easings: EasingNode[];
  docs: DocNode[];
  tokens: TokenNode[];
  hooks: HookNode[];
  libs: LibNode[];
  intents: Record<string, string[]>;
  byId: Map<string, ComponentNode | RecipeNode | EasingNode | DocNode | TokenNode | HookNode | LibNode>;
  search: {
    recipes: MiniSearch;
    docs: MiniSearch;
    components: MiniSearch;
    easings: MiniSearch;
  };
}

const __dirname = dirname(fileURLToPath(import.meta.url));

const resolveKnowledgeDir = (): string => {
  // Layout when published:        dist/server.js  +  knowledge/...
  // Layout when running from src: src/snapshot.ts +  knowledge/...
  // Both shapes: knowledge sits one level up from the loader file.
  return join(__dirname, "..", "knowledge");
};

const readJson = async <T>(path: string): Promise<T> => {
  return JSON.parse(await readFile(path, "utf-8")) as T;
};

// MiniSearch.toJSON does not preserve the options used at construction time —
// the loader must pass them back in. Keep these in lock-step with scripts/index.ts.
type IndexOptions = ConstructorParameters<typeof MiniSearch>[0];

const INDEX_OPTIONS: Record<"recipes" | "docs" | "components" | "easings", IndexOptions> = {
  recipes: {
    fields: ["name", "description", "component", "primitives_text", "intents_text", "tokens_text"],
    storeFields: ["id", "component"],
    idField: "id",
    searchOptions: { boost: { name: 3, description: 2, intents_text: 2 }, fuzzy: 0.2, prefix: true },
  },
  docs: {
    fields: ["title", "slug", "body_markdown"],
    storeFields: ["id", "slug", "title"],
    idField: "id",
    searchOptions: { boost: { title: 4, slug: 3 }, fuzzy: 0.2, prefix: true },
  },
  components: {
    fields: ["name", "description"],
    storeFields: ["id", "name"],
    idField: "id",
    searchOptions: { boost: { name: 3 }, fuzzy: 0.2, prefix: true },
  },
  easings: {
    fields: ["name", "family", "direction", "use_text"],
    storeFields: ["id", "name"],
    idField: "id",
    searchOptions: { boost: { name: 3 }, fuzzy: 0.2, prefix: true },
  },
};

const loadIndex = async (path: string, options: IndexOptions): Promise<MiniSearch> => {
  const raw = await readFile(path, "utf-8");
  return MiniSearch.loadJSON(raw, options);
};

export const loadSnapshot = async (): Promise<Snapshot> => {
  const root = resolveKnowledgeDir();

  const [
    manifest,
    components,
    recipes,
    easings,
    docs,
    tokens,
    hooks,
    libs,
    intents,
  ] = await Promise.all([
    readJson<SnapshotManifest>(join(root, "manifest.json")),
    readJson<ComponentNode[]>(join(root, "components.json")),
    readJson<RecipeNode[]>(join(root, "recipes.json")),
    readJson<EasingNode[]>(join(root, "easings.json")),
    readJson<DocNode[]>(join(root, "docs.json")),
    readJson<TokenNode[]>(join(root, "tokens.json")),
    readJson<HookNode[]>(join(root, "hooks.json")),
    readJson<LibNode[]>(join(root, "libs.json")),
    readJson<Record<string, string[]>>(join(root, "intents.json")),
  ]);

  const [searchRecipes, searchDocs, searchComponents, searchEasings] = await Promise.all([
    loadIndex(join(root, "search-recipes.json"), INDEX_OPTIONS.recipes),
    loadIndex(join(root, "search-docs.json"), INDEX_OPTIONS.docs),
    loadIndex(join(root, "search-components.json"), INDEX_OPTIONS.components),
    loadIndex(join(root, "search-easings.json"), INDEX_OPTIONS.easings),
  ]);

  const byId = new Map<string, Snapshot["byId"] extends Map<string, infer V> ? V : never>();
  for (const n of [...components, ...recipes, ...easings, ...docs, ...tokens, ...hooks, ...libs]) {
    byId.set(n.id, n);
  }

  return {
    manifest,
    components,
    recipes,
    easings,
    docs,
    tokens,
    hooks,
    libs,
    intents,
    byId,
    search: {
      recipes: searchRecipes,
      docs: searchDocs,
      components: searchComponents,
      easings: searchEasings,
    },
  };
};
