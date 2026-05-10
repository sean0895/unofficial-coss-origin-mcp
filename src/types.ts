// Snapshot types — the structured truth surface the MCP exposes.
// Source-of-truth schema. Do not paste raw COSS JSX through this layer.

export type ItemKind =
  | "component"
  | "recipe"
  | "easing"
  | "doc"
  | "token"
  | "hook"
  | "lib";

export interface SnapshotManifest {
  schema_version: 1;
  snapshot_version: string;
  generated_at: string;
  source_origin: string;
  counts: Record<ItemKind, number>;
  hash: string;
}

export interface ComponentNode {
  id: string;
  kind: "component";
  name: string;
  description?: string;
  doc_slug?: string;
  registry_url: string;
  primitives_used: string[];
  source_paths: string[];
  source_hash: string;
}

export interface RecipeNode {
  id: string;
  kind: "recipe";
  name: string;
  description?: string;
  component: string | null;
  categories: string[];
  registry_dependencies: string[];
  primitives: string[];
  imports: string[];
  intent_tags: string[];
  variant_keys: Record<string, string[]>;
  className_tokens: string[];
  easing_classes: string[];
  states_inferred: string[];
  related: string[];
  registry_url: string;
  source_paths: string[];
  source_hash: string;
}

export interface EasingNode {
  id: string;
  kind: "easing";
  name: string;
  cubic_bezier: [number, number, number, number];
  family: "linear" | "sine" | "quad" | "cubic" | "quart" | "quint" | "expo" | "circ" | "back";
  direction: "in" | "out" | "in-out" | "linear";
  use_cases: string[];
  pairs_well_with_durations_ms: number[];
}

export interface DocNode {
  id: string;
  kind: "doc";
  slug: string;
  title: string;
  url: string;
  category: "intro" | "component" | "hook" | "guide";
  body_markdown: string;
  body_hash: string;
}

export interface TokenNode {
  id: string;
  kind: "token";
  name: string;
  category: "color" | "spacing" | "radius" | "shadow" | "font" | "easing" | "duration";
  value: string;
  description?: string;
}

export interface HookNode {
  id: string;
  kind: "hook";
  name: string;
  description?: string;
  signature?: string;
  source_paths: string[];
}

export interface LibNode {
  id: string;
  kind: "lib";
  name: string;
  description?: string;
  exports: string[];
  source_paths: string[];
}

export type AnyNode =
  | ComponentNode
  | RecipeNode
  | EasingNode
  | DocNode
  | TokenNode
  | HookNode
  | LibNode;

export interface ComposedPlan {
  id: string;
  intent: string;
  primitives: string[];
  variant_tokens: Record<string, string>;
  composition: string;
  className_tokens: string[];
  easing?: string;
  motion?: { open?: number; close?: number; transition?: number };
  states: string[];
  a11y: string[];
  rules: string[];
  source_ref: string;
  snapshot_version: string;
}

export interface LintViolation {
  rule: string;
  severity: "error" | "warn" | "info";
  message: string;
  range?: { start: number; end: number };
  suggestion?: string;
}

export interface LintReport {
  ok: boolean;
  violations: LintViolation[];
  recipe_match?: { id: string; score: number } | null;
  snapshot_version: string;
}
