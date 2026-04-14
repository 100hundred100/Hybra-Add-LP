---
description: React + Tailwind + shadcn/ui フロントエンドのコーディング規約
alwaysApply: true
---

# フロントエンドコーディング規約

## 1. コンポーネントファイル構成順序

```tsx
// 1. 外部ライブラリ
import { useState } from "react";
import { useLocation } from "wouter";

// 2. 内部コンポーネント
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

// 3. hooks・contexts
import { useMobile } from "@/hooks/useMobile";

// 4. ユーティリティ・定数
import { cn } from "@/lib/utils";

// 5. 型（type import）
import type { SomeType } from "@shared/types";

// --- 型定義 ---
interface PageProps {
  title: string;
}

// --- ヘルパー関数（コンポーネント外） ---
function formatDate(date: Date): string {
  return date.toLocaleDateString("ja-JP");
}

// --- コンポーネント本体 ---
export default function Page({ title }: PageProps) {
  // hooks はコンポーネント先頭にまとめる
  const [, navigate] = useLocation();
  const isMobile = useMobile();

  return <div>{title}</div>;
}
```

## 2. Tailwind CSS 規約

### ユーティリティファースト
- カスタム CSS は最終手段。Tailwind ユーティリティクラスで済むならそちらを使う
- `@apply` は `index.css` の基盤スタイルのみ許可。コンポーネント内では使わない

### テーマカラー
- ハードコードカラー（`bg-blue-500`）ではなく CSS 変数ベースのセマンティックカラーを使う
  - `bg-primary`, `text-foreground`, `border-border`, `bg-muted` 等
- テーマ定義は `client/src/index.css` の `@theme inline` ブロック

### レスポンシブ
- モバイルファーストで書き、`sm:` `md:` `lg:` で拡張する
- `useIsMobile()` フックは Tailwind で対応できない JS 分岐にのみ使う

### クラス結合
- 条件付きクラスは `cn()` ユーティリティ（`@/lib/utils`）で結合する
  ```tsx
  <div className={cn("p-4", isActive && "bg-primary")} />
  ```

## 3. shadcn/ui 使用規約

### 既存コンポーネント優先
- 新しい UI を作る前に `client/src/components/ui/` を確認する
- 既存コンポーネントをラップ・合成して要件を満たせないか検討する

### CVA（Class Variance Authority）
- バリアントが必要なコンポーネントは CVA で定義する
- `buttonVariants` のパターンを参考にする

### 配置ルール
- 汎用 UI → `client/src/components/ui/`
- 機能固有 UI → `client/src/components/` 直下またはページ横に配置

## 4. JSX 改行ルール

### props 3つ以上 → 1行1prop
```tsx
// NG: 横に長い
<Button variant="default" size="lg" onClick={handleClick} disabled={isLoading}>送信</Button>

// OK: 1行1prop
<Button
  variant="default"
  size="lg"
  onClick={handleClick}
  disabled={isLoading}
>
  送信
</Button>
```

### 三項演算子のネスト禁止
```tsx
// NG: ネストした三項演算子
{status === "loading" ? <Spinner /> : status === "error" ? <Error /> : <Content />}

// OK: 早期 return
if (status === "loading") return <Spinner />;
if (status === "error") return <Error />;
return <Content />;
```

### 複雑な子要素は変数に抽出
```tsx
// NG: JSX 内にロジックが混在
<Card>
  {items.filter(i => i.active).map(i => (
    <div key={i.id}>{i.name}: {formatPrice(i.price)}</div>
  ))}
</Card>

// OK: 変数に抽出
const activeItems = items.filter(i => i.active);
return (
  <Card>
    {activeItems.map(item => (
      <div key={item.id}>
        {item.name}: {formatPrice(item.price)}
      </div>
    ))}
  </Card>
);
```

## 5. console.log 禁止

- `console.log` / `console.warn` / `console.error` をコミットしない
- デバッグ用に一時的に使う場合も、完了前に必ず削除する
- 本番ログが必要になった場合は logger ラッパーを作る
