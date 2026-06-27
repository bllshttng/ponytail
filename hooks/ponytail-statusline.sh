#!/usr/bin/env bash
# CLAUDE_CONFIG_DIR overrides ~/.claude, matching where the hooks write the flag (issue #34)
dir="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"

# Per-session flag isolates concurrent sessions (badge follows this session's mode).
# Claude pipes the statusline JSON on stdin; pull session_id without a jq dependency.
# Absent or odd value → shared flag, matching statePathFor's fallback in the hooks.
input=$(cat 2>/dev/null)
sid=$(printf '%s' "$input" | grep -o '"session_id"[[:space:]]*:[[:space:]]*"[^"]*"' | head -n1 | sed 's/.*"\([^"]*\)"$/\1/')
flag="$dir/.ponytail/shared"
case "$sid" in
    *[!A-Za-z0-9_-]*|'') ;;
    *) flag="$dir/.ponytail/$sid" ;;
esac
[ -f "$flag" ] || exit 0

mode=$(head -n1 "$flag" | tr -d '[:space:]')

if [ -z "$mode" ] || [ "$mode" = "full" ]; then
    printf '\033[38;5;108m[PONYTAIL]\033[0m'
else
    printf '\033[38;5;108m[PONYTAIL:%s]\033[0m' "$(printf '%s' "$mode" | tr '[:lower:]' '[:upper:]')"
fi
