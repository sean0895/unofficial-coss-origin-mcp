/** @type {import("eslint").Rule.RuleModule} */
const PRAGMA_RE = /@coss-allow\b/;
const PRAGMA_VALID = /@coss-allow\s+[a-z-]+\s+.{10,}/;
const KNOWN_RULES = new Set([
  "no-hex-color",
  "no-rgb-color",
  "no-tailwind-color-scale",
  "no-raw-html-element",
  "primitive-not-in-snapshot",
]);

export default {
  meta: {
    type: "problem",
    docs: { description: "@coss-allow pragmas must be well-formed and within quota." },
    schema: [],
    messages: {
      malformed: "@coss-allow requires <rule-name> <reason ≥10 chars>. Format: // @coss-allow no-hex-color reason: <why>",
      unknown: "@coss-allow rule {{rule}} is not a known coss-mode rule.",
      quota: "{{count}} @coss-allow pragmas in one file. Hard cap = 3.",
    },
  },
  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();
    return {
      "Program:exit"() {
        const comments = sourceCode.getAllComments().filter((c) => PRAGMA_RE.test(c.value));
        if (comments.length > 3) {
          context.report({ loc: comments[0].loc, messageId: "quota", data: { count: comments.length } });
        }
        for (const c of comments) {
          if (!PRAGMA_VALID.test(c.value)) {
            context.report({ loc: c.loc, messageId: "malformed" });
            continue;
          }
          const m = c.value.match(/@coss-allow\s+([a-z-]+)/);
          if (m && !KNOWN_RULES.has(m[1])) {
            context.report({ loc: c.loc, messageId: "unknown", data: { rule: m[1] } });
          }
        }
      },
    };
  },
};
