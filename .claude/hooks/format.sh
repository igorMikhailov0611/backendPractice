#!/usr/bin/env bash
# PostToolUse hook: run Prettier on TypeScript files Claude just edited/created.
# Silently does nothing if the file isn't .ts or dependencies aren't installed yet.

file_path=$(jq -r '.tool_input.file_path // empty')

case "$file_path" in
  *.ts) ;;
  *) exit 0 ;;
esac

prettier="$CLAUDE_PROJECT_DIR/node_modules/.bin/prettier"
[ -x "$prettier" ] || exit 0

"$prettier" --write --log-level warn "$file_path" >/dev/null 2>&1 || true
exit 0
