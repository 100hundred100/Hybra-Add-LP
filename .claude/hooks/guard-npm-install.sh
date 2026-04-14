#!/bin/bash
# PreToolUse hook: pnpm add / npm install 時にパッケージの安全性を簡易チェック
# - weekly downloads が少なすぎる（1000未満）→ ask
# - 作成日が新しすぎる（30日以内）→ ask
# - 人気パッケージ名とのtyposquatting検出 → ask

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name')

[ "$TOOL_NAME" != "Bash" ] && exit 0

COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')
[ -z "$COMMAND" ] && exit 0

# pnpm add / npm install / npx / pnpm dlx を検出
if ! echo "$COMMAND" | grep -qE '(pnpm add|pnpm dlx|npm install|npm i|npx)[[:space:]]'; then
  exit 0
fi

# パッケージ名を抽出（フラグ -D -E 等を除外）
# コマンド部分（pnpm add / npx 等）を除去してパッケージ名だけ取得
PACKAGES=$(echo "$COMMAND" | sed -E 's/^.*(pnpm add|pnpm dlx|npm install|npm i|npx)[[:space:]]+//' | tr ' ' '\n' | grep -v '^-' | grep -v '^$')

[ -z "$PACKAGES" ] && exit 0

# よくある人気パッケージ（typosquatting検出用）
POPULAR="react express lodash axios next vue angular typescript eslint webpack vite tailwindcss prisma drizzle zod trpc"

WARNINGS=""

for PKG in $PACKAGES; do
  # @scope/name や name@version から名前部分を抽出
  PKG_NAME=$(echo "$PKG" | sed 's/@[^/]*$//') # バージョン除去
  BASE_NAME=$(echo "$PKG_NAME" | sed 's/^@[^/]*\///')  # scope除去

  # --- npm registry API でパッケージ情報取得 ---
  REGISTRY_DATA=$(curl -sf --max-time 5 "https://registry.npmjs.org/$PKG_NAME" 2>/dev/null)

  if [ -z "$REGISTRY_DATA" ]; then
    WARNINGS="${WARNINGS}\n- ${PKG_NAME}: npm registryで見つかりません（存在しないパッケージ）"
    continue
  fi

  # weekly downloads 確認
  DL_DATA=$(curl -sf --max-time 5 "https://api.npmjs.org/downloads/point/last-week/$PKG_NAME" 2>/dev/null)
  DOWNLOADS=$(echo "$DL_DATA" | jq -r '.downloads // 0' 2>/dev/null)

  if [ "$DOWNLOADS" != "null" ] && [ "$DOWNLOADS" -lt 1000 ] 2>/dev/null; then
    WARNINGS="${WARNINGS}\n- ${PKG_NAME}: weekly downloads が少ない (${DOWNLOADS}/week)"
  fi

  # 作成日確認（30日以内）
  CREATED=$(echo "$REGISTRY_DATA" | jq -r '.time.created // empty' 2>/dev/null)
  if [ -n "$CREATED" ]; then
    CREATED_TS=$(date -j -f "%Y-%m-%dT%H:%M:%S" "${CREATED%%.*}" "+%s" 2>/dev/null || date -d "${CREATED}" "+%s" 2>/dev/null)
    NOW_TS=$(date "+%s")
    if [ -n "$CREATED_TS" ]; then
      AGE_DAYS=$(( (NOW_TS - CREATED_TS) / 86400 ))
      if [ "$AGE_DAYS" -lt 30 ]; then
        WARNINGS="${WARNINGS}\n- ${PKG_NAME}: 作成から${AGE_DAYS}日しか経っていません（30日未満）"
      fi
    fi
  fi

  # --- typosquatting検出（編集距離1の人気パッケージ名チェック）---
  for POP in $POPULAR; do
    if [ "$BASE_NAME" = "$POP" ]; then
      break  # 完全一致は問題なし
    fi

    # 長さの差が1以内かつ名前が似ている場合を簡易チェック
    LEN_PKG=${#BASE_NAME}
    LEN_POP=${#POP}
    LEN_DIFF=$(( LEN_PKG - LEN_POP ))
    [ "$LEN_DIFF" -lt 0 ] && LEN_DIFF=$(( -LEN_DIFF ))

    if [ "$LEN_DIFF" -le 1 ] && [ "$LEN_PKG" -ge 3 ]; then
      # 共通プレフィックス長を計算
      COMMON=0
      MIN_LEN=$LEN_PKG
      [ "$LEN_POP" -lt "$MIN_LEN" ] && MIN_LEN=$LEN_POP
      I=0
      while [ "$I" -lt "$MIN_LEN" ]; do
        C1=$(echo "$BASE_NAME" | cut -c$((I+1)))
        C2=$(echo "$POP" | cut -c$((I+1)))
        if [ "$C1" = "$C2" ]; then
          COMMON=$((COMMON + 1))
        fi
        I=$((I + 1))
      done

      # 80%以上一致 かつ 完全一致でない → typosquatting疑い
      THRESHOLD=$(( MIN_LEN * 80 / 100 ))
      if [ "$COMMON" -ge "$THRESHOLD" ] && [ "$BASE_NAME" != "$POP" ]; then
        WARNINGS="${WARNINGS}\n- ${PKG_NAME}: '${POP}' に酷似（typosquatting の可能性）"
        break
      fi
    fi
  done
done

if [ -n "$WARNINGS" ]; then
  cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "ask",
    "permissionDecisionReason": "NPM SECURITY WARNING: パッケージに懸念があります。$(echo -e "$WARNINGS")\n\nインストールを続行しますか？"
  }
}
EOF
  exit 0
fi

exit 0
