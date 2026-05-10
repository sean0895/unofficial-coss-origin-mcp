#!/usr/bin/env bash
# Shared helpers for all coss-origin hooks.
#
# Pure bash. No node/bun/python dependency — keeps PreToolUse <30ms p95.
# Sourced by every hook entry script.

set -euo pipefail

# ----- paths -----
COSS_HOME="${COSS_HOME:-$HOME/.claude/.coss-mode}"
COSS_STATE_FILE="$COSS_HOME/state.json"
COSS_AUDIT_DIR="$COSS_HOME/audit"
COSS_LEGACY_TODO_DIR="$COSS_HOME/legacy"

# Repo-local config probed up-tree from a starting dir (default = CWD).
coss_find_config() {
    local start="${1:-$PWD}"
    local dir
    if [ -d "$start" ]; then
        dir="$start"
    else
        dir="$(dirname "$start")"
    fi
    while [ "$dir" != "/" ] && [ "$dir" != "." ] && [ -n "$dir" ]; do
        if [ -f "$dir/.coss-mode.json" ]; then
            echo "$dir/.coss-mode.json"
            return 0
        fi
        dir="$(dirname "$dir")"
    done
    return 1
}

coss_find_repo_root() {
    git -C "$PWD" rev-parse --show-toplevel 2>/dev/null || echo "$PWD"
}

# ----- json helpers (bash-native, no jq required, but jq used when present) -----
coss_json_get() {
    # $1 = file, $2 = key path (dot notation, simple).
    # Falls back to grep+sed if jq missing.
    local file="$1" key="$2"
    if command -v jq >/dev/null 2>&1; then
        jq -r ".$key // empty" "$file" 2>/dev/null
    else
        grep -oE "\"${key##*.}\"\\s*:\\s*\"[^\"]*\"" "$file" \
            | head -1 | sed -E "s/.*\"${key##*.}\"\\s*:\\s*\"([^\"]*)\".*/\\1/"
    fi
}

# ----- log -----
coss_log() {
    # writes to stderr so hook stdout isn't polluted
    if [ "${COSS_DEBUG:-0}" = "1" ]; then
        printf '[coss-mode] %s\n' "$*" >&2
    fi
}

coss_die() {
    printf '[coss-mode][error] %s\n' "$*" >&2
    return 1
}

# ----- scope check -----
# Returns 0 (in scope) or 1 (out of scope).
coss_in_scope() {
    local file="$1"
    local config; config="$(coss_find_config "$file" 2>/dev/null || true)"
    [ -z "$config" ] && return 1

    # default exclusions ALWAYS apply (even if user removes from config) — anti-loophole
    case "$file" in
        *.test.tsx|*.spec.tsx|*.stories.tsx) return 1 ;;
        */node_modules/*|*/dist/*|*/.next/*|*/out/*|*/coverage/*) return 1 ;;
        */e2e/*|*/tests/*) return 1 ;;
        # primitive-author files (CVA defines colors here — REQUIRED)
        */src/components/ui/*) return 1 ;;
    esac

    # default include patterns
    case "$file" in
        *.tsx) ;;
        *) return 1 ;;
    esac

    return 0
}

# ----- COSS project detection -----
# True if package.json declares any @coss/* dep, OR repo has a .coss-mode.json.
coss_is_coss_project() {
    local root; root="$(coss_find_repo_root)"
    [ -f "$root/.coss-mode.json" ] && return 0
    if [ -f "$root/package.json" ]; then
        grep -q '"@coss/' "$root/package.json" 2>/dev/null && return 0
    fi
    return 1
}

# ----- snapshot allowlists from MCP knowledge dir -----
# Used by primitive-not-in-snapshot rule.
COSS_KNOWLEDGE_DIR="${COSS_KNOWLEDGE_DIR:-$COSS_HOME/knowledge}"

coss_snapshot_components() {
    # cached extract of component names from knowledge/components.json
    local cache="$COSS_HOME/.cache/components.txt"
    local src="$COSS_KNOWLEDGE_DIR/components.json"
    [ ! -f "$src" ] && return 0
    if [ ! -f "$cache" ] || [ "$src" -nt "$cache" ]; then
        mkdir -p "$(dirname "$cache")"
        if command -v jq >/dev/null 2>&1; then
            jq -r '.[].name' "$src" > "$cache"
        else
            grep -oE '"name"\s*:\s*"[a-z-]+"' "$src" \
                | sed -E 's/.*"name"\s*:\s*"([a-z-]+)".*/\1/' \
                | sort -u > "$cache"
        fi
    fi
    cat "$cache"
}
