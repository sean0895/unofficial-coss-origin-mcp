/** @type {import("eslint").Rule.RuleModule} */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

let cachedSnapshot = null;
const loadSnapshot = (cwd) => {
  if (cachedSnapshot) return cachedSnapshot;
  const candidates = [
    join(cwd, "node_modules", "unofficial-coss-origin-mcp", "knowledge", "components.json"),
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "knowledge", "components.json"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      const components = JSON.parse(readFileSync(p, "utf-8"));
      const allowed = new Set();
      for (const c of components) {
        const kebab = c.name;
        const pascal = kebab.split("-").map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("");
        allowed.add(pascal);
        for (const suffix of ["Item","Trigger","Content","Header","Footer","Description","Title","Popup","Group","Label","Action","Cancel","Close","Backdrop","Portal","Provider","Root","Indicator","Separator","Body","Cell","Row","Head","Caption","Image","Fallback","CreateHandle"]) {
          allowed.add(pascal + suffix);
        }
      }
      cachedSnapshot = allowed;
      return cachedSnapshot;
    }
  }
  cachedSnapshot = new Set();
  return cachedSnapshot;
};

export default {
  meta: {
    type: "problem",
    docs: { description: "Imports of COSS primitives must exist in the snapshot." },
    schema: [],
    messages: {
      missing: 'Imported "{{name}}" not found in COSS snapshot. Possible hallucination.',
    },
  },
  create(context) {
    const allowed = loadSnapshot(context.cwd ?? process.cwd());
    if (allowed.size === 0) return {};
    return {
      ImportDeclaration(node) {
        const src = node.source.value;
        if (typeof src !== "string") return;
        if (!/^@coss\/|@\/components\/ui\/|@\/registry\/default\/ui\//.test(src)) return;
        for (const spec of node.specifiers) {
          if (spec.type !== "ImportSpecifier") continue;
          const importedName = spec.imported.name;
          if (!/^[A-Z]/.test(importedName)) continue;
          if (!allowed.has(importedName)) {
            context.report({ node: spec, messageId: "missing", data: { name: importedName } });
          }
        }
      },
    };
  },
};
