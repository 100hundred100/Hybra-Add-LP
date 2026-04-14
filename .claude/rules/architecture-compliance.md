# アーキテクチャ準拠ルール

## 前提
docs/architecture.md がコードベースの"地図"。実装前に必ず参照すること。

## 必須ルール

### 1. レイヤー依存方向を守る
```
drizzle/ → shared/ → client/
                    → server/
```

| 禁止パターン | 理由 |
|-------------|------|
| client/ から server/ をランタイムimport | tRPC経由のみ（import type は許可） |
| shared/ から server/ または client/ をimport | 共有層は下位レイヤーのみ参照 |
| drizzle/ から他レイヤーをimport | データ層は独立 |

違反は `server/structural.test.ts` で自動検出される。

### 2. 新規ファイル作成時はレイヤーを意識する
- UI層のロジック → `client/src/`
- 共有型・定数 → `shared/`
- APIロジック → `server/`
- テーブル定義 → `drizzle/schema.ts`

### 3. ログは構造化ログを使う
server/ 内で `console.log/warn/error` を直接使わない。

```typescript
import { createLogger } from "./logger";
const log = createLogger("ModuleName");

log.info("message", { key: "value" });
log.error("failed", { error: String(error) });
```

- 本番: JSON形式で出力（パース・検索可能）
- 開発: `[Module] message` 形式（可読性重視）
