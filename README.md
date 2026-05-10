# unofficial-coss-origin-mcp

Unofficial Model Context Protocol (MCP) server for the [COSS Origin](https://coss.com/origin) component library.

> Not affiliated with or endorsed by COSS. The "unofficial-" prefix is permanent.

## Why

COSS UI gives you 55 primitives. **COSS Origin** ships 484 hand-built recipes
on top of them — every variant of every shape (popover with arrow + search,
button with social provider + loading, calendar with range + presets, …).

If you've installed `@coss/*` primitives in your codebase, you have the parts.
You don't have the **compositions** — the way COSS Origin assembles them. So
agents like Claude / Cursor / Copilot end up reinventing them, often badly.

This MCP is the missing layer:

- 484 recipes indexed as **structured composition plans** (not raw JSX)
- 55 primitives with full registry references
- 25 easing classes (linear + 8 Penner families × 3 directions) with curves and use-cases
- 58 doc pages searchable by full-text
- A JSX **lint engine** that catches hardcoded colors, raw `<button>`, and hallucinated COSS imports
- A **compare-to-recipe** tool that diffs agent-written JSX against canonical
- A **suggest-recipe** tool that takes draft JSX and returns the closest matching canonical
- Snapshot is **hash-pinned + version-tagged** — agents can verify which truth set is in play

## Design principle: structured plans, not paste

Tools never return raw JSX. Recipes come back as `ComposedPlan`:

```jsonc
{
  "id": "recipe:p-popover-3",
  "intent": "Animated popovers",
  "primitives": ["Avatar", "AvatarFallback", "AvatarImage", "Button", "Popover", "PopoverPopup", "PopoverTrigger"],
  "variant_tokens": { "Button.size": "sm", "Button.variant": "outline" },
  "composition": "Avatar + Button + Popover + ...",
  "className_tokens": ["flex", "items-center", "gap-2", ...],
  "easing": "ease-out-quad",
  "states": ["focus", "hover", "open"],
  "a11y": ["aria-haspopup on trigger", "aria-expanded reflects open state"],
  "rules": ["Compose with the primitives listed.", "No hex colors, no Tailwind color-scale.", ...],
  "source_ref": "https://coss.com/ui/r/p-popover-3.json",
  "snapshot_version": "2026-05-10"
}
```

The agent uses primitives **already installed** in its repo, guided by the
plan. No copy-paste, no import drift, no `bg-blue-500` slop.

## Install

```bash
npm i -g unofficial-coss-origin-mcp
# or per-project:
npx unofficial-coss-origin-mcp
```

## MCP client config

### Claude Desktop / Claude Code

Add to `claude_desktop_config.json` (or `~/.claude/settings.json`):

```jsonc
{
  "mcpServers": {
    "coss-origin": {
      "command": "npx",
      "args": ["-y", "unofficial-coss-origin-mcp"]
    }
  }
}
```

### Cursor

`.cursor/mcp.json`:

```jsonc
{
  "mcpServers": {
    "coss-origin": {
      "command": "npx",
      "args": ["-y", "unofficial-coss-origin-mcp"]
    }
  }
}
```

### VS Code (Copilot Chat MCP)

`.vscode/mcp.json`:

```jsonc
{
  "servers": {
    "coss-origin": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "unofficial-coss-origin-mcp"]
    }
  }
}
```

## Tools

| Tool                  | What it does                                                        |
| --------------------- | ------------------------------------------------------------------- |
| `find_recipe`         | **Flagship.** Search by intent ("loading button"). Returns ranked plans. |
| `get_recipe`          | Get one recipe's structured plan by id.                             |
| `list_variants`       | Every recipe for a primitive (e.g. `button` → 41).                  |
| `list_intents`        | Full intent taxonomy with counts.                                   |
| `list_components`     | All 55 COSS primitives.                                             |
| `get_component`       | One primitive's contract.                                           |
| `list_easings`        | All 25 easing classes (curve + duration pairings).                  |
| `get_easing`          | One easing.                                                         |
| `search_docs`         | Full-text over the 58 doc pages.                                    |
| `get_doc`             | One doc page (markdown).                                            |
| `lint_jsx`            | Drift detector for agent-written JSX.                               |
| `compare_to_recipe`   | Diff agent JSX against a canonical recipe.                          |
| `suggest_recipe`      | Reverse: given draft JSX, find closest canonical.                   |
| `verify_snapshot`     | Manifest (hash + version + counts).                                 |

## Recommended agent workflow

1. **`find_recipe(intent)`** — describe what user is building.
2. Pick a recipe, read its `ComposedPlan`.
3. Write JSX in your repo, using primitives you already have installed, following the plan's `rules` + `a11y`.
4. **`lint_jsx(source)`** — catch drift.
5. **`compare_to_recipe(source, recipe_id)`** — verify fidelity.
6. Iterate until clean.

A starter rules pack for your `CLAUDE.md` / cursor rules is shipped in
[`claude-rules.md`](./claude-rules.md).

## Snapshot refresh

```bash
bun run snapshot   # crawl → normalize → index → manifest
bun run build
```

The snapshot is shipped inside the npm package. To pin to a known version,
install `unofficial-coss-origin-mcp@<date>`.

## Architecture

```
coss.com/ui/r/registry.json       (551 items: 55 ui + 484 blocks + libs/hooks)
coss.com/ui/r/{name}.json         (per-item source)
coss.com/ui/llms.txt              (60 doc URLs)
coss.com/ui/docs/*.md             (markdown docs)
        │
        ▼  scripts/crawl.ts        ← .cache/raw/ (3.3 MB)
        │
        ▼  scripts/normalize.ts    ← knowledge/{components,recipes,easings,docs,...}.json
        │
        ▼  scripts/index.ts        ← knowledge/search-*.json + manifest.json
        │
        ▼  src/server.ts           ← MCP stdio server (hash-pinned snapshot)
```

## Status

- **Snapshot version**: 2026-05-10
- **Items indexed**: 55 components + 484 recipes + 25 easings + 58 docs + 5 libs + 2 hooks
- **Test coverage**: 27/27 passing
- **License**: MIT (server). Recipe source content is COSS-owned and fetched from `coss.com` at snapshot time; the snapshot redistributes it for offline use only.
