#!/usr/bin/env bash
# Rule engine — pure regex + bash. Mirrors src/lint.ts but runs <30ms.
#
# Rule severity is HARDCODED here. .coss-mode.json can ESCALATE warn → error
# but cannot DEMOTE error → warn. Anti-loophole: critical rules permanently error.

set -euo pipefail

# shellcheck source=common.sh
. "$(dirname "${BASH_SOURCE[0]}")/common.sh"

# Each rule emits findings to stdout in TSV: severity\trule\tline\tmessage
# Severity column dictates whether PreToolUse blocks the write.

# coss_rule_<name> $diff_text
# $diff_text is the NEW lines only (prefixed with `+`), stripped of `+`.

coss_rule_no_hex_color() {
    local body="$1"
    local line=0
    while IFS= read -r ln; do
        line=$((line+1))
        # skip CSS variable definitions (allowed in primitive files / globals.css)
        # but those files already excluded by scope; here in *.tsx hex is always wrong.
        # Skip data:image/svg+xml hex inside URLs (rare in tsx).
        if printf '%s' "$ln" | grep -qE '#[0-9a-fA-F]{3,8}\b' \
            && ! printf '%s' "$ln" | grep -qE 'data:image|svg\+xml'; then
            local match; match="$(printf '%s' "$ln" | grep -oE '#[0-9a-fA-F]{3,8}' | head -1)"
            printf "error\tno-hex-color\t%d\tHardcoded hex %s — use design token (text-foreground, bg-primary, etc).\n" "$line" "$match"
        fi
    done <<<"$body"
}

coss_rule_no_rgb_color() {
    local body="$1"
    local line=0
    while IFS= read -r ln; do
        line=$((line+1))
        if printf '%s' "$ln" | grep -qE '\b(rgb|rgba|hsl|hsla)\([^)]*\)'; then
            local match; match="$(printf '%s' "$ln" | grep -oE '\b(rgb|rgba|hsl|hsla)\([^)]*\)' | head -1)"
            printf "error\tno-rgb-color\t%d\tInline color %s — use semantic token.\n" "$line" "$match"
        fi
    done <<<"$body"
}

coss_rule_no_tailwind_color_scale() {
    local body="$1"
    local line=0
    local re='\b(bg|text|border|ring|fill|stroke|from|to|via|outline|divide|placeholder|caret|accent)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-[0-9]{2,3}\b'
    while IFS= read -r ln; do
        line=$((line+1))
        if printf '%s' "$ln" | grep -qE "$re"; then
            local match; match="$(printf '%s' "$ln" | grep -oE "$re" | head -1)"
            printf "error\tno-tailwind-color-scale\t%d\tColor-scale class %s — use semantic class (bg-muted, text-muted-foreground, border-input).\n" "$line" "$match"
        fi
    done <<<"$body"
}

coss_rule_no_raw_html_element() {
    local body="$1"
    local line=0
    while IFS= read -r ln; do
        line=$((line+1))
        for tag in button input select textarea dialog menu; do
            if printf '%s' "$ln" | grep -qE "<$tag\\b"; then
                # PrimitiveCase exception — we only flag lowercase tag.
                # Also skip <input type="hidden"> (non-UI).
                if [ "$tag" = "input" ] && printf '%s' "$ln" | grep -qE 'type="hidden"'; then
                    continue
                fi
                printf "error\tno-raw-html-element\t%d\tRaw <%s> — use coss primitive (import from @/components/ui).\n" "$line" "$tag"
            fi
        done
    done <<<"$body"
}

coss_rule_primitive_not_in_snapshot() {
    local body="$1"
    local known; known="$(coss_snapshot_components 2>/dev/null || echo '')"
    [ -z "$known" ] && return 0   # no snapshot loaded yet; rule no-ops

    # Build set of known primitive class identifiers from kebab → PascalCase.
    local pascal_set=""
    while IFS= read -r name; do
        [ -z "$name" ] && continue
        local pascal=""
        IFS='-' read -ra parts <<<"$name"
        for p in "${parts[@]}"; do
            pascal+="$(printf '%s' "${p:0:1}" | tr '[:lower:]' '[:upper:]')${p:1}"
        done
        pascal_set+=" $pascal"
    done <<<"$known"

    local line=0
    while IFS= read -r ln; do
        line=$((line+1))
        # Match imports from @coss/* or @/components/ui/* paths
        if printf '%s' "$ln" | grep -qE 'from\s+["'"'"']@(coss|/components/ui|/registry/default/ui)'; then
            # extract { Foo, Bar } symbols
            local symbols; symbols="$(printf '%s' "$ln" | grep -oE '\{[^}]+\}' | head -1 | tr ',' '\n' | sed -E 's/[{}]//g; s/\s+as\s+\w+//; s/^\s+|\s+$//g')"
            while IFS= read -r sym; do
                [ -z "$sym" ] && continue
                # PascalCase identifiers only (skip type-only)
                if [[ "$sym" =~ ^[A-Z] ]]; then
                    if ! printf '%s' "$pascal_set" | grep -qE " $sym(Item|Trigger|Content|Header|Footer|Description|Title|Popup|Group|Label|Action|Cancel|Close|Backdrop|Portal|Provider|Root|Item|Indicator|Separator|Body|Cell|Row|Head|Caption|Image|Fallback|CreateHandle)?\b"; then
                        printf "error\tprimitive-not-in-snapshot\t%d\tImported \"%s\" not found in COSS snapshot. Possible hallucination.\n" "$line" "$sym"
                    fi
                fi
            done <<<"$symbols"
        fi
    done <<<"$body"
}

coss_rule_no_state_file_write() {
    # Hardcoded: refuse Writes targeting the state file from any tool.
    local target_path="$1"
    case "$target_path" in
        */.coss-mode/state.json|*/.coss-mode/audit/*|*/.coss-mode.json)
            printf "error\tno-state-file-write\t0\tWrites to coss-mode internal state are forbidden. State is owned by user-prompt-submit hook.\n"
            ;;
    esac
}

coss_rule_pragma_in_same_diff() {
    # Block when an @coss-allow pragma is being introduced in this Write
    # together with a violation it would suppress.
    #
    # Note: PreToolUse delivers the new file content (no unified-diff prefix),
    # so we treat any `@coss-allow` line as "newly added" — and rely on the
    # filter step (which reads the ON-DISK file) to honor pre-existing pragmas.
    local diff_text="$1" file="$2"

    if printf '%s' "$diff_text" | grep -qE '@coss-allow' \
        && printf '%s' "$diff_text" | grep -qE '#[0-9a-fA-F]{3,8}|<button\b|<input\b|<select\b|<textarea\b|<dialog\b|<menu\b|bg-(red|blue|green|yellow|gray|slate|zinc|neutral|stone|orange|amber|lime|emerald|teal|cyan|sky|indigo|violet|purple|fuchsia|pink|rose)-[0-9]{2,3}'; then
        # Distinguish: pragma is pre-existing on disk vs. new in this diff.
        local pragma_existed_on_disk="false"
        if [ -f "$file" ] && grep -qE '@coss-allow' "$file" 2>/dev/null; then
            pragma_existed_on_disk="true"
        fi
        if [ "$pragma_existed_on_disk" = "false" ]; then
            printf "error\tpragma-self-suppression\t0\t@coss-allow added in same diff as violation — atomic block. Land the pragma separately (with reason) BEFORE the change that introduces the violation, OR fix the violation.\n"
        fi
    fi

    # Validate pragma format: must include rule + reason ≥10 chars.
    local line=0
    while IFS= read -r ln; do
        line=$((line+1))
        if printf '%s' "$ln" | grep -qE '@coss-allow'; then
            if ! printf '%s' "$ln" | grep -qE '@coss-allow\s+[a-z-]+\s+.{10,}'; then
                printf "error\tpragma-malformed\t%d\t@coss-allow requires <rule-name> <reason ≥10 chars>. Format: // @coss-allow no-hex-color reason: rendering 3rd-party widget that bakes hex.\n" "$line"
            fi
        fi
    done <<<"$diff_text"

    # Cap pragma usage per file (entire body, not just diff).
    local pragma_count
    pragma_count="$(printf '%s' "$diff_text" | grep -cE '@coss-allow' || true)"
    if [ "$pragma_count" -gt 3 ]; then
        printf "error\tpragma-quota-exceeded\t0\t%d @coss-allow pragmas in one file. Hard cap = 3. Reduce or split file.\n" "$pragma_count"
    fi
}

# Entry point — runs every rule against $1 (diff body), prints all findings.
coss_run_rules() {
    local diff_body="$1" file="$2"
    coss_rule_no_hex_color "$diff_body"
    coss_rule_no_rgb_color "$diff_body"
    coss_rule_no_tailwind_color_scale "$diff_body"
    coss_rule_no_raw_html_element "$diff_body"
    coss_rule_primitive_not_in_snapshot "$diff_body"
    coss_rule_no_state_file_write "$file"
    coss_rule_pragma_in_same_diff "$diff_body" "$file"
}
