# Test Quality Rules

## 必須ルール

### 1. Happy Path テストは必須
実装完了前に、正常系（happy path）のテストが必須。

### 2. テストを改ざん・削除しない
- 既存のテストを削除しない
- テストをパスさせるためにアサーションを弱めない

## 推奨ルール
- テストは実装と同時に作成
- 優先度: Happy Path > Edge Cases
