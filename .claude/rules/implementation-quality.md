# Implementation Quality Rules

## 必須ルール

### 1. 空実装（Hollow Implementation）禁止
`pass`、`...`、`TODO` だけの実装は禁止。

### 2. 環境変数は .env から読み込み

### 3. 実装後は必ず実行して動作確認
「完了しました」と報告する前に、実際に実行して動作を確認する。

## 推奨ルール
- 最小限の実装（YAGNI原則）
- 既存パターンを踏襲
- エラーを `catch: pass` で握り潰さない
- 横断的な変更は事前に Grep/Glob で影響範囲を把握
