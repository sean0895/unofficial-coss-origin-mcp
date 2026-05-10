import { describe, expect, it, beforeAll } from "bun:test";
import { loadSnapshot, type Snapshot } from "../src/snapshot.js";

let snapshot: Snapshot;

beforeAll(async () => {
  snapshot = await loadSnapshot();
});

describe("snapshot integrity", () => {
  it("manifest pins schema_version and hash", () => {
    expect(snapshot.manifest.schema_version).toBe(1);
    expect(snapshot.manifest.hash).toMatch(/^[0-9a-f]{16}$/);
    expect(snapshot.manifest.snapshot_version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("counts match expected COSS Origin coverage", () => {
    expect(snapshot.components.length).toBeGreaterThanOrEqual(50);
    expect(snapshot.recipes.length).toBeGreaterThanOrEqual(400);
    expect(snapshot.easings.length).toBe(25);
    expect(snapshot.docs.length).toBeGreaterThanOrEqual(50);
  });

  it("byId map covers every node", () => {
    const expected =
      snapshot.components.length +
      snapshot.recipes.length +
      snapshot.easings.length +
      snapshot.docs.length +
      snapshot.tokens.length +
      snapshot.hooks.length +
      snapshot.libs.length;
    expect(snapshot.byId.size).toBe(expected);
  });

  it("every recipe links to a known component", () => {
    const componentNames = new Set(snapshot.components.map((c) => c.name));
    let unmatched = 0;
    for (const r of snapshot.recipes) {
      if (r.component && !componentNames.has(r.component)) unmatched++;
    }
    // Allow a small tail (e.g. avatar/badge cross-listings) but most should match.
    expect(unmatched).toBeLessThan(snapshot.recipes.length * 0.1);
  });

  it("intent taxonomy is non-empty and well-formed", () => {
    expect(Object.keys(snapshot.intents).length).toBeGreaterThan(20);
    for (const [tag, ids] of Object.entries(snapshot.intents)) {
      expect(tag).toMatch(/^[a-z][a-z0-9:-]*$/);
      expect(ids.length).toBeGreaterThan(0);
      expect(ids.every((id) => id.startsWith("recipe:"))).toBe(true);
    }
  });

  it("button primitive resolves with reasonable description", () => {
    const btn = snapshot.components.find((c) => c.name === "button");
    expect(btn).toBeDefined();
    expect(btn?.registry_url).toContain("button.json");
  });
});
