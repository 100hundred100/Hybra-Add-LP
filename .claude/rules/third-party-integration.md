# 外部ライブラリ統合ルール

## 背景
/sign 開発でPDF署名ライブラリ(pdf-lib, @signpdf)のバグが6PR分の工数を消費。
CJK文字化け(#90)、フォント一貫性(#36)、位置ずれ(#3)、証明書レイアウト(#33)。
Stripe Webhook も冪等性バグ(#94)。

## 必須ルール

### 1. 外部ライブラリはラッパーで囲む
直接呼び出さず、プロジェクト固有のラッパー関数を作成:
```typescript
// NG: コンポーネントから直接呼び出し
import Stripe from "stripe";
const stripe = new Stripe(key);
await stripe.checkout.sessions.create({ ... });

// OK: ラッパー経由
// server/services/payment.ts
export async function createCheckoutSession(params: CheckoutParams) {
  const stripe = getStripeClient();
  return stripe.checkout.sessions.create({ ... });
}
```

### 2. 外部APIの失敗を想定する
```typescript
// Webhook処理は冪等に
async function handleWebhook(event: StripeEvent) {
  // 既に処理済みなら何もしない
  const existing = await db.select()
    .from(webhookEvents)
    .where(eq(webhookEvents.eventId, event.id));
  if (existing.length > 0) return;
  // 処理実行
}
```

### 3. 外部ライブラリのテストは統合テストで
- ユニットテストではラッパーをモック
- 統合テストで実際のライブラリ呼び出しを検証
- CJK文字、特殊文字、空入力のエッジケースをテスト

### 4. バージョン固定
```json
// NG: キャレット（互換性のあるアップデートでも壊れうる）
"stripe": "^14.0.0"

// OK: 完全固定
"stripe": "14.0.0"
```
アップデートは意図的に行い、テスト全パスを確認してからマージ。

## /reserve で想定される外部サービス
| サービス | 用途 | 注意点 |
|---------|------|--------|
| Stripe | 決済 | Webhook冪等性、quantity検証 |
| メール送信 | リマインド/確認 | テンプレート変数名一致、レート制限 |
| カレンダーAPI | 外部連携 | タイムゾーン変換、OAuth期限切れ |
