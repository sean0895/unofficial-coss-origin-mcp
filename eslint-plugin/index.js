/**
 * eslint-plugin-coss-mode — mirrors hook rules from
 * unofficial-coss-origin-mcp. Runs at lint-time so CI catches drift even when
 * Claude Code hooks aren't active.
 *
 * Usage:
 *   import cossMode from "eslint-plugin-coss-mode";
 *   export default [
 *     { plugins: { "coss-mode": cossMode },
 *       rules: { ...cossMode.configs.recommended.rules } },
 *   ];
 */

import noHexColor from "./rules/no-hex-color.js";
import noRgbColor from "./rules/no-rgb-color.js";
import noTailwindColorScale from "./rules/no-tailwind-color-scale.js";
import noRawHtmlElement from "./rules/no-raw-html-element.js";
import primitiveNotInSnapshot from "./rules/primitive-not-in-snapshot.js";
import pragmaMalformed from "./rules/pragma-malformed.js";

const plugin = {
  meta: {
    name: "eslint-plugin-coss-mode",
    version: "0.1.0",
  },
  rules: {
    "no-hex-color": noHexColor,
    "no-rgb-color": noRgbColor,
    "no-tailwind-color-scale": noTailwindColorScale,
    "no-raw-html-element": noRawHtmlElement,
    "primitive-not-in-snapshot": primitiveNotInSnapshot,
    "pragma-malformed": pragmaMalformed,
  },
  configs: {
    recommended: {
      rules: {
        "coss-mode/no-hex-color": "error",
        "coss-mode/no-rgb-color": "error",
        "coss-mode/no-tailwind-color-scale": "error",
        "coss-mode/no-raw-html-element": "error",
        "coss-mode/primitive-not-in-snapshot": "error",
        "coss-mode/pragma-malformed": "error",
      },
    },
  },
};

export default plugin;
