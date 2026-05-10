---
name: coss-mode
description: COSS Origin UI enforcement mode — pairs with the unofficial-coss-origin-mcp server to prevent UI hallucination. ACTIVE EVERY UI TASK. No revert after many turns. Off only via "stop coss" / "/coss-mode off" / "coss off". Default level = full. Switch via `/coss-mode lite|full|ultra`. Status line shows live state.
---

# COSS-Origin-Mode

Pairs with `unofficial-coss-origin-mcp`. Enforces COSS Origin UI conventions
via local hooks + MCP recipe lookup. Modeled on caveman-mode.

<EXTREMELY-IMPORTANT>
If you are about to write JSX/TSX into a project that has `@coss/*` deps and
`COSS-ORIGIN-MODE` is active (status line shows `COSS-ORIGIN: full ✓` or
`ultra ✓`), you ABSOLUTELY MUST query the `coss-origin` MCP first. The
PreToolUse hook will BLOCK Writes that contain hex colors, RGB/HSL inline
colors, Tailwind color-scale classes (`bg-blue-500`), raw `<button>/<input>/
<select>/<textarea>/<dialog>/<menu>` elements, or imports of primitives that
do not exist in the snapshot.

You CANNOT toggle COSS-Origin-Mode yourself. Only the user can, via raw
prompt. The state file is owned by the user-prompt-submit hook.
</EXTREMELY-IMPORTANT>

## Status line

| Display | Meaning |
|---|---|
| `COSS-ORIGIN: full ✓` | enforce mode, default level — errors block, warns log |
| `COSS-ORIGIN: ultra ✓` | enforce mode + warns also block + consumption-proof required |
| `COSS-ORIGIN: lite ⚠` | enforce mode but only warns, never blocks (user-overridden) |
| `COSS-ORIGIN: dry-run 4d12h` | bounded countdown until auto-flip to enforce — cannot be extended |
| `COSS-ORIGIN: OFF ✗` | user-disabled — UI VIOLATIONS NOT CHECKED |

## User toggle phrases

These are the ONLY ways to change state. They are parsed from the **user's raw
prompt** by the `UserPromptSubmit` hook. Assistant-generated text never
toggles.

| Phrase | Effect |
|---|---|
| `/coss-mode full` | level=full (default) |
| `/coss-mode ultra` | level=ultra (consumption-proof required, warns block) |
| `/coss-mode lite` | level=lite (warn-only) |
| `/coss-mode off` / `stop coss` / `coss off` / `disable coss` | enabled=false (status line shows OFF) |
| `/coss-mode on` / `coss on` / `coss-mode on` / `enable coss` | enabled=true |

Anti-bounce: a toggle is ignored if re-issued <5s after the prior toggle.

## Workflow when COSS-Origin-Mode is active

```
1. find_recipe(intent)            # MCP — describe what user wants
2. read ComposedPlan returned
3. write JSX in repo, using:
     • only primitives in plan.primitives
     • only className_tokens in plan.className_tokens
     • variant prop values from plan.variant_tokens
     • plan.easing on motion-bearing elements
     • every state in plan.states
     • every a11y rule in plan.a11y
4. lint_jsx(source)               # MCP — drift detector
5. compare_to_recipe(source, id)  # MCP — fidelity diff
6. iterate until clean
```

The PreToolUse hook will block your Write if step 1 was skipped (in `ultra`
level — consumption-proof required) or if the Write contains forbidden
patterns (every level except `lite`).

## Hard rules (the wall)

These are hardcoded `error` severity. The user CANNOT downgrade them via
config. Pragmas can suppress one rule per line, but pragmas added in the same
diff as the violation are atomic-blocked.

| Rule | Description |
|---|---|
| `no-hex-color` | `#fff`, `#aabbcc` etc. — use semantic token. |
| `no-rgb-color` | `rgb(...)`, `rgba(...)`, `hsl(...)`, `hsla(...)` — use token. |
| `no-tailwind-color-scale` | `bg-blue-500`, `text-red-700` — use semantic class. |
| `no-raw-html-element` | `<button>`, `<input>`, `<select>`, `<textarea>`, `<dialog>`, `<menu>` — use COSS primitive. |
| `primitive-not-in-snapshot` | Imports of symbols not in the COSS snapshot. |
| `no-state-file-write` | Writes to `.coss-mode/state.json` or audit logs. State is hook-owned. |
| `pragma-self-suppression` | `@coss-allow` added in same diff as violation. |
| `pragma-malformed` | `@coss-allow` without `<rule> <reason ≥10 chars>`. |
| `pragma-quota-exceeded` | More than 3 `@coss-allow` pragmas in one file. |

## Pragma escape hatch (narrow + audited)

```tsx
// @coss-allow no-hex-color reason: third-party SVG bakes literal hex into d-attr
<svg fill="#ff6600" />
```

Constraints:

- **Format**: `// @coss-allow <rule-name> <reason ≥10 chars>`. Rule name from the table above.
- **Pre-existing only**: must already be on disk before the Write that contains the violation. Atomic block prevents Claude from adding both in one Write.
- **Quota**: max 3 pragmas per file. Hard cap.
- **Audited**: every suppression logged to `~/.claude/.coss-mode/audit/YYYY-MM.jsonl`.

## Examples — caveman-style

### Build a popover with avatar

```
USER: build a profile popover

(status line: COSS-ORIGIN: full ✓)

ASSISTANT:
1. tool: coss-origin.find_recipe { intent: "profile popover with avatar and logout" }
2. picks recipe:p-popover-3 → reads ComposedPlan
3. writes Profile.tsx using Avatar, Button, Popover from @/components/ui
   — variant={"outline"} size={"sm"} per plan.variant_tokens
   — gap-3, items-center, w-48 per plan.className_tokens
   — aria-haspopup, aria-expanded per plan.a11y
4. tool: coss-origin.lint_jsx { source: <profile.tsx> }
5. tool: coss-origin.compare_to_recipe { source, recipe_id: "recipe:p-popover-3" }
```

### Bypass attempt blocked

```
ASSISTANT writes:
  <div style={{color:"#ff0000"}}>danger</div>

PreToolUse → BLOCKED: no-hex-color. Use text-destructive.
```

### Off-toggle visible

```
USER: stop coss
(status line flips: COSS-ORIGIN: OFF ✗)

ASSISTANT writes <button>x</button> → ALLOWED (mode off).
Audit log records every Write while OFF for review.

USER: coss on
(status line flips: COSS-ORIGIN: full ✓)
```

## What COSS-Origin-Mode is NOT

- Not Caveman. Caveman cuts tokens; this enforces UI rules.
- Not auto-installable. User runs `bunx unofficial-coss-origin-mcp install`.
- Not optional once installed. Hooks own enforcement; only `/coss off` or uninstall disables.
- Not a code generator. MCP returns plans, you compose locally.

## When to drop COSS-Origin-Mode reminders

This skill stays active for ALL UI work. Do not drop reminders for "simple"
JSX. The hooks will catch what you miss anyway, but the goal is to prevent
the round-trip cost of a block.
