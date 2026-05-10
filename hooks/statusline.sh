#!/usr/bin/env bash
# Status-line script — emits the current COSS Origin Mode state for Claude Code.
#
# Wire via ~/.claude/settings.json -> "statusLine.command".
# Output is one line, ANSI-colored.
#
# Examples:
#   COSS-ORIGIN: full ✓        (enforce, full level)
#   COSS-ORIGIN: ultra ✓       (enforce, ultra)
#   COSS-ORIGIN: lite ⚠        (enforce, lite — warn-only)
#   COSS-ORIGIN: dry-run 4d12h (countdown to enforce flip)
#   COSS-ORIGIN: OFF ✗         (user-disabled — UI VIOLATIONS UNCHECKED)
#
# Composes with other status-line scripts via concatenation; users can wrap.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
. "$HERE/lib/common.sh"
# shellcheck source=lib/state.sh
. "$HERE/lib/state.sh"

# Bail silently if not in a COSS project.
if ! coss_is_coss_project 2>/dev/null; then
    exit 0
fi

# Defaults.
enabled="$(coss_state_get enabled 2>/dev/null || echo true)"
level="$(coss_state_get level 2>/dev/null || echo full)"
mode="$(coss_effective_mode 2>/dev/null || echo enforce)"

C_RESET=$'\033[0m'
C_GREEN=$'\033[32m'
C_YELLOW=$'\033[33m'
C_RED=$'\033[31m'
C_DIM=$'\033[2m'

if [ "$enabled" = "false" ]; then
    printf '%sCOSS-ORIGIN: OFF ✗%s' "$C_RED" "$C_RESET"
    exit 0
fi

if [ "$mode" = "dry-run" ]; then
    until_ts="$(coss_state_get dry_run_until)"
    if [ -n "$until_ts" ] && [ "$until_ts" != "null" ]; then
        now_s="$(date -u +%s)"
        # strip fractional seconds — BSD `date` rejects them
        until_clean="$(printf '%s' "$until_ts" | sed -E 's/\.[0-9]+Z$/Z/')"
        end_s="$(date -u -j -f "%Y-%m-%dT%H:%M:%SZ" "$until_clean" +%s 2>/dev/null \
                || date -u -d "$until_clean" +%s 2>/dev/null || echo "$now_s")"
        secs_left=$(( end_s - now_s ))
        if [ "$secs_left" -gt 0 ]; then
            days=$(( secs_left / 86400 ))
            hours=$(( (secs_left % 86400) / 3600 ))
            printf '%sCOSS-ORIGIN: dry-run %dd%dh%s' "$C_DIM" "$days" "$hours" "$C_RESET"
            exit 0
        fi
    fi
fi

case "$level" in
    full)  printf '%sCOSS-ORIGIN: full ✓%s' "$C_GREEN" "$C_RESET" ;;
    ultra) printf '%sCOSS-ORIGIN: ultra ✓%s' "$C_GREEN" "$C_RESET" ;;
    lite)  printf '%sCOSS-ORIGIN: lite ⚠%s' "$C_YELLOW" "$C_RESET" ;;
    *)     printf 'COSS-ORIGIN: %s' "$level" ;;
esac
