/**
 * Lint engine — drift detection for agent-written JSX against COSS truth.
 *
 * Rules are deterministic regex/structural — no AST overkill needed at this
 * snapshot fidelity. Bumps to oxc-parser only if a rule needs scope info.
 */

import type { LintReport, LintViolation, RecipeNode } from "./types.js";
import type { Snapshot } from "./snapshot.js";

interface LintRule {
  id: string;
  severity: "error" | "warn" | "info";
  run: (source: string, snapshot: Snapshot) => Omit<LintViolation, "rule" | "severity">[];
}

const HEX_RE = /#[0-9a-fA-F]{3,8}\b/g;
const RGB_RE = /\b(?:rgb|hsl)a?\([^)]*\)/g;
const TW_COLOR_SCALE_RE = /\b(?:bg|text|border|ring|fill|stroke|from|to|via|outline|divide|placeholder|caret|accent)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/g;

const RAW_HTML_TAGS = ["button", "input", "select", "textarea", "dialog", "menu"];

const RULES: LintRule[] = [
  {
    id: "no-hex-color",
    severity: "error",
    run: (source) =>
      Array.from(source.matchAll(HEX_RE)).map((m) => ({
        message: `Hardcoded hex color "${m[0]}" — use design token (e.g. text-foreground, bg-primary).`,
        range: { start: m.index ?? 0, end: (m.index ?? 0) + m[0].length },
        suggestion: "Replace with a token class from coss tokens (text-foreground, bg-card, etc).",
      })),
  },
  {
    id: "no-rgb-color",
    severity: "error",
    run: (source) =>
      Array.from(source.matchAll(RGB_RE)).map((m) => ({
        message: `Inline color "${m[0]}" — use design token.`,
        range: { start: m.index ?? 0, end: (m.index ?? 0) + m[0].length },
        suggestion: "Token class (e.g. bg-primary).",
      })),
  },
  {
    id: "no-tailwind-color-scale",
    severity: "error",
    run: (source) =>
      Array.from(source.matchAll(TW_COLOR_SCALE_RE)).map((m) => ({
        message: `Tailwind color-scale class "${m[0]}" — use semantic token (text-foreground, bg-muted, border-input, etc).`,
        range: { start: m.index ?? 0, end: (m.index ?? 0) + m[0].length },
        suggestion: "Map to coss semantic class.",
      })),
  },
  {
    id: "no-raw-html-element",
    severity: "warn",
    run: (source) => {
      const out: Omit<LintViolation, "rule" | "severity">[] = [];
      for (const tag of RAW_HTML_TAGS) {
        const re = new RegExp(`<${tag}\\b`, "g");
        for (const m of source.matchAll(re)) {
          out.push({
            message: `Raw <${tag}> — use coss <${tag.charAt(0).toUpperCase()}${tag.slice(1)}> primitive.`,
            range: { start: m.index ?? 0, end: (m.index ?? 0) + m[0].length },
            suggestion: `Import from coss primitives.`,
          });
        }
      }
      return out;
    },
  },
  {
    id: "primitive-not-in-snapshot",
    severity: "warn",
    run: (source, snapshot) => {
      const known = new Set(
        snapshot.components.flatMap((c) => [
          c.name.charAt(0).toUpperCase() + c.name.slice(1).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase()),
          ...c.primitives_used,
        ]),
      );
      // only flag when imported from a coss path
      const out: Omit<LintViolation, "rule" | "severity">[] = [];
      const importRe = /import\s+\{([^}]+)\}\s+from\s+["']@\/(?:registry\/default\/ui|components\/ui)\/([^"']+)["']/g;
      for (const m of source.matchAll(importRe)) {
        const named = m[1] ?? "";
        for (const id of named.split(",").map((s) => s.trim().split(/\s+as\s+/)[0]?.trim()).filter(Boolean)) {
          if (id && !known.has(id) && /^[A-Z]/.test(id)) {
            out.push({
              message: `Imported primitive "${id}" not found in COSS snapshot. Possible hallucination.`,
              suggestion: `Search list_components or list_variants for the right symbol.`,
            });
          }
        }
      }
      return out;
    },
  },
];

export const lintJsx = (source: string, snapshot: Snapshot): LintReport => {
  const violations: LintViolation[] = [];
  for (const r of RULES) {
    for (const v of r.run(source, snapshot)) {
      violations.push({ rule: r.id, severity: r.severity, ...v });
    }
  }
  return {
    ok: violations.filter((v) => v.severity === "error").length === 0,
    violations,
    snapshot_version: snapshot.manifest.snapshot_version,
  };
};

const tokenize = (source: string): { primitives: Set<string>; classes: Set<string> } => {
  const primitives = new Set<string>();
  for (const m of source.matchAll(/<([A-Z][A-Za-z0-9]*)/g)) {
    if (m[1]) primitives.add(m[1]);
  }
  const classes = new Set<string>();
  for (const m of source.matchAll(/className=(?:"([^"]+)"|\{`([^`]+)`\})/g)) {
    const s = m[1] ?? m[2] ?? "";
    for (const t of s.split(/\s+/).filter(Boolean)) classes.add(t);
  }
  return { primitives, classes };
};

const jaccard = <T>(a: Set<T>, b: Set<T>): number => {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const v of a) if (b.has(v)) inter++;
  return inter / (a.size + b.size - inter);
};

export const suggestRecipe = (
  source: string,
  snapshot: Snapshot,
  topK = 3,
): Array<{ id: string; score: number; reason: string }> => {
  const { primitives, classes } = tokenize(source);
  const ranked: Array<{ id: string; score: number; reason: string }> = [];
  for (const r of snapshot.recipes) {
    const primScore = jaccard(primitives, new Set(r.primitives));
    const classScore = jaccard(classes, new Set(r.className_tokens));
    const score = primScore * 0.7 + classScore * 0.3;
    if (score > 0.05) {
      ranked.push({
        id: r.id,
        score: Math.round(score * 1000) / 1000,
        reason: `prim=${primScore.toFixed(2)} classes=${classScore.toFixed(2)}`,
      });
    }
  }
  ranked.sort((a, b) => b.score - a.score);
  return ranked.slice(0, topK);
};

export const compareToRecipe = (
  source: string,
  recipe: RecipeNode,
): {
  missing_primitives: string[];
  extra_primitives: string[];
  missing_class_tokens: string[];
  variant_drift: Record<string, { canonical: string[]; in_source: string[] | null }>;
  source_ref: string;
} => {
  const { primitives, classes } = tokenize(source);
  const canonicalPrim = new Set(recipe.primitives);
  const canonicalCls = new Set(recipe.className_tokens);

  const missing_primitives = [...canonicalPrim].filter((p) => !primitives.has(p)).sort();
  const extra_primitives = [...primitives].filter((p) => !canonicalPrim.has(p)).sort();
  const missing_class_tokens = [...canonicalCls].filter((c) => !classes.has(c)).sort();

  const variant_drift: Record<string, { canonical: string[]; in_source: string[] | null }> = {};
  for (const [key, canonValues] of Object.entries(recipe.variant_keys)) {
    const [tag, attr] = key.split(".");
    if (!tag || !attr) continue;
    const re = new RegExp(`<${tag}\\b[^>]*\\b${attr}=\\{?["']([^"'}]+)["']\\}?`, "g");
    const found: string[] = [];
    for (const m of source.matchAll(re)) {
      if (m[1]) found.push(m[1]);
    }
    if (found.length === 0 || canonValues.some((v) => !found.includes(v))) {
      variant_drift[key] = {
        canonical: canonValues,
        in_source: found.length ? [...new Set(found)] : null,
      };
    }
  }

  return {
    missing_primitives,
    extra_primitives,
    missing_class_tokens,
    variant_drift,
    source_ref: recipe.registry_url,
  };
};
