/** @type {import("eslint").Rule.RuleModule} */
const HEX_RE = /#[0-9a-fA-F]{3,8}\b/g;

const allowedByPragma = (sourceCode, node) => {
  const before = sourceCode.getTokenBefore(node, { includeComments: true });
  if (!before) return false;
  const text = before.type === "Line" || before.type === "Block" ? before.value : "";
  return /@coss-allow\s+no-hex-color\s+.{10,}/.test(text);
};

export default {
  meta: {
    type: "problem",
    docs: { description: "Forbid hex colors. Use design tokens." },
    schema: [],
    messages: {
      hex: "Hardcoded hex {{value}} — use design token (text-foreground, bg-primary, etc).",
    },
  },
  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();
    const checkRange = (node, raw) => {
      const matches = String(raw).matchAll(HEX_RE);
      for (const m of matches) {
        if (allowedByPragma(sourceCode, node)) continue;
        context.report({
          node,
          messageId: "hex",
          data: { value: m[0] },
        });
      }
    };
    return {
      Literal(node) {
        if (typeof node.value === "string") checkRange(node, node.raw ?? node.value);
      },
      TemplateElement(node) {
        checkRange(node, node.value.raw);
      },
    };
  },
};
