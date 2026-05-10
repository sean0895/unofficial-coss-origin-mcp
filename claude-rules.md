# COSS Origin MCP — Agent rules

Paste this block into your `CLAUDE.md`, `.cursorrules`, or any AI-rule file
that your agent reads. It teaches the agent how to use the
`unofficial-coss-origin-mcp` server as its "second brain" for COSS Origin UI.

---

## When building UI

You have access to the `coss-origin` MCP. **Use it before writing any new JSX**
that involves UI primitives. The tools return structured plans, not raw JSX —
your job is to compose locally using the primitives the repo already has.

### Workflow (mandatory order)

1. **Search recipes** — call `find_recipe({ intent: "<what user wants>" })`.
   Examples of valid intents:
   - `"loading button with social provider icon"`
   - `"date range picker with presets"`
   - `"empty state with retry"`
   - `"profile popover with avatar and logout"`
   - `"command palette with kbd hints"`

2. **Pick a plan**. The flagship hit is usually correct. If unsure:
   - `list_variants({ component: "<primitive>" })` to enumerate all options
   - `list_intents()` to discover taxonomy
   - `search_docs({ query: "..." })` for guidance on usage

3. **Read the plan's `rules` + `a11y` sections.** They are normative.

4. **Compose locally.**
   - Use primitives **already installed** in this repo (typically `@/components/ui/*`)
   - Use only the `className_tokens` listed in the plan
   - Set variants to the keys in `variant_tokens`
   - Apply the `easing` class on motion-bearing elements
   - Implement every state in `states`

5. **Lint your draft** — `lint_jsx({ source: <your JSX> })`. Fix every error.

6. **Compare to canonical** — `compare_to_recipe({ source, recipe_id })`. Address every gap.

### Hard rules (the linter enforces)

- **Never** use hex (`#fff`), `rgb()`, `hsl()`, or Tailwind color scales (`bg-blue-500`, `text-red-700`). Use semantic tokens (`bg-card`, `text-foreground`, `border-input`, `text-muted-foreground`, …).
- **Never** use raw `<button>`, `<input>`, `<select>`, `<textarea>`, `<dialog>`. Use the COSS primitive equivalent.
- **Never** import a COSS primitive that doesn't exist in `list_components()`. If you can't find the symbol, the recipe is wrong, not COSS.
- **Never** invent intent_tags, recipe ids, or component names. Every claim must round-trip through the MCP.

### Soft rules (best practice)

- Prefer the **first** plan returned by `find_recipe`. The ranking is intent-tuned.
- When a recipe doesn't quite fit, `suggest_recipe({ source: <your draft> })` will return the top-3 closest. Often you should switch to one of those.
- `verify_snapshot()` once per session to record the hash you're working against.
- Cite `source_ref` in your PR description for any non-trivial UI block.

### What this MCP is NOT

- Not a shadcn CLI. It does not install components into your repo.
- Not a code generator. It returns plans, not finished JSX.
- Not a styling autoformatter. Tokens come from the recipe; you choose where to apply them.
- Not authoritative on theming variables — those live in your `globals.css`. The MCP only references token *names*, never values.
