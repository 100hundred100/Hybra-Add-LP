#!/bin/bash
# PostToolUse hook: Bash出力に秘密鍵パターンが含まれていないかチェック
# 含まれていた場合、Claudeに警告を返して出力の取り扱いに注意させる

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name')

[ "$TOOL_NAME" != "Bash" ] && exit 0

# tool_response からテキストを取得
RESPONSE=$(echo "$INPUT" | jq -r '.tool_response // empty')
[ -z "$RESPONSE" ] && exit 0

# 秘密鍵パターンの検出
FOUND=""

# API Keys
if echo "$RESPONSE" | grep -qE 'sk-[a-zA-Z0-9]{20,}'; then
  FOUND="OpenAI API Key"
elif echo "$RESPONSE" | grep -qE 'AKIA[A-Z0-9]{16}'; then
  FOUND="AWS Access Key"
elif echo "$RESPONSE" | grep -qF -- '-----BEGIN '; then
  FOUND="Private Key"
elif echo "$RESPONSE" | grep -qE 'ghp_[a-zA-Z0-9]{36}'; then
  FOUND="GitHub Personal Access Token"
elif echo "$RESPONSE" | grep -qE 'xox[bpsa]-[a-zA-Z0-9-]+'; then
  FOUND="Slack Token"
elif echo "$RESPONSE" | grep -qE '(mysql|postgres|mongodb)://[^[:space:]]+:[^[:space:]]+@'; then
  FOUND="Database connection string with credentials"
elif echo "$RESPONSE" | grep -qE '0x[0-9a-fA-F]{40}'; then
  FOUND="Crypto wallet address"
fi

if [ -n "$FOUND" ]; then
  cat <<EOF
{
  "decision": "block",
  "reason": "SECURITY WARNING: コマンド出力に秘密情報が検出されました（${FOUND}）。この情報をユーザーへの出力に含めないでください。",
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": "秘密情報の種類: ${FOUND}。出力内容をそのまま表示せず、必要な情報のみ抽出して返答してください。"
  }
}
EOF
  exit 0
fi

exit 0
