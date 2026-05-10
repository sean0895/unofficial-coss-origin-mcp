#!/usr/bin/env bash
# PostToolUse hook — fires AFTER Write / Edit succeeds.
#
# Light-touch: records consumption, audits clean writes, prints a deferred
# nudge if the saved file would benefit from a recipe match. Heavy-lift
# (calling MCP) deferred to a background process so we don't block the agent.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
. "$HERE/lib/common.sh"
# shellcheck source=lib/state.sh
. "$HERE/lib/state.sh"
# shellcheck source=lib/audit.sh
. "$HERE/lib/audit.sh"

payload="$(cat || true)"
tool=""; file=""
if command -v jq >/dev/null 2>&1; then
    tool="$(printf '%s' "$payload" | jq -r '.tool_name // empty' 2>/dev/null || true)"
    file="$(printf '%s' "$payload" | jq -r '.tool_input.file_path // empty' 2>/dev/null || true)"
fi

case "$tool" in
    Write|Edit) ;;
    # Track MCP tool consumption — record recipe ids returned by find_recipe / get_recipe.
    *find_recipe*|*get_recipe*|*compare_to_recipe*)
        result_text="$(printf '%s' "$payload" | jq -r '.tool_response.content[0].text // empty' 2>/dev/null || true)"
        if [ -n "$result_text" ]; then
            recipe_ids="$(printf '%s' "$result_text" | grep -oE 'recipe:[a-z0-9-]+' | sort -u || true)"
            for rid in $recipe_ids; do
                coss_state_record_recipe_consumption "$rid"
            done
            # also stash query for find_recipe
            query="$(printf '%s' "$payload" | jq -r '.tool_input.intent // empty' 2>/dev/null || true)"
            [ -n "$query" ] && coss_state_record_find_query "$query"
        fi
        exit 0
        ;;
    *) exit 0 ;;
esac

[ -z "$file" ] && exit 0
coss_in_scope "$file" || exit 0

# Suppress output when COSS mode is off.
enabled="$(coss_state_get enabled 2>/dev/null || echo true)"
[ "$enabled" = "false" ] && exit 0

coss_audit_log "post-write" "file=$file" "tool=$tool"
exit 0
