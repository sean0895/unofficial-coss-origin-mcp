#!/usr/bin/env bash
# SessionStart hook — initializes per-session COSS Origin Mode state.
#
# Reads .coss-mode.json (project-local), preserves install_timestamp + dry_run_until
# (so they cannot be reset by spawning new sessions), and emits a banner.
#
# Hardening:
#   - install_timestamp + dry_run_until are NEVER overwritten if state file exists.
#     Only a fresh install can set them (via install.ts).
#   - Effective mode is computed (auto-flips dry-run → enforce after expiry).
#   - If repo is COSS project (@coss/* deps) and no .coss-mode.json present,
#     warn loudly so user reinstalls. We do NOT silently disable.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
. "$HERE/lib/common.sh"
# shellcheck source=lib/state.sh
. "$HERE/lib/state.sh"
# shellcheck source=lib/audit.sh
. "$HERE/lib/audit.sh"

mkdir -p "$COSS_HOME"

session_id="$(date -u +%Y%m%dT%H%M%SZ)-$$"

# preserve install/dry-run fields from prior state if present
install_ts=""
dry_until=""
if [ -f "$COSS_STATE_FILE" ] && command -v jq >/dev/null 2>&1; then
    install_ts="$(jq -r '.install_timestamp // empty' "$COSS_STATE_FILE")"
    dry_until="$(jq -r '.dry_run_until // empty' "$COSS_STATE_FILE")"
fi

if [ -z "$install_ts" ]; then
    # uninitialized — install hasn't run. Treat as not-yet-installed.
    install_ts="$(date -u +%FT%TZ)"
    dry_until="$(date -u -v +168H +%FT%TZ 2>/dev/null || date -u -d '+168 hours' +%FT%TZ)"
fi

# write fresh session state but preserve immutable fields
state_body="$(coss_state_init_default "$install_ts" "$dry_until" "$session_id")"
coss_state_atomic_write "$state_body"

coss_audit_log "session-start" "session_id=$session_id" "install_ts=$install_ts"

# Emit banner to stderr (so it appears in Claude Code transcript context).
banner=""
if coss_is_coss_project; then
    config="$(coss_find_config 2>/dev/null || echo '')"
    if [ -z "$config" ]; then
        banner+="⚠ COSS-ORIGIN-MODE: project has @coss/* deps but no .coss-mode.json. Run: bunx unofficial-coss-origin-mcp install\n"
    else
        mode="$(coss_effective_mode)"
        level="$(coss_state_get level)"
        banner+="✓ COSS-ORIGIN-MODE active — level: ${level:-full}, mode: $mode\n"
        if [ "$mode" = "dry-run" ]; then
            banner+="  dry-run window ends: $dry_until (auto-flips to enforce)\n"
        fi
        banner+="  toggle: '/coss-mode lite|full|ultra' or 'stop coss' / 'coss on'\n"
        banner+="  status line shows live state\n"
    fi
fi

if [ -n "$banner" ]; then
    printf '%b' "$banner" >&2
fi
