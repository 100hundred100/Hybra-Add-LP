# テスト安定性ルール

## 背景
/sign 開発でflakyテストが4PR分（#54,#60,#76）の工数を浪費。
原因: stale mock queue, 非同期タイムアウト, 日付依存テスト。

## 必須ルール

### 1. Mock は各テストで初期化する
```typescript
// NG: テスト間でmockが残る
vi.mock("./service");

// OK: beforeEach で明示的にリセット
beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});
```

### 2. 非同期テストにタイムアウトを設定する
```typescript
// NG: デフォルトタイムアウトに依存
it("should complete async operation", async () => { ... });

// OK: 明示的タイムアウト（CI環境は遅い）
it("should complete async operation", async () => { ... }, 10_000);
```

### 3. 日付・時刻に依存するテストは固定する
```typescript
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-03-15T10:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});
```

### 4. テストデータは最小限にする
- 必要最小限のフィールドだけ設定する
- ファクトリ関数で共通データを生成する
- 他テストのデータに依存しない（テスト間独立）

### 5. waitFor / findBy を適切に使い分ける
```typescript
// NG: 固定sleep
await new Promise(r => setTimeout(r, 500));

// OK: 条件ベースの待機
await waitFor(() => expect(screen.getByText("完了")).toBeInTheDocument());
```

## flakyテストの対処フロー
1. 3回連続で同じテストが失敗 → 原因調査開始
2. mock stale → `vi.clearAllMocks()` 追加
3. タイムアウト → タイムアウト値引き上げ or 非同期処理の見直し
4. 日付依存 → `vi.useFakeTimers()` 導入
5. 順序依存 → テスト間依存を排除
