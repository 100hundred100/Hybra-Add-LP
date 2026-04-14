/setup-local-dev

ローカル開発環境をセットアップするコマンド。
本番コードを一切変更せず、Docker DB + ローカル専用Auth で動作させる。

## 実績済みの落とし穴（必ず先に読むこと）

| #   | 問題                                                       | 原因                                                              | 対処                                                                         |
| --- | ---------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 1   | `JWT_SECRET` が空でJWT署名失敗                             | `import "dotenv/config"` は `.env` しか読まない                   | `loadEnv()` + `loadEnv({ path: ".env.local", override: true })` に置き換える |
| 2   | Cookie が設定されずログイン失敗                            | `sameSite: "none"` は `secure: true` 必須。HTTP localhostでは無効 | `secure ? "none" : "lax"` にフォールバック                                   |
| 3   | DB接続が `ECONNREFUSED`                                    | Docker が未起動、またはコンテナが healthy になる前にクエリを発行  | Docker Desktop 起動 → コンテナ healthy 確認 → マイグレーション の順を守る    |
| 4   | `DATABASE_URL` に `localhost` を使うとIPv6接続になりエラー | Node.js が `localhost` を `::1`（IPv6）に解決する場合がある       | `localhost` の代わりに `127.0.0.1` を明示する                                |

---

## 実行内容

以下を順番に実施せよ。

---

### Step 1: プロジェクト構造を把握する

以下を調べること：

- フレームワーク・言語（Express/tRPC/Next.js 等）
- DBの種類（MySQL/PostgreSQL/SQLite）とORM（Drizzle/Prisma 等）
- 認証方式（OAuth/JWT/セッション等）とその実装ファイル
- **dotenv の読み込み方法**（`import "dotenv/config"` か `dotenv.config()` か）← 落とし穴1に直結
- 既存の `.env` / `.env.local` / `.env.example` の有無
- `package.json` の `scripts` でdev起動コマンドとDBマイグレーションコマンドを把握
- Cookie設定ファイルの `sameSite` の現在値 ← 落とし穴2に直結

### Step 2: `docker-compose.yml` を作成する

プロジェクトルートに作成。DBの種類に応じて選択：

**MySQL 8 の場合:**

```yaml
version: "3.8"
services:
  mysql:
    image: mysql:8.0
    container_name: <プロジェクト名>-mysql
    environment:
      MYSQL_ROOT_PASSWORD: localpass
      MYSQL_DATABASE: <プロジェクト名>_local
    ports:
      - "3306:3306"
    volumes:
      - <プロジェクト名>_mysql_data:/var/lib/mysql
    command: --default-authentication-plugin=mysql_native_password
    healthcheck:
      test:
        [
          "CMD",
          "mysqladmin",
          "ping",
          "-h",
          "localhost",
          "-u",
          "root",
          "-plocalpass",
        ]
      interval: 10s
      timeout: 5s
      retries: 5
volumes:
  <プロジェクト名>_mysql_data:
```

**PostgreSQL 16 の場合:**

```yaml
version: "3.8"
services:
  postgres:
    image: postgres:16
    container_name: <プロジェクト名>-postgres
    environment:
      POSTGRES_PASSWORD: localpass
      POSTGRES_DB: <プロジェクト名>_local
    ports:
      - "5432:5432"
    volumes:
      - <プロジェクト名>_pg_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5
volumes:
  <プロジェクト名>_pg_data:
```

### Step 3: `.env.local` を作成する

既存の `.env.example` や環境変数の参照箇所を調べて必要な変数を特定する。

```
# ローカル開発用環境変数
# Docker DB（127.0.0.1 を使うこと ← localhost はIPv6になる場合がある）
DATABASE_URL=mysql://root:localpass@127.0.0.1:3306/<プロジェクト名>_local
# PostgreSQL の場合: postgresql://postgres:localpass@127.0.0.1:5432/<プロジェクト名>_local

# JWTシークレット（ローカル専用・本番値は絶対に入れない）
JWT_SECRET=local-dev-secret-key-do-not-use-in-production

# ローカル管理者のID（このIDで最高権限ユーザーに自動昇格）
OWNER_OPEN_ID=local_admin

# その他プロジェクト固有の変数（OAuth URL等はダミーでOK）
VITE_APP_ID=local_app
VITE_OAUTH_PORTAL_URL=http://localhost:3000

PORT=3000
```

`.gitignore` に `.env.local` が含まれているか確認し、含まれていなければ追加。

### Step 4: dotenv の読み込みを修正する（落とし穴1の対処）

サーバーのエントリーポイントで `import "dotenv/config"` を使っている場合は必ず置き換える。
`.env.local` は dotenv のデフォルト読み込み対象ではないため、明示的に追加ロードする。

**修正前:**

```typescript
import "dotenv/config";
```

**修正後:**

```typescript
// .env → .env.local の順で読み込む（.env.local が優先）
import { config as loadEnv } from "dotenv";
loadEnv();
loadEnv({ path: ".env.local", override: true });
```

> Next.js の場合は `.env.local` がフレームワーク側で自動ロードされるため不要。
> Vite の場合もクライアント側は自動ロードされるが、サーバー側（API routes等）は要確認。

### Step 5: Cookie の `sameSite` を修正する（落とし穴2の対処）

Cookie設定ファイルを探し（`cookies.ts` 等）、`sameSite: "none"` を固定値で設定している箇所を修正：

```typescript
const secure = isSecureRequest(req); // または req.protocol === "https" 等の判定
return {
  httpOnly: true,
  path: "/",
  sameSite: secure ? ("none" as const) : ("lax" as const),
  secure,
};
```

### Step 6: サーバー側にローカル認証エンドポイントを追加する

`server/_core/devAuth.ts`（プロジェクト構成に合わせたパス）を作成：

```typescript
/**
 * ローカル開発専用の認証ルート
 * NODE_ENV=development のときのみ登録される
 */
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import type { Express, Request, Response } from "express";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";
import { sdk } from "./sdk";

// プロジェクトのロール定義に合わせて調整
const DEV_USERS = {
  admin: {
    openId: "local_admin",
    name: "Local Admin",
    email: "admin@local.dev",
    loginMethod: "dev",
    systemRole: "admin" as const, // プロジェクトのロール名・型に合わせる
  },
  user: {
    openId: "local_user",
    name: "Local User",
    email: "user@local.dev",
    loginMethod: "dev",
    systemRole: "user" as const,
  },
};

export function registerDevAuthRoutes(app: Express) {
  app.get("/api/dev/login", async (req: Request, res: Response) => {
    const role = req.query.role as string;
    const user = DEV_USERS[role as keyof typeof DEV_USERS] ?? DEV_USERS.user;

    try {
      await db.upsertUser(user);

      const sessionToken = await sdk.createSessionToken(user.openId, {
        name: user.name,
        expiresInMs: ONE_YEAR_MS,
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, {
        ...cookieOptions,
        maxAge: ONE_YEAR_MS,
      });
      res.redirect(302, "/");
    } catch (error) {
      console.error("[DevAuth] Login failed", error);
      res
        .status(500)
        .json({ error: "Dev login failed", detail: String(error) });
    }
  });

  console.log(
    "[DevAuth] Dev login routes registered: GET /api/dev/login?role=..."
  );
}
```

サーバーのエントリーポイントへの登録（Step 4 の修正箇所の直後に追加）：

```typescript
// ローカル開発専用: 外部Auth不要の直接ログイン
if (process.env.NODE_ENV === "development") {
  registerDevAuthRoutes(app);
}
```

### Step 7: フロントエンドにローカルログイン画面を追加する

`client/src/pages/DevLogin.tsx`（プロジェクト構成に合わせたパス）を作成。
プロジェクトに shadcn/ui や Tailwind がある場合はそれを使い、ない場合はインラインスタイルで：

```tsx
/**
 * ローカル開発専用ログイン画面
 * import.meta.env.DEV === true のときのみ使用
 */
export default function DevLogin() {
  return (
    <div
      style={{
        display: "flex",
        minHeight: "100vh",
        alignItems: "center",
        justifyContent: "center",
        background: "#f9fafb",
      }}
    >
      <div
        style={{
          background: "white",
          borderRadius: 12,
          boxShadow: "0 4px 24px rgba(0,0,0,0.1)",
          padding: 40,
          maxWidth: 360,
          width: "100%",
          textAlign: "center",
        }}
      >
        <span
          style={{
            background: "#fef3c7",
            color: "#92400e",
            fontSize: 12,
            fontWeight: 600,
            padding: "4px 12px",
            borderRadius: 9999,
            display: "inline-block",
            marginBottom: 16,
          }}
        >
          Local Dev Only
        </span>
        <h1 style={{ fontSize: 24, fontWeight: "bold", marginBottom: 8 }}>
          開発用ログイン
        </h1>
        <p style={{ color: "#6b7280", fontSize: 14, marginBottom: 24 }}>
          本番環境ではこの画面は表示されません
        </p>
        {/* ロールの数だけボタンを追加 */}
        <a
          href="/api/dev/login?role=admin"
          style={{
            display: "block",
            background: "#4f46e5",
            color: "white",
            padding: "12px 0",
            borderRadius: 8,
            fontWeight: 600,
            marginBottom: 12,
            textDecoration: "none",
          }}
        >
          Admin としてログイン
        </a>
        <a
          href="/api/dev/login?role=user"
          style={{
            display: "block",
            background: "#059669",
            color: "white",
            padding: "12px 0",
            borderRadius: 8,
            fontWeight: 600,
            textDecoration: "none",
          }}
        >
          User としてログイン
        </a>
        <p style={{ color: "#9ca3af", fontSize: 12, marginTop: 24 }}>
          DB: Docker (127.0.0.1:PORT/DB名)
        </p>
      </div>
    </div>
  );
}
```

ルーター設定ファイルに追加（`import.meta.env.DEV` で本番ビルドから除外）：

```tsx
// React Router v6
{
  import.meta.env.DEV && <Route path="/dev-login" element={<DevLogin />} />;
}

// wouter
{
  import.meta.env.DEV && <Route path="/dev-login" component={DevLogin} />;
}
```

### Step 8: ログインURLをローカル用に切り替える

外部Auth（OAuth等）へのリダイレクトを生成している関数を探して修正：

```typescript
export const getLoginUrl = () => {
  if (import.meta.env.DEV) return "/dev-login"; // ← 追加
  // ... 既存の本番ログインURL生成ロジックはそのまま
};
```

### Step 9: 型チェックを実行する

```bash
pnpm check  # または npx tsc --noEmit
```

エラーがあれば修正する。

### Step 10: 完了報告と起動手順を提示する

以下の形式で報告：

```
## ローカル開発セットアップ完了

### 起動手順（初回）
1. Docker Desktop を起動
2. docker compose up -d          # コンテナ起動
3. docker compose ps             # STATUS が "healthy" になるまで待つ
4. pnpm db:push                  # マイグレーション（.env.local は自動で読まれる）
5. pnpm dev                      # 開発サーバー起動

### 起動手順（2回目以降）
1. Docker Desktop を起動
2. docker compose up -d
3. pnpm dev

### ログイン
http://localhost:PORT にアクセス → /dev-login に自動遷移
→ ロールを選んでクリックするだけでログイン完了

### 作成・変更ファイル
| ファイル | 内容 |
|---|---|
| docker-compose.yml | DBコンテナ定義 |
| .env.local | ローカル環境変数（gitignore済み） |
| server/_core/devAuth.ts | ローカル認証エンドポイント |
| server/_core/index.ts | dotenv修正 + devAuth登録 |
| server/_core/cookies.ts | sameSite HTTP対応 |
| client/src/pages/DevLogin.tsx | ロール選択ログイン画面 |
| client/src/App.tsx | /dev-login ルート追加（DEV時のみ） |
| client/src/const.ts | getLoginUrl DEV分岐 |
```

---

## 注意事項

- **本番コードへの影響ゼロ**を最優先。分岐は必ず `NODE_ENV === "development"` / `import.meta.env.DEV` で行う
- `devAuth.ts` は `NODE_ENV=development` 以外では絶対に登録しない（セキュリティ上の必須要件）
- `.env.local` に本番の機密情報を絶対に入れない
- マイグレーションは必ずコンテナが `healthy` になってから実行する（落とし穴3）
- `DATABASE_URL` は `localhost` ではなく `127.0.0.1` を使う（落とし穴4）
- dotenv の読み込み順は `.env` → `.env.local`（後者が優先）で統一する（落とし穴1）
