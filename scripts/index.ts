#!/usr/bin/env bun
/**
 * Indexer — emits knowledge/manifest.json with hash + counts, and pre-builds
 * a serialized MiniSearch index per kind for instant boot inside the server.
 */

import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import MiniSearch from "minisearch";
import type {
  ComponentNode,
  RecipeNode,
  EasingNode,
  DocNode,
  TokenNode,
  HookNode,
  LibNode,
  ItemKind,
  SnapshotManifest,
} from "../src/types";

const KNOWLEDGE = join(process.cwd(), "knowledge");

const sha = (s: string): string => createHash("sha256").update(s).digest("hex").slice(0, 16);

const buildRecipeIndex = (recipes: RecipeNode[]): string => {
  const ms = new MiniSearch({
    fields: ["name", "description", "component", "primitives_text", "intents_text", "tokens_text"],
    storeFields: ["id", "component"],
    idField: "id",
    searchOptions: { boost: { name: 3, description: 2, intents_text: 2 }, fuzzy: 0.2, prefix: true },
  });
  ms.addAll(
    recipes.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description ?? "",
      component: r.component ?? "",
      primitives_text: r.primitives.join(" "),
      intents_text: r.intent_tags.join(" "),
      tokens_text: r.className_tokens.join(" "),
    })),
  );
  return JSON.stringify(ms.toJSON());
};

const buildDocIndex = (docs: DocNode[]): string => {
  const ms = new MiniSearch({
    fields: ["title", "slug", "body_markdown"],
    storeFields: ["id", "slug", "title"],
    idField: "id",
    searchOptions: { boost: { title: 4, slug: 3 }, fuzzy: 0.2, prefix: true },
  });
  ms.addAll(docs);
  return JSON.stringify(ms.toJSON());
};

const buildComponentIndex = (components: ComponentNode[]): string => {
  const ms = new MiniSearch({
    fields: ["name", "description"],
    storeFields: ["id", "name"],
    idField: "id",
    searchOptions: { boost: { name: 3 }, fuzzy: 0.2, prefix: true },
  });
  ms.addAll(components);
  return JSON.stringify(ms.toJSON());
};

const buildEasingIndex = (easings: EasingNode[]): string => {
  const ms = new MiniSearch({
    fields: ["name", "family", "direction", "use_text"],
    storeFields: ["id", "name"],
    idField: "id",
    searchOptions: { boost: { name: 3 }, fuzzy: 0.2, prefix: true },
  });
  ms.addAll(easings.map((e) => ({ ...e, use_text: e.use_cases.join(" ") })));
  return JSON.stringify(ms.toJSON());
};

const main = async (): Promise<void> => {
  const components: ComponentNode[] = JSON.parse(await readFile(join(KNOWLEDGE, "components.json"), "utf-8"));
  const recipes: RecipeNode[] = JSON.parse(await readFile(join(KNOWLEDGE, "recipes.json"), "utf-8"));
  const easings: EasingNode[] = JSON.parse(await readFile(join(KNOWLEDGE, "easings.json"), "utf-8"));
  const docs: DocNode[] = JSON.parse(await readFile(join(KNOWLEDGE, "docs.json"), "utf-8"));
  const tokens: TokenNode[] = JSON.parse(await readFile(join(KNOWLEDGE, "tokens.json"), "utf-8"));
  const hooks: HookNode[] = JSON.parse(await readFile(join(KNOWLEDGE, "hooks.json"), "utf-8"));
  const libs: LibNode[] = JSON.parse(await readFile(join(KNOWLEDGE, "libs.json"), "utf-8"));

  await writeFile(join(KNOWLEDGE, "search-recipes.json"), buildRecipeIndex(recipes));
  await writeFile(join(KNOWLEDGE, "search-docs.json"), buildDocIndex(docs));
  await writeFile(join(KNOWLEDGE, "search-components.json"), buildComponentIndex(components));
  await writeFile(join(KNOWLEDGE, "search-easings.json"), buildEasingIndex(easings));

  const counts: Record<ItemKind, number> = {
    component: components.length,
    recipe: recipes.length,
    easing: easings.length,
    doc: docs.length,
    token: tokens.length,
    hook: hooks.length,
    lib: libs.length,
  };

  // Compose hash from every shard (deterministic).
  const shards = ["components", "recipes", "easings", "docs", "tokens", "hooks", "libs"];
  const concat = (
    await Promise.all(shards.map((s) => readFile(join(KNOWLEDGE, `${s}.json`), "utf-8")))
  ).join("\n");
  const hash = sha(concat);

  const manifest: SnapshotManifest = {
    schema_version: 1,
    snapshot_version: new Date().toISOString().slice(0, 10),
    generated_at: new Date().toISOString(),
    source_origin: "https://coss.com",
    counts,
    hash,
  };
  await writeFile(join(KNOWLEDGE, "manifest.json"), JSON.stringify(manifest, null, 2));

  console.log(`[index] manifest written: hash=${hash} version=${manifest.snapshot_version}`);
  console.log(`[index] counts:`, counts);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
