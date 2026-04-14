#!/bin/bash
# PreToolUse hook: 秘密鍵・環境変数の露呈を防止
# Bash, Write, Edit ツールの入力をチェックし、危険なパターンをブロック

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name')

# チェック対象のテキストを取得
case "$TOOL_NAME" in
  Bash)
    TEXT=$(echo "$INPUT" | jq -r '.tool_input.command // empty')
    ;;
  Write)
    TEXT=$(echo "$INPUT" | jq -r '.tool_input.content // empty')
    ;;
  Edit)
    TEXT=$(echo "$INPUT" | jq -r '.tool_input.new_string // empty')
    ;;
  Read)
    TEXT=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
    ;;
  *)
    exit 0
    ;;
esac

[ -z "$TEXT" ] && exit 0

# --- .env ファイルの読み取り・出力をブロック ---
if [ "$TOOL_NAME" = "Read" ]; then
  if echo "$TEXT" | grep -qiE '\.env($|\.local|\.prod|\.secret)'; then
    cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "SECURITY: .env ファイルの読み取りはブロックされました。秘密鍵が露呈する可能性があります。"
  }
}
EOF
    exit 0
  fi
  exit 0
fi

# --- Bash: .env の cat/echo/出力コマンドをブロック ---
if [ "$TOOL_NAME" = "Bash" ]; then
  if echo "$TEXT" | grep -qiE '(cat|head|tail|less|more|bat)\s+.*\.env'; then
    cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "SECURITY: .env ファイルの内容出力はブロックされました。Readツールも使用しないでください。"
  }
}
EOF
    exit 0
  fi

  # printenv, env, echo $SECRET 等
  if echo "$TEXT" | grep -qiE '(printenv|^env$|echo\s+\$)'; then
    cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "ask",
    "permissionDecisionReason": "WARNING: 環境変数を出力しようとしています。秘密鍵が露呈する可能性があります。"
  }
}
EOF
    exit 0
  fi
fi

# --- Write/Edit: ハードコードされた秘密鍵パターンの検出 ---
if [ "$TOOL_NAME" = "Write" ] || [ "$TOOL_NAME" = "Edit" ]; then
  # 一般的な秘密鍵パターン（API key, secret, token, private key等）
  if echo "$TEXT" | grep -qE '(sk-[a-zA-Z0-9]{20,}|AKIA[A-Z0-9]{16}|ghp_[a-zA-Z0-9]{36}|xox[bpsa]-[a-zA-Z0-9-]+|0x[0-9a-fA-F]{40})' || echo "$TEXT" | grep -qF -- '-----BEGIN '; then
    cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "SECURITY: コードに秘密鍵がハードコードされています。.env ファイルまたは環境変数を使用してください。"
  }
}
EOF
    exit 0
  fi
fi

exit 0
