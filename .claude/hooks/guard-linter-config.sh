#!/usr/bin/env bash
# PreToolUse Hook: リンター/TS設定ファイルの編集をブロック
set -euo pipefail

TOOL_INPUT="$CLAUDE_TOOL_INPUT"
PROJECT_DIR="$CLAUDE_PROJECT_DIR"

# ファイルパスを抽出
FILE_PATH=$(echo "$TOOL_INPUT" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    print(data.get('file_path', ''))
except:
    print('')
" 2>/dev/null || echo "")

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# 保護対象ファイル
PROTECTED_FILES=(
  "$PROJECT_DIR/biome.json"
  "$PROJECT_DIR/oxlint.json"
  "$PROJECT_DIR/tsconfig.json"
  "$PROJECT_DIR/lefthook.yml"
)

for PROTECTED in "${PROTECTED_FILES[@]}"; do
  if [ "$FILE_PATH" = "$PROTECTED" ]; then
    echo '{"decision": "block", "reason": "設定ファイル ('$(basename "$PROTECTED")') の変更はブロックされています。変更が必要な場合はユーザーに確認してください。"}'
    exit 0
  fi
done
