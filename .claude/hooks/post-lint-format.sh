#!/usr/bin/env bash
# PostToolUse Hook: Write/Edit 後に Biome format + Oxlint --fix を実行
# 対象: .ts, .tsx, .js, .jsx ファイルのみ
set -euo pipefail

TOOL_INPUT="$CLAUDE_TOOL_INPUT"
PROJECT_DIR="$CLAUDE_PROJECT_DIR"

# ファイルパスを抽出（Write: file_path, Edit: file_path）
FILE_PATH=$(echo "$TOOL_INPUT" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    print(data.get('file_path', ''))
except:
    print('')
" 2>/dev/null || echo "")

# ファイルパスが空、またはプロジェクト外なら何もしない
if [ -z "$FILE_PATH" ] || [[ "$FILE_PATH" != "$PROJECT_DIR"* ]]; then
  exit 0
fi

# 対象拡張子チェック（ts/tsx/js/jsx/json のみ）
case "$FILE_PATH" in
  *.ts|*.tsx|*.js|*.jsx|*.json) ;;
  *) exit 0 ;;
esac

# ファイルが存在しない場合は何もしない
if [ ! -f "$FILE_PATH" ]; then
  exit 0
fi

ERRORS=""

# Biome format
BIOME_OUT=$(npx @biomejs/biome format --write "$FILE_PATH" 2>&1) || true

# Biome lint (fix可能なものは修正)
BIOME_LINT=$(npx @biomejs/biome lint --write "$FILE_PATH" 2>&1) || true
BIOME_ERRORS=$(echo "$BIOME_LINT" | grep -c '×' 2>/dev/null || echo "0")
if [ "$BIOME_ERRORS" -gt 0 ]; then
  ERRORS="$ERRORS\n[Biome] $BIOME_ERRORS error(s) in $(basename "$FILE_PATH")"
  ERRORS="$ERRORS\n$(echo "$BIOME_LINT" | grep -A2 '×' | head -20)"
fi

# Oxlint (ts/tsx/js/jsx のみ、json は除外)
case "$FILE_PATH" in
  *.json) ;;
  *)
    OXLINT_OUT=$(npx oxlint -c "$PROJECT_DIR/oxlint.json" "$FILE_PATH" 2>&1) || true
    OXLINT_ERRORS=$(echo "$OXLINT_OUT" | grep -oP 'Found \K\d+ warnings and \d+ errors' 2>/dev/null || echo "")
    if echo "$OXLINT_OUT" | grep -q 'x '; then
      ERRORS="$ERRORS\n[Oxlint] $(basename "$FILE_PATH"): $OXLINT_ERRORS"
      ERRORS="$ERRORS\n$(echo "$OXLINT_OUT" | grep -B1 'x ' | head -20)"
    fi
    ;;
esac

# エラーがあれば additionalContext として返却
if [ -n "$ERRORS" ]; then
  echo "{\"additionalContext\": \"$(echo -e "$ERRORS" | sed 's/"/\\"/g' | tr '\n' ' ')\"}"
fi
