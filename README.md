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

## COSS-Origin-Mode (caveman-style enforcement layer)

The MCP alone is opt-in — Claude can ignore the tool. To make COSS Origin
adherence **mandatory** the package ships a hook + skill + ESLint plugin
combo, modeled on caveman-mode. Once installed, you see live status in the
Claude Code status line and toggle on/off the same way you do caveman.

### Status-line states

```
COSS-ORIGIN: full ✓        ← enforce, default level — errors block, warns log
COSS-ORIGIN: ultra ✓       ← enforce + warns also block + recipe consumption-proof
COSS-ORIGIN: lite ⚠        ← enforce but warn-only (user-overridden)
COSS-ORIGIN: dry-run 4d12h ← bounded countdown until auto-flip to enforce
COSS-ORIGIN: OFF ✗         ← user-disabled — UI VIOLATIONS UNCHECKED
```

### User toggle phrases

These are the **only** way to change state. They are parsed from the user's
raw prompt by `UserPromptSubmit`. Assistant-generated text never toggles.

```
/coss-mode full       → level=full
/coss-mode ultra      → level=ultra
/coss-mode lite       → level=lite (warn-only)
/coss-mode off        ─┐
stop coss             ─┤
coss off              ─┴── disable for session
disable coss
/coss-mode on         ─┐
coss on               ─┤
coss-mode on          ─┴── re-enable
enable coss
```

Anti-bounce: a re-toggle within 5 seconds is ignored.

### Install

```bash
cd <your-coss-project>
bunx unofficial-coss-origin-mcp-install --scope=project
# or --scope=user for global wiring
```

The installer:
- Refuses to install if `@coss/*` deps are absent (use `--force` to override)
- Backs up `.claude/settings.json` with timestamped `.bak`
- Atomic-merges hooks, MCP entry, status line, skill — never overwrites unrelated keys
- Seeds `~/.claude/.coss-mode/state.json` with **immutable** `install_timestamp`
  and `dry_run_until` (set to install + 168h, cannot be extended)
- Writes `.coss-mode.json` template in repo root
- Runs a self-test (forces enforce mode in tmp state, fires fixture violation,
  verifies block exits with code 2)

### Uninstall

```bash
bunx unofficial-coss-origin-mcp-uninstall --scope=project
# add --purge to also delete state, audit logs, and .coss-mode.json
```

Strips coss-mode entries from settings, removes hook + skill dirs. By default
preserves audit log + state for review.

### Anti-loophole hardening (Claude cannot bypass)

| Loophole | Tightening |
|---|---|
| Claude could add `/* @coss-mode off */` file pragma | Removed. No file-level off pragma exists. |
| Claude could add `// @coss-allow` to suppress own violation | Pragmas added in **same diff** as violation → atomic block. |
| Claude could add empty `@coss-allow` | Format enforced: `@coss-allow <rule> <reason ≥10 chars>`. |
| Claude could spam pragmas | Hard cap = 3 per file. |
| Claude could `Write` to `.coss-mode/state.json` to flip flags | `PreToolUse` blocks any Write to state path, regardless of toggle. |
| Claude could delete `.coss-mode.json` to disable enforcement | `package.json` probed every hook; `@coss/*` deps + missing config → SessionStart banner warns reinstall. |
| Claude could "interpret" `stop coss` from its own text | Toggle hook reads **raw user prompt only** — assistant text never matches. |
| User downgrades all rules to warn | Critical rules hardcoded `error` in `lib/rules.sh`. Config can ESCALATE warn → error but cannot DEMOTE. |
| Garbage `find_recipe` queries to satisfy gate | `ultra` level requires query length ≥ 8, recipe-id appearing in diff (consumption-proof). |
| Dry-run kept perpetual | `dry_run_until` set at install timestamp + 168h. After expiry, hook auto-flips to enforce. **No extension API.** |
| Hooks bypassed in CI | `eslint-plugin-coss-mode` (this repo) mirrors every hook rule for CI parity. |

### Layout

```
unofficial-coss-origin-mcp/
├── src/                          ← MCP server (stdio)
├── scripts/                      ← crawler / normalizer / indexer / install / uninstall
├── knowledge/                    ← shipped snapshot (manifest + shards + search indices)
├── hooks/                        ← bash hooks (caveman-style enforcement)
│   ├── session-start.sh
│   ├── user-prompt-submit.sh
│   ├── pre-tool-use.sh           ← THE WALL
│   ├── post-tool-use.sh
│   ├── statusline.sh
│   └── lib/
│       ├── common.sh
│       ├── state.sh
│       ├── audit.sh
│       └── rules.sh
├── skill/coss-mode/SKILL.md      ← /coss-mode skill
├── eslint-plugin/                ← CI parity
└── config/.coss-mode.json.example
```

## Status

- **Snapshot version**: 2026-05-10
- **Items indexed**: 55 components + 484 recipes + 25 easings + 58 docs + 5 libs + 2 hooks
- **Test coverage**: 27/27 passing (server + tools); hook scenarios validated end-to-end
- **License**: MIT (server + hooks + plugin). Recipe source content is COSS-owned and fetched from `coss.com` at snapshot time; the snapshot redistributes it for offline use only.
