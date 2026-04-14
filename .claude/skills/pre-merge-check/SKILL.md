---
name: pre-merge-check
description: |
  マージ前の品質ゲート。CI検証（pnpm test/check/build）+ 先祖返り防止 + ドキュメント同期を一括チェック。
  TRIGGER when: /commit-merge の前、PRマージ前、「マージ前チェック」「pre-merge」「品質ゲート」。
  DO NOT TRIGGER when: 作業途中の中間確認（→ 手動で pnpm test）、コードレビュー（→ /code-review）。
---

# pre-merge-check — マージ前品質ゲート

## 実行手順

以下の7項目を順番にチェックし、全てパスしたらマージ可能と判定。

### 1. テスト全パス
```bash
pnpm test
```
1件でも失敗 → ❌ マージ不可

### 2. 型チェックパス
```bash
pnpm check
```
型エラー → ❌ マージ不可

### 3. ビルド成功
```bash
pnpm build
```
ビルドエラー → ❌ マージ不可

### 4. 先祖返りチェック
```bash
git diff main --stat
```
変更ファイル一覧を確認し、意図しないファイルが含まれていないか目視。
特に以下に注意（/sign で5回以上の先祖返り発生）:
- i18n JSON ファイルの大規模変更（キー順序の差分爆発）
- ルーター定義の意図しない上書き
- 共有型定義の競合
- 広範囲変更前に git stash/commit で現在の変更を保存済みか確認

### 5. ドキュメント同期
変更したファイルに対応するドキュメントが更新されているか確認:
- スキーマ変更 → `docs/domain/data-model.md`
- API変更 → `docs/architecture.md`
- コマンド変更 → `CLAUDE.md`

### 6. console.log 残留チェック
```
Grep: console\.(log|warn|error) in client/src/ and server/
```
デバッグ用の console.log が残っていないか確認。logger経由は許可。

### 7. 煽り表現・嘘チェック
LP/UI に禁止表現（branding-identity.md 参照）が含まれていないか。

## 出力フォーマット
```
## pre-merge-check 結果

| # | チェック | 結果 |
|---|---------|------|
| 1 | テスト | ✅ XX件パス / ❌ |
| 2 | 型チェック | ✅ / ❌ |
| 3 | ビルド | ✅ / ❌ |
| 4 | 先祖返り | ✅ / ⚠️ 要確認 |
| 5 | ドキュメント同期 | ✅ / ⚠️ |
| 6 | console.log | ✅ / ❌ N件 |
| 7 | 煽り・嘘 | ✅ / ❌ |

**判定: ✅ マージ可能 / ❌ 修正が必要**
```
