#!/usr/bin/env bash
# PreToolUse hook — THE WALL.
#
# Fires before Write / Edit. Blocks (exit 2) when the staged change violates
# COSS Origin rules. Soft (exit 0) when out of scope or in dry-run.
#
# Hook contract: stdin = JSON { tool_name, tool_input: { file_path, new_string, ... } }.
# exit 0 = allow. exit 2 = block + stderr message becomes the rejection reason.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
. "$HERE/lib/common.sh"
# shellcheck source=lib/state.sh
. "$HERE/lib/state.sh"
# shellcheck source=lib/audit.sh
. "$HERE/lib/audit.sh"
# shellcheck source=lib/rules.sh
. "$HERE/lib/rules.sh"

payload="$(cat || true)"

tool=""
file=""
content=""
old=""
if command -v jq >/dev/null 2>&1; then
    tool="$(printf '%s' "$payload" | jq -r '.tool_name // .toolName // empty' 2>/dev/null || true)"
    file="$(printf '%s' "$payload" | jq -r '.tool_input.file_path // .toolInput.file_path // empty' 2>/dev/null || true)"
    content="$(printf '%s' "$payload" | jq -r '.tool_input.new_string // .tool_input.content // empty' 2>/dev/null || true)"
    old="$(printf '%s' "$payload" | jq -r '.tool_input.old_string // empty' 2>/dev/null || true)"
fi

# Bail if not Write / Edit, or no file.
case "$tool" in Write|Edit) ;; *) exit 0 ;; esac
[ -z "$file" ] && exit 0

# Hard rule: never allow Writes to coss-mode internal state files.
# Runs BEFORE the enabled check — even when COSS mode is off, state cannot be tampered with.
# Match against the resolved $COSS_STATE_FILE / $COSS_AUDIT_DIR plus glob fallbacks.
is_state_path="false"
case "$file" in
    "$COSS_STATE_FILE"|"$COSS_HOME"/*|*/.coss-mode/state.json|*/.coss-mode/audit/*|*/.coss-mode.json)
        is_state_path="true"
        ;;
esac
if [ "$is_state_path" = "true" ]; then
    coss_audit_log "block" "rule=no-state-file-write" "file=$file"
    cat >&2 <<EOF
[coss-origin-mode] BLOCKED — Writes to coss-mode internal state are forbidden.
File: $file
State is owned by the user-prompt-submit hook. Toggle via:
  /coss-mode on|off|lite|full|ultra
or
  stop coss   /   coss on
EOF
    exit 2
fi

# If COSS mode is OFF (user-toggled), allow but stamp audit (so user has trail).
enabled="$(coss_state_get enabled 2>/dev/null || echo true)"
if [ "$enabled" = "false" ]; then
    coss_audit_log "allow-mode-off" "file=$file" "tool=$tool"
    exit 0
fi

# Out of scope = silent allow.
coss_in_scope "$file" || exit 0

# Build "diff body" — for Edit, that's new_string; for Write that's the full content.
# We treat the full body as added lines.
diff_body=""
if [ "$tool" = "Edit" ]; then
    diff_body="$content"
else
    diff_body="$content"
fi
[ -z "$diff_body" ] && exit 0

# Run rules.
findings="$(coss_run_rules "$diff_body" "$file" || true)"

# Honor pre-existing pragmas in the file (NOT the new diff).
# A pragma is valid only if it's already on disk before this Write — anti-loophole.
filter_pragma_suppressed() {
    local body="$1"
    # If file does not exist (Write creating new file), no prior pragma can apply.
    if [ ! -f "$file" ]; then
        printf '%s' "$body"
        return
    fi
    local prior_pragmas; prior_pragmas="$(grep -nE '@coss-allow' "$file" 2>/dev/null || true)"
    if [ -z "$prior_pragmas" ]; then
        printf '%s' "$body"
        return
    fi
    local allowed_rules; allowed_rules="$(printf '%s' "$prior_pragmas" \
        | grep -oE '@coss-allow\s+[a-z-]+' | awk '{print $2}' | sort -u)"
    if [ -z "$allowed_rules" ]; then
        printf '%s' "$body"
        return
    fi
    while IFS=$'\t' read -r severity rule line msg; do
        [ -z "$severity" ] && continue
        if printf '%s\n' "$allowed_rules" | grep -qx "$rule"; then
            coss_audit_log "pragma-suppressed" "rule=$rule" "file=$file" "line=$line"
            continue
        fi
        printf '%s\t%s\t%s\t%s\n' "$severity" "$rule" "$line" "$msg"
    done <<<"$body"
}

filtered="$(filter_pragma_suppressed "$findings")"

# count errors
errors="$(printf '%s' "$filtered" | awk -F'\t' '$1=="error"{c++} END{print c+0}')"
warns="$(printf '%s' "$filtered" | awk -F'\t' '$1=="warn"{c++} END{print c+0}')"

if [ "$errors" -eq 0 ] && [ "$warns" -eq 0 ]; then
    coss_audit_log "allow-clean" "file=$file" "tool=$tool"
    exit 0
fi

# Effective mode determines behavior.
mode="$(coss_effective_mode)"
level="$(coss_state_get level 2>/dev/null || echo full)"

# Lite level → never block, only warn loudly.
# Full level → block on errors.
# Ultra level → block on errors + warns.
# Dry-run mode → never block, log loudly.
should_block="false"
if [ "$mode" = "enforce" ]; then
    case "$level" in
        ultra) [ "$errors" -gt 0 ] || [ "$warns" -gt 0 ] && should_block="true" ;;
        full)  [ "$errors" -gt 0 ] && should_block="true" ;;
        lite)  should_block="false" ;;
    esac
fi

# Print findings to stderr — Claude sees these.
{
    if [ "$should_block" = "true" ]; then
        printf '\n[coss-origin-mode] BLOCKED — %d error(s), %d warn(s) in %s\n' \
            "$errors" "$warns" "$file"
    else
        printf '\n[coss-origin-mode] %s — %d error(s), %d warn(s) in %s\n' \
            "$([ "$mode" = "dry-run" ] && echo "dry-run NOT BLOCKING" || echo "WARNINGS")" \
            "$errors" "$warns" "$file"
    fi
    while IFS=$'\t' read -r severity rule line msg; do
        [ -z "$severity" ] && continue
        printf '  [%-5s] %-30s line %s: %s\n' "$severity" "$rule" "$line" "$msg"
    done <<<"$filtered"
    printf '\n  Fix or, narrowly, add // @coss-allow <rule> <reason ≥10 chars> on the offending line.\n'
    printf '  Pragmas added in the SAME diff as the violation are blocked (atomic anti-suppress).\n\n'
} >&2

if [ "$should_block" = "true" ]; then
    coss_audit_log "block" "errors=$errors" "warns=$warns" "file=$file" "level=$level"
    exit 2
else
    coss_audit_log "warn" "errors=$errors" "warns=$warns" "file=$file" "level=$level" "mode=$mode"
    exit 0
fi
