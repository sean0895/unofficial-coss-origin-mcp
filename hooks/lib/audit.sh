#!/usr/bin/env bash
# Audit log — append-only record of every block, allow, toggle, and pragma use.
# JSONL. Read by `bunx unofficial-coss-origin-mcp audit`.

set -euo pipefail

# shellcheck source=common.sh
. "$(dirname "${BASH_SOURCE[0]}")/common.sh"

coss_audit_log() {
    # $1 = event type, $@... = key=value pairs
    local kind="$1"; shift
    mkdir -p "$COSS_AUDIT_DIR"
    local file; file="$COSS_AUDIT_DIR/$(date -u +%Y-%m).jsonl"
    local repo; repo="$(coss_find_repo_root 2>/dev/null || echo unknown)"
    local timestamp; timestamp="$(date -u +%FT%TZ)"

    local payload="{\"at\":\"$timestamp\",\"kind\":\"$kind\",\"repo\":\"$repo\""
    for kv in "$@"; do
        local k="${kv%%=*}"
        local v="${kv#*=}"
        # JSON-escape value (basic — quotes + backslashes + newlines).
        v="${v//\\/\\\\}"
        v="${v//\"/\\\"}"
        v="${v//$'\n'/\\n}"
        payload+=",\"$k\":\"$v\""
    done
    payload+="}"
    printf '%s\n' "$payload" >> "$file"
}
