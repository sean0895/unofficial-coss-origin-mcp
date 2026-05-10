/** @type {import("eslint").Rule.RuleModule} */
const TW_RE = /\b(?:bg|text|border|ring|fill|stroke|from|to|via|outline|divide|placeholder|caret|accent)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/g;

export default {
  meta: {
    type: "problem",
    docs: { description: "Forbid Tailwind color-scale classes. Use semantic tokens." },
    schema: [],
    messages: {
      scale: "Color-scale class {{value}} — use semantic class (bg-muted, text-foreground, border-input, etc).",
    },
  },
  create(context) {
    const check = (node, raw) => {
      for (const m of String(raw).matchAll(TW_RE)) {
        context.report({ node, messageId: "scale", data: { value: m[0] } });
      }
    };
    return {
      Literal(node) {
        if (typeof node.value === "string") check(node, node.raw ?? node.value);
      },
      TemplateElement(node) {
        check(node, node.value.raw);
      },
    };
  },
};
