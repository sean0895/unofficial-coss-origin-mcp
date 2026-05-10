#!/usr/bin/env bash
# UserPromptSubmit hook — fires on every user message.
#
# 1. Parses TOGGLE PHRASES from raw user prompt only (stdin from Claude Code).
#    - These are the ONLY way to change state.enabled / state.level.
#    - Claude-generated text in tool calls or assistant messages CANNOT toggle.
# 2. Detects UI intent → injects a one-line reminder into context.
# 3. Anti-bounce: rejects toggle if last_toggle_turn < 2 turns ago.
#
# Hook contract: stdin = JSON { hook_event_name, prompt, session_id, ... }.
# Output to stdout becomes additionalContext for the assistant.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
. "$HERE/lib/common.sh"
# shellcheck source=lib/state.sh
. "$HERE/lib/state.sh"
# shellcheck source=lib/audit.sh
. "$HERE/lib/audit.sh"

# Read full stdin payload.
payload="$(cat || true)"
prompt=""
if command -v jq >/dev/null 2>&1; then
    prompt="$(printf '%s' "$payload" | jq -r '.prompt // .user_message // empty' 2>/dev/null || true)"
fi
[ -z "$prompt" ] && prompt="$payload"

# Bail early if no COSS project / no config.
coss_is_coss_project || exit 0

# ----- toggle parsing -----
# Match strict patterns. Phrase must appear at start of a line, or as
# an explicit /coss-mode invocation. Anti-spoof: "the user said 'stop coss'"
# inside Claude's prior text doesn't fire because we only see the user's prompt.
detect_toggle() {
    local p="$1"
    local p_lower; p_lower="$(printf '%s' "$p" | tr '[:upper:]' '[:lower:]')"

    # Off
    if printf '%s' "$p_lower" | grep -qE '(^|[[:space:]])(/coss-mode[[:space:]]+off|stop coss|coss off|coss-mode off|disable coss)([[:space:]]|$)'; then
        echo "DISABLE"; return
    fi
    # On
    if printf '%s' "$p_lower" | grep -qE '(^|[[:space:]])(/coss-mode[[:space:]]+on|coss on|coss-mode on|enable coss)([[:space:]]|$)'; then
        echo "ENABLE"; return
    fi
    # Level
    if printf '%s' "$p_lower" | grep -qE '(^|[[:space:]])/coss-mode[[:space:]]+ultra([[:space:]]|$)'; then
        echo "LEVEL ultra"; return
    fi
    if printf '%s' "$p_lower" | grep -qE '(^|[[:space:]])/coss-mode[[:space:]]+lite([[:space:]]|$)'; then
        echo "LEVEL lite"; return
    fi
    if printf '%s' "$p_lower" | grep -qE '(^|[[:space:]])/coss-mode[[:space:]]+full([[:space:]]|$)'; then
        echo "LEVEL full"; return
    fi
    echo "NONE"
}

apply_toggle() {
    local action="$1"
    # anti-bounce: require ≥2 turns since last toggle
    local last_turn turn now_turn
    last_turn="$(coss_state_get last_toggle_turn 2>/dev/null || echo 0)"
    [ -z "$last_turn" ] && last_turn=0
    # We don't have a reliable turn counter from stdin payload; approximate via timestamp diff.
    local last_ts; last_ts="$(coss_state_get last_toggle_at 2>/dev/null || echo '')"
    if [ -n "$last_ts" ] && [ "$last_ts" != "null" ]; then
        local now_s last_s last_clean
        now_s="$(date -u +%s)"
        last_clean="$(printf '%s' "$last_ts" | sed -E 's/\.[0-9]+Z$/Z/')"
        last_s="$(date -u -j -f "%Y-%m-%dT%H:%M:%SZ" "$last_clean" +%s 2>/dev/null \
                 || date -u -d "$last_clean" +%s 2>/dev/null || echo 0)"
        if [ $((now_s - last_s)) -lt 5 ]; then
            printf '⚠ COSS-ORIGIN-MODE toggle ignored — anti-bounce (re-issued <5s after prior toggle)\n' >&2
            coss_audit_log "toggle-bounce-rejected" "action=$action"
            return
        fi
    fi
    case "$action" in
        DISABLE)
            coss_state_set_enabled false
            coss_audit_log "toggle" "from_user=true" "to=disabled"
            cat <<'BANNER' >&2

╔══════════════════════════════════════════════════════════════╗
║  ⚠ COSS-ORIGIN-MODE: OFF                                     ║
║  UI VIOLATIONS NO LONGER CHECKED.                            ║
║  Re-enable any time:  /coss-mode on                          ║
║  Status line will show "COSS-ORIGIN: OFF ✗" until enabled.   ║
╚══════════════════════════════════════════════════════════════╝
BANNER
            ;;
        ENABLE)
            coss_state_set_enabled true
            coss_audit_log "toggle" "from_user=true" "to=enabled"
            printf '✓ COSS-ORIGIN-MODE: ON (level=%s)\n' "$(coss_state_get level)" >&2
            ;;
        "LEVEL "*)
            local level="${action#LEVEL }"
            coss_state_set_level "$level"
            coss_state_set_enabled true
            coss_audit_log "toggle" "from_user=true" "to=level:$level"
            printf '✓ COSS-ORIGIN-MODE: level=%s\n' "$level" >&2
            ;;
    esac
}

action="$(detect_toggle "$prompt")"
if [ "$action" != "NONE" ]; then
    apply_toggle "$action"
fi

# ----- UI intent reminder -----
# Inject ONE-LINE reminder when prompt mentions UI work. Throttled per-session.
enabled="$(coss_state_get enabled 2>/dev/null || echo true)"
if [ "$enabled" = "true" ]; then
    p_lower="$(printf '%s' "$prompt" | tr '[:upper:]' '[:lower:]')"
    if printf '%s' "$p_lower" | grep -qE '\b(component|screen|jsx|tsx|button|popover|dialog|drawer|sheet|form|page|layout|render|build (ui|frontend)|design|styling|tailwind|coss)\b'; then
        level="$(coss_state_get level)"
        mode="$(coss_effective_mode)"
        printf '\n[coss-origin-mode active: level=%s mode=%s] Before writing UI: call coss-origin MCP find_recipe → use ComposedPlan → no hex / no bg-blue-500 / no raw <button>. Lint via coss-origin lint_jsx after.\n' "$level" "$mode"
    fi
fi
