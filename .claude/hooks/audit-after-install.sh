#!/bin/bash
# PostToolUse hook: pnpm add / npm install 成功後に pnpm audit を自動実行
# 脆弱性が見つかったらClaude に警告

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name')

[ "$TOOL_NAME" != "Bash" ] && exit 0

COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# pnpm add / npm install を検出
if ! echo "$COMMAND" | grep -qE '(pnpm add|pnpm install|npm install|npm i )\s'; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR" || exit 0

# NVM経由でpnpmをPATHに追加
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

# pnpm audit 実行
AUDIT_OUTPUT=$(pnpm audit 2>&1)
AUDIT_EXIT=$?

if [ $AUDIT_EXIT -ne 0 ]; then
  # 脆弱性発見
  HIGH_COUNT=$(echo "$AUDIT_OUTPUT" | grep -ciE '(high|critical)')

  if [ "$HIGH_COUNT" -gt 0 ]; then
    cat <<EOF
{
  "decision": "block",
  "reason": "SECURITY: pnpm audit で high/critical の脆弱性が検出されました（${HIGH_COUNT}件）。対応してください。\n\n${AUDIT_OUTPUT}"
}
EOF
    exit 0
  fi

  # low/moderate のみの場合は警告だけ
  cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": "pnpm audit で脆弱性が検出されました（low/moderate）。必要に応じて対応してください。\n\n${AUDIT_OUTPUT}"
  }
}
EOF
  exit 0
fi

exit 0
