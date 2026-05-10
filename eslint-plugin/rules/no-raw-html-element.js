/** @type {import("eslint").Rule.RuleModule} */
const FORBIDDEN = new Set(["button", "input", "select", "textarea", "dialog", "menu"]);

export default {
  meta: {
    type: "problem",
    docs: { description: "Forbid raw HTML form elements. Use COSS primitives." },
    schema: [],
    messages: {
      raw: "Raw <{{tag}}> — use COSS primitive from @/components/ui.",
    },
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        if (node.name.type !== "JSXIdentifier") return;
        const tag = node.name.name;
        if (!FORBIDDEN.has(tag)) return;
        if (tag === "input") {
          const typeAttr = node.attributes.find(
            (a) => a.type === "JSXAttribute" && a.name?.name === "type",
          );
          if (typeAttr && typeAttr.value?.type === "Literal" && typeAttr.value.value === "hidden") {
            return;
          }
        }
        context.report({ node, messageId: "raw", data: { tag } });
      },
    };
  },
};
