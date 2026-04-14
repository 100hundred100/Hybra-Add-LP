#!/bin/bash
# Stop hook: package.json に存在する検証用 scripts だけを実行する

cd "$CLAUDE_PROJECT_DIR" || exit 0

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

[ -f package.json ] || exit 0

MAX_RETRIES=3
COUNTER_FILE="/tmp/claude-stop-ci-${CLAUDE_SESSION_ID:-$$}.count"

if [ -f "$COUNTER_FILE" ]; then
  RETRY_COUNT=$(cat "$COUNTER_FILE")
else
  RETRY_COUNT=0
fi

get_script() {
  node -e 'const fs=require("fs");const p=JSON.parse(fs.readFileSync("package.json","utf8"));const n=process.argv[1];process.stdout.write(p.scripts&&p.scripts[n]?"yes":"no")' "$1" 2>/dev/null
}

ERRORS=""
DETAILS=""

run_if_present() {
  local script_name="$1"
  if [ "$(get_script "$script_name")" = "yes" ]; then
    local output
    output=$(pnpm "$script_name" 2>&1)
    local exit_code=$?
    DETAILS="${DETAILS}\n\n--- pnpm ${script_name} ---\n${output}"
    if [ $exit_code -ne 0 ]; then
      ERRORS="${ERRORS}pnpm ${script_name} 失敗\n"
    fi
  fi
}

run_if_present test
run_if_present check
run_if_present build

if [ -z "$ERRORS" ]; then
  rm -f "$COUNTER_FILE"
  exit 0
fi

RETRY_COUNT=$((RETRY_COUNT + 1))
echo "$RETRY_COUNT" > "$COUNTER_FILE"

if [ "$RETRY_COUNT" -ge "$MAX_RETRIES" ]; then
  rm -f "$COUNTER_FILE"
  cat <<JSON
{
  "decision": "block",
  "reason": "CI検証が${MAX_RETRIES}回連続で失敗しました。自動修正を中断し、ユーザーに報告してください。\n\n${ERRORS}${DETAILS}"
}
JSON
  exit 0
fi

REMAINING=$((MAX_RETRIES - RETRY_COUNT))
cat <<JSON
{
  "decision": "block",
  "reason": "CI検証失敗（試行 ${RETRY_COUNT}/${MAX_RETRIES}）。残り${REMAINING}回です。\n\n${ERRORS}${DETAILS}"
}
JSON
