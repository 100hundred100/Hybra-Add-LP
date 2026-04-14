# ファイル肥大化防止ルール

## 背景
/sign 開発で routers.ts が1,500行超に膨れ上がり、PR#57-59の3PRを使って分割。
AI は「既存ファイルに追記」を好むため、ファイルが際限なく大きくなる。

## 必須ルール

### 1. 300行を超えたら分割を検討する
以下のファイルタイプは300行を目安に分割:
- ルーター定義 → ドメイン別ファイル（`routers/booking.ts`, `routers/menu.ts`）
- コンポーネント → サブコンポーネント抽出
- ユーティリティ → カテゴリ別ファイル

### 2. 新規ルートは別ファイルに
新しいAPIルートを追加する場合:
```typescript
// NG: 既存の巨大ルーターに追加
// server/routers.ts に50個目のルートを追記

// OK: ドメイン別ファイルに分離
// server/routers/booking.ts
export const bookingRouter = router({ ... });

// server/routers/index.ts で統合
```

### 3. ページコンポーネントの分離
500行を超えるページコンポーネントは:
- セクション単位でサブコンポーネントに分離
- ロジックはカスタムhooksに抽出
- 定数・型定義は別ファイルに

### 4. 共有型定義の構造
`shared/` の型定義は機能ドメイン別に整理:
```
shared/
  types/booking.ts
  types/menu.ts
  types/organization.ts
  constants/booking.ts
```

## 自動チェック
CI または構造テストで以下を検証:
- 500行超のソースファイルがないこと（テストファイルは除外）
