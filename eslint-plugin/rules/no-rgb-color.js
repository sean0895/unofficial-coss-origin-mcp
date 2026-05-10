/** @type {import("eslint").Rule.RuleModule} */
const RGB_RE = /\b(?:rgb|rgba|hsl|hsla)\([^)]*\)/g;

export default {
  meta: {
    type: "problem",
    docs: { description: "Forbid rgb/hsl colors. Use design tokens." },
    schema: [],
    messages: {
      rgb: "Inline color {{value}} — use semantic token.",
    },
  },
  create(context) {
    const check = (node, raw) => {
      for (const m of String(raw).matchAll(RGB_RE)) {
        context.report({ node, messageId: "rgb", data: { value: m[0] } });
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
