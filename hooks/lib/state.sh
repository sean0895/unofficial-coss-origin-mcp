#!/usr/bin/env bash
# State file manager — anti-spoof. Only writeable by hooks; toggle phrases
# come from raw user prompt (UserPromptSubmit stdin). Claude attempting to
# Write the state file is blocked by pre-tool-use.sh.

set -euo pipefail

# shellcheck source=common.sh
. "$(dirname "${BASH_SOURCE[0]}")/common.sh"

# State schema:
# {
#   "schema_version": 1,
#   "enabled": true,
#   "level": "full",                            # full | lite | ultra
#   "mode": "enforce",                          # enforce | dry-run (auto-flips)
#   "install_timestamp": "ISO8601",             # set at install, never edited
#   "dry_run_until":   "ISO8601",               # install + 168h, never extended
#   "session_id": "...",                        # reset per SessionStart
#   "session_started_at": "ISO8601",
#   "last_toggle_at": "ISO8601",
#   "last_toggle_turn": 0,
#   "toggle_history": [ { "at": "...", "from": "...", "to": "...", "by": "user-prompt" } ],
#   "violation_count_session": 0,
#   "consumed_recipe_ids": [],                  # appended by Pre/PostToolUse from MCP calls
#   "last_find_recipe": { "query": "...", "at": "...", "turn": 0 }
# }

coss_state_init_default() {
    local install_ts="$1"
    local dry_until="$2"
    local session_id="$3"
    cat <<EOF
{
  "schema_version": 1,
  "enabled": true,
  "level": "full",
  "mode": "dry-run",
  "install_timestamp": "$install_ts",
  "dry_run_until": "$dry_until",
  "session_id": "$session_id",
  "session_started_at": "$(date -u +%FT%TZ)",
  "last_toggle_at": null,
  "last_toggle_turn": 0,
  "toggle_history": [],
  "violation_count_session": 0,
  "consumed_recipe_ids": [],
  "last_find_recipe": null
}
EOF
}

coss_state_read() {
    [ -f "$COSS_STATE_FILE" ] || return 1
    cat "$COSS_STATE_FILE"
}

coss_state_get() {
    # jq's `// empty` collapses `false` to empty — use tostring + null-strip instead.
    local key="$1"
    [ -f "$COSS_STATE_FILE" ] || { echo ""; return; }
    if command -v jq >/dev/null 2>&1; then
        local v
        v="$(jq -r ".$key | if . == null then \"\" else . | tostring end" "$COSS_STATE_FILE" 2>/dev/null)"
        printf '%s' "$v"
    else
        grep -oE "\"$key\"\\s*:\\s*(\"[^\"]*\"|true|false|null|[0-9]+)" "$COSS_STATE_FILE" \
            | head -1 | sed -E "s/.*\"$key\"\\s*:\\s*\"?([^\"]*)\"?/\\1/"
    fi
}

coss_state_atomic_write() {
    # $1 = full json content. Uses lockfile to prevent races.
    local body="$1"
    mkdir -p "$COSS_HOME"
    local tmp; tmp="$(mktemp "$COSS_STATE_FILE.XXXXXX")"
    printf '%s' "$body" > "$tmp"
    mv -f "$tmp" "$COSS_STATE_FILE"
    chmod 600 "$COSS_STATE_FILE"
}

# coss_state_set_level full|lite|ultra
coss_state_set_level() {
    local level="$1" turn="${2:-0}"
    case "$level" in full|lite|ultra) ;; *) coss_die "invalid level: $level"; return 1 ;; esac
    local state; state="$(coss_state_read 2>/dev/null || echo '{}')"
    if command -v jq >/dev/null 2>&1; then
        local new
        new="$(jq --arg lvl "$level" --arg now "$(date -u +%FT%TZ)" --argjson turn "$turn" \
            '.level = $lvl
            | .enabled = true
            | .last_toggle_at = $now
            | .last_toggle_turn = $turn
            | .toggle_history += [{ at: $now, to: $lvl, by: "user-prompt" }]' \
            <<<"$state")"
        coss_state_atomic_write "$new"
    fi
}

coss_state_set_enabled() {
    local enabled="$1" turn="${2:-0}"
    case "$enabled" in true|false) ;; *) coss_die "invalid enabled: $enabled"; return 1 ;; esac
    local state; state="$(coss_state_read 2>/dev/null || echo '{}')"
    if command -v jq >/dev/null 2>&1; then
        local new
        new="$(jq --argjson en "$enabled" --arg now "$(date -u +%FT%TZ)" --argjson turn "$turn" \
            '.enabled = $en
            | .last_toggle_at = $now
            | .last_toggle_turn = $turn
            | .toggle_history += [{ at: $now, enabled: $en, by: "user-prompt" }]' \
            <<<"$state")"
        coss_state_atomic_write "$new"
    fi
}

coss_state_record_recipe_consumption() {
    local recipe_id="$1"
    [ -z "$recipe_id" ] && return 0
    local state; state="$(coss_state_read 2>/dev/null || echo '{}')"
    if command -v jq >/dev/null 2>&1; then
        local new
        new="$(jq --arg rid "$recipe_id" \
            '.consumed_recipe_ids = ((.consumed_recipe_ids // []) + [$rid] | unique)' \
            <<<"$state")"
        coss_state_atomic_write "$new"
    fi
}

coss_state_record_find_query() {
    local query="$1" turn="${2:-0}"
    [ -z "$query" ] && return 0
    local state; state="$(coss_state_read 2>/dev/null || echo '{}')"
    if command -v jq >/dev/null 2>&1; then
        local new
        new="$(jq --arg q "$query" --arg now "$(date -u +%FT%TZ)" --argjson turn "$turn" \
            '.last_find_recipe = { query: $q, at: $now, turn: $turn }' \
            <<<"$state")"
        coss_state_atomic_write "$new"
    fi
}

# ----- effective mode (resolves dry-run expiry) -----
# echoes "enforce" or "dry-run".
coss_effective_mode() {
    local mode dry_until now
    mode="$(coss_state_get mode)"
    [ "$mode" = "enforce" ] && { echo enforce; return; }
    dry_until="$(coss_state_get dry_run_until)"
    if [ -z "$dry_until" ] || [ "$dry_until" = "null" ]; then
        echo enforce; return
    fi
    # Compare ISO timestamps lexicographically.
    now="$(date -u +%FT%TZ)"
    if [ "$now" \> "$dry_until" ]; then
        # dry-run window expired — auto-flip and persist (cannot be reversed).
        if command -v jq >/dev/null 2>&1; then
            local state new
            state="$(coss_state_read 2>/dev/null || echo '{}')"
            new="$(jq '.mode = "enforce"' <<<"$state")"
            coss_state_atomic_write "$new"
        fi
        echo enforce
    else
        echo dry-run
    fi
}
