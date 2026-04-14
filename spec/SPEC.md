# Hybra Auto-Bribe Bot — 技術仕様書

> **Version**: 1.0.0
> **Last Updated**: 2026-04-13
> **Status**: Phase 0 (Contract Discovery) 前
> **Author**: Claude (Senior Blockchain Engineer)

---

## 1. 概要

### 1.1 目的

Hybra Finance（HyperEVM上 ve(3,3) DEX）の hzUSD-shzUSD プールに対し、毎週のepochごとに **5 hzUSD** のbribeを自動投入するシステムを構築する。

### 1.2 背景

- Hybraはve(3,3)モデルを採用。veHYBRA保有者がgaugeに投票し、投票量に応じてHYBR emissionがLPプールに配分される
- bribeは投票者へのインセンティブ。bribeを投入するとveHYBRA保有者がそのgaugeに投票する動機が生まれる
- 現在手動運用 → epoch漏れ・タイミングミスのリスクがある
- 自動化により安定的な emission 獲得を実現する

### 1.3 スコープ

| IN | OUT |
|----|-----|
| hzUSD-shzUSD プールへの自動bribe | LP追加・除去 |
| epoch検知・重複防止 | veHYBRA購入・ロック |
| Discord通知 | gauge投票 |
| GitHub Actions による週次自動実行 | 複数プールの同時運用（将来拡張として設計のみ） |
| DRY_RUN モード | UIダッシュボード |

---

## 2. システムアーキテクチャ

### 2.1 全体構成

```
┌──────────────────────────────────────────────────────────┐
│                   GitHub Actions                         │
│                   (weekly cron)                           │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │                 src/index.ts                        │  │
│  │                                                    │  │
│  │  ┌──────────────┐  ┌───────────────┐  ┌─────────┐ │  │
│  │  │ EpochMonitor │─▶│ BribeExecutor │─▶│Notifier │ │  │
│  │  └──────┬───────┘  └───────┬───────┘  └────┬────┘ │  │
│  │         │                  │                │      │  │
│  │         ▼                  ▼                ▼      │  │
│  │    Minter /           BribeContract     Discord    │  │
│  │    VoterV3            + ERC20           Webhook    │  │
│  │    (on-chain)         (on-chain)                   │  │
│  │                                                    │  │
│  │  ┌──────────────────────────────────────────────┐  │  │
│  │  │        State (GitHub Artifacts)               │  │  │
│  │  │  state.json: lastBribedEpoch, history[]      │  │  │
│  │  └──────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

### 2.2 実行フロー

```
START
  │
  ▼
[1] 環境変数ロード & バリデーション
  │
  ▼
[2] state.json 読み込み (GitHub Artifact から復元、初回は空)
  │
  ▼
[3] Minter.active_period() → currentEpochStart 取得
  │  currentEpochId = currentEpochStart / 604800
  │
  ▼
[4] state.lastBribedEpoch === currentEpochId ?
  │
  ├─ YES → ログ出力 "Already bribed for epoch {id}" → SKIP → END
  │
  └─ NO ──▼
           │
          [5] DRY_RUN === true ?
           │
           ├─ YES → ログ出力 "DRY_RUN: would bribe {amount} hzUSD" → END
           │
           └─ NO ──▼
                    │
                   [6] hzUSD.balanceOf(wallet) >= bribeAmount ?
                    │
                    ├─ NO → Discord通知 "残高不足" → ERROR → END
                    │
                    └─ YES ──▼
                             │
                            [7] hzUSD.allowance(wallet, bribeContract) >= bribeAmount ?
                             │
                             ├─ NO → hzUSD.approve(bribeContract, bribeAmount)
                             │        └─ 失敗 → リトライ or エラー通知
                             │
                             └─ (YES or approve成功) ──▼
                                                       │
                                                      [8] bribeContract.notifyRewardAmount(hzUSD, bribeAmount)
                                                       │
                                                       ├─ 失敗 → リトライ (最大3回、指数バックオフ)
                                                       │          └─ 3回失敗 → Discord通知 → END
                                                       │
                                                       └─ 成功 ──▼
                                                                  │
                                                                 [9] state.json 更新
                                                                  │  lastBribedEpoch = currentEpochId
                                                                  │  history[] に追記
                                                                  │
                                                                  ▼
                                                                 [10] Discord通知 (成功)
                                                                  │
                                                                  ▼
                                                                 [11] state.json を GitHub Artifact に保存
                                                                  │
                                                                  ▼
                                                                 END
```

---

## 3. コントラクト仕様

### 3.1 確定アドレス

| Contract | Address | Source |
|----------|---------|--------|
| hzUSD | `0x6E2ade6FFc94d24A81406285c179227dfBFc97CE` | Yas提供 |
| shzUSD | `0xce01a9B9bc08f0847fb745044330Eff1181360Cd` | Yas提供 |
| hzUSD-shzUSD Pool (V3, fee=500) | `0x2084B52E234211399b5f691dEc1edB69ec6Bc721` | Yas提供 |
| HYBR Token | `0x067b0C72aa4C6Bd3BFEFfF443c536DCd6a25a9C8` | Hybra Docs |
| VoterV3 | `0x5623F012d15EB828C12fe32e46d40AdC2A9e4FA3` | Hybra Docs |
| BribeFactoryV3 | `0x2555F79AC6e8096c755096e3A8d175a4Bf5fC82F` | Hybra Docs |
| GaugeManager | `0x742CAA5bA7C92ca6CFeBfD0e73c21739b3b65d5e` | Hybra Docs |
| Minter | `0xA8265e40e4Cdf6DB345861F4FCb75F9CC63E149b` | Hybra Docs |
| RewardsDistributor | `0x04FCae9aF38e79B7bb96D4f2Ef0f020E9c8739A9` | Hybra Docs |

### 3.2 Phase 0 で取得するアドレス

| Contract | 取得方法 | 用途 |
|----------|----------|------|
| Gauge | `VoterV3.gauges(poolAddress)` | hzUSD-shzUSDプールのgauge |
| External Bribe | `VoterV3.external_bribes(gaugeAddress)` | bribe投入先コントラクト |

### 3.3 仮定するコントラクトインターフェース

> **根拠**: ve(3,3) fork標準（Solidly / Velodrome / Thena）。Phase 0 で実際のABIと照合し、差分があれば修正する。

#### 3.3.1 Minter

```solidity
// Epoch タイミング取得
function active_period() external view returns (uint256);
// Returns: 現在epochの開始タイムスタンプ（unix seconds）
// Epochは 604800 秒 (7日) ごとに切り替わる
```

#### 3.3.2 VoterV3

```solidity
// Pool → Gauge マッピング
function gauges(address pool) external view returns (address);

// Gauge → External Bribe マッピング
function external_bribes(address gauge) external view returns (address);

// Whitelist確認
function isWhitelistedToken(address token) external view returns (bool);
```

#### 3.3.3 BribeContract (External Bribe)

```solidity
// Bribe投入
function notifyRewardAmount(address token, uint256 amount) external;
// Precondition: token.approve(address(this), amount) が必要
// Effect: 現在のepochにbribeが登録される
```

#### 3.3.4 ERC20 (hzUSD)

```solidity
function balanceOf(address account) external view returns (uint256);
function allowance(address owner, address spender) external view returns (uint256);
function approve(address spender, uint256 amount) external returns (bool);
function decimals() external view returns (uint8); // 想定: 18
```

### 3.4 仮定事項とリスク

| # | 仮定 | リスク | 緩和策 |
|---|------|--------|--------|
| A1 | Bribe関数は `notifyRewardAmount(address, uint256)` | Hybra独自の関数名の可能性 | Phase 0 でABI確認。関数セレクタ探索スクリプトで検証 |
| A2 | Epoch情報は `Minter.active_period()` で取得可能 | VoterV3側にある可能性 | 両方試行、成功した方を採用 |
| A3 | hzUSD は bribe whitelisted token | ホワイトリスト未登録の可能性 | `isWhitelistedToken()` で事前確認。未登録ならHybraチームに依頼 |
| A4 | hzUSD decimals = 18 | 異なる可能性 | `decimals()` で動的取得 |
| A5 | HyperEVM RPC は EIP-1559 対応 | Legacy tx のみの可能性 | gasPrice フォールバック実装 |

---

## 4. モジュール仕様

### 4.1 `src/config.ts` — 設定管理

#### 責務
- 環境変数の読み込みとバリデーション
- 型安全な設定オブジェクトのエクスポート
- ハードコードされた安全制限値の定義

#### エクスポート

```typescript
interface Config {
  // RPC
  rpcUrl: string;

  // Wallet
  privateKey: `0x${string}`;

  // Contract Addresses (all checksummed)
  hzusdAddress: `0x${string}`;
  shzusdAddress: `0x${string}`;
  poolAddress: `0x${string}`;
  bribeContractAddress: `0x${string}`;
  voterAddress: `0x${string}`;
  minterAddress: `0x${string}`;

  // Bribe Parameters
  bribeAmount: bigint;           // wei 単位
  maxBribeAmount: bigint;        // wei 単位 (ハードキャップ)

  // Notifications
  discordWebhookUrl: string;

  // Gas
  gasPriceBufferPercent: number; // default: 20
  maxRetryCount: number;         // default: 3

  // Mode
  dryRun: boolean;               // default: false
}

// ハードコード定数（.envで上書き不可）
const HARD_MAX_BRIBE_WEI = parseEther("10");  // 絶対上限: 10 hzUSD
const EPOCH_DURATION = 604800;                 // 7日 (秒)
```

#### バリデーションルール

| 項目 | 条件 | 失敗時 |
|------|------|--------|
| `PRIVATE_KEY` | 存在 & `0x`始まり & 66文字 | throw ConfigError |
| `RPC_URL` | 存在 & `https://`始まり | throw ConfigError |
| `BRIBE_AMOUNT` | 数値 & > 0 & <= 10 | throw ConfigError |
| `BRIBE_CONTRACT_ADDRESS` | 存在 & viem.isAddress() | throw ConfigError |
| `DISCORD_WEBHOOK_URL` | 存在 & `https://discord.com/api/webhooks/`始まり | throw ConfigError |
| 全アドレス | viem.getAddress() でchecksum変換成功 | throw ConfigError |
| `bribeAmount` | <= `HARD_MAX_BRIBE_WEI` | throw ConfigError("Bribe amount exceeds hard cap") |

---

### 4.2 `src/types.ts` — 型定義

```typescript
/** Bribeターゲット（将来の複数プール対応用） */
interface BribeTarget {
  name: string;                          // e.g. "hzUSD-shzUSD"
  poolAddress: `0x${string}`;
  bribeContractAddress: `0x${string}`;
  tokenAddress: `0x${string}`;           // bribeに使うトークン
  amount: bigint;                        // wei単位のbribe額
  enabled: boolean;
}

/** Epoch情報 */
interface EpochInfo {
  epochId: number;                       // epoch番号 (epochStart / DURATION)
  epochStart: number;                    // epoch開始 unix timestamp
  epochEnd: number;                      // epoch終了 unix timestamp
  secondsSinceStart: number;             // epoch開始からの経過秒数
  isNewEpoch: boolean;                   // 前回bribe時と異なるepochか
}

/** Bribe実行結果 */
interface BribeResult {
  success: boolean;
  txHash?: `0x${string}`;
  gasUsed?: bigint;
  error?: string;
  retryCount: number;
}

/** 永続化状態 */
interface BribeState {
  lastBribedEpoch: number;               // 最後にbribeしたepoch ID
  history: BribeHistoryEntry[];
}

interface BribeHistoryEntry {
  epochId: number;
  txHash: string;
  amount: string;                        // wei (string for JSON serialization)
  timestamp: string;                     // ISO 8601
  status: "success" | "failed";
  pool: string;
  gasUsed?: string;
}

/** 通知ペイロード */
interface NotificationPayload {
  type: "success" | "failure" | "warning" | "info";
  title: string;
  fields: Record<string, string>;
  color?: number;                        // Discord embed color
}
```

---

### 4.3 `src/epoch-monitor.ts` — Epoch状態取得

#### 責務
- オンチェーンからepochタイミングを取得
- 現在のepoch IDを算出
- bribe実行判定を提供

#### 公開関数

| 関数 | 引数 | 戻り値 | 説明 |
|------|------|--------|------|
| `getCurrentEpoch()` | なし | `Promise<EpochInfo>` | Minter.active_period() からepoch情報を構築 |
| `getEpochId(epochStart)` | `number` | `number` | `Math.floor(epochStart / EPOCH_DURATION)` |

#### ロジック詳細

```
getCurrentEpoch():
  1. minterContract.read.active_period() を呼び出し
  2. 失敗した場合、代替として voterContract で試行
  3. epochStart = 返り値 (unix timestamp)
  4. epochId = Math.floor(epochStart / 604800)
  5. epochEnd = epochStart + 604800
  6. secondsSinceStart = now - epochStart
  7. EpochInfo を返却
```

#### エラーハンドリング

| エラー | 対処 |
|--------|------|
| RPC接続失敗 | 3回リトライ (2秒, 4秒, 8秒) → 失敗通知 → throw |
| 関数呼び出し失敗 | VoterV3のactivePeriod等でフォールバック試行 |
| 返り値が0 | "Epoch not started yet" として通知 → throw |

---

### 4.4 `src/bribe-executor.ts` — Bribe実行

#### 責務
- hzUSD残高チェック
- ERC20 approve（exact amount）
- bribeコントラクトへの `notifyRewardAmount` 呼び出し
- ガス推定・リトライ・nonce管理

#### 公開関数

| 関数 | 引数 | 戻り値 | 説明 |
|------|------|--------|------|
| `executeBribe(target)` | `BribeTarget` | `Promise<BribeResult>` | bribe全体フローを実行 |

#### 実行フロー詳細

```
executeBribe(target):
  1. BALANCE CHECK
     balance = hzUSD.balanceOf(walletAddress)
     if balance < target.amount:
       return { success: false, error: "Insufficient hzUSD balance" }

  2. ALLOWANCE CHECK & APPROVE
     allowance = hzUSD.allowance(walletAddress, target.bribeContractAddress)
     if allowance < target.amount:
       tx = hzUSD.approve(target.bribeContractAddress, target.amount)
       // exact amount のみ。NEVER use type(uint256).max
       receipt = waitForTransaction(tx)
       if receipt.status !== "success":
         return { success: false, error: "Approve failed" }

  3. BRIBE EXECUTION (with retry)
     for attempt = 1 to MAX_RETRY_COUNT:
       try:
         gasEstimate = bribeContract.estimateGas.notifyRewardAmount(
           target.tokenAddress, target.amount
         )
         gasLimit = gasEstimate * 120n / 100n  // +20% buffer

         tx = bribeContract.write.notifyRewardAmount(
           [target.tokenAddress, target.amount],
           { gas: gasLimit }
         )
         receipt = waitForTransaction(tx, { confirmations: 1 })

         if receipt.status === "success":
           return {
             success: true,
             txHash: receipt.transactionHash,
             gasUsed: receipt.gasUsed,
             retryCount: attempt - 1
           }
         else:
           throw Error("Tx reverted")

       catch (error):
         if attempt < MAX_RETRY_COUNT:
           sleep(2^attempt * 1000)  // 2s, 4s, 8s
           continue
         else:
           return {
             success: false,
             error: error.message,
             retryCount: attempt
           }
```

#### ガス戦略

| パラメータ | 値 | 説明 |
|-----------|-----|------|
| Gas推定方式 | `estimateGas` + 20% buffer | 安全マージン |
| EIP-1559対応 | `maxFeePerGas` + `maxPriorityFeePerGas` | HyperEVMがサポートする場合 |
| Legacyフォールバック | `gasPrice` | EIP-1559未サポート時 |
| Nonce管理 | `getTransactionCount("pending")` | stuck tx防止 |
| リトライ | 最大3回、指数バックオフ (2s, 4s, 8s) | 一時的障害対応 |

#### 安全装置

```
INVARIANT: target.amount <= HARD_MAX_BRIBE_WEI (10e18)
  → 違反時は即座にthrow（リトライしない）

INVARIANT: approve は exact amount のみ
  → uint256.max の approve は禁止

INVARIANT: 1 epoch につき 1 回のみ実行
  → state.lastBribedEpoch で管理（呼び出し元で制御）
```

---

### 4.5 `src/notifier.ts` — Discord通知

#### 責務
- Discord Webhook API を使ったEmbed通知送信
- 成功/失敗/警告の3種類のメッセージフォーマット

#### 公開関数

| 関数 | 引数 | 戻り値 | 説明 |
|------|------|--------|------|
| `notify(payload)` | `NotificationPayload` | `Promise<void>` | Discord Webhookにembed送信 |
| `notifyBribeSuccess(epoch, result)` | `EpochInfo, BribeResult` | `Promise<void>` | 成功通知のヘルパー |
| `notifyBribeFailure(epoch, error)` | `EpochInfo, string` | `Promise<void>` | 失敗通知のヘルパー |
| `notifyLowBalance(balance)` | `bigint` | `Promise<void>` | 残高警告のヘルパー |

#### メッセージフォーマット

**成功時 (Green: 0x00FF00)**
```json
{
  "embeds": [{
    "title": "✅ Bribe Submitted — Epoch #42",
    "color": 65280,
    "fields": [
      { "name": "Pool", "value": "hzUSD-shzUSD", "inline": true },
      { "name": "Amount", "value": "5.0 hzUSD", "inline": true },
      { "name": "Tx Hash", "value": "[0xabc...def](https://hyperscan.xyz/tx/0x...)", "inline": false },
      { "name": "Gas Used", "value": "85,432", "inline": true },
      { "name": "Retries", "value": "0", "inline": true }
    ],
    "timestamp": "2026-04-10T01:30:00.000Z"
  }]
}
```

**失敗時 (Red: 0xFF0000)**
```json
{
  "embeds": [{
    "title": "❌ Bribe Failed — Epoch #42",
    "color": 16711680,
    "fields": [
      { "name": "Pool", "value": "hzUSD-shzUSD", "inline": true },
      { "name": "Error", "value": "Tx reverted: insufficient allowance", "inline": false },
      { "name": "Retries", "value": "3/3 exhausted", "inline": true }
    ],
    "timestamp": "2026-04-10T01:30:00.000Z"
  }]
}
```

**残高警告 (Yellow: 0xFFFF00)**
```json
{
  "embeds": [{
    "title": "⚠️ Low hzUSD Balance",
    "color": 16776960,
    "fields": [
      { "name": "Balance", "value": "12.5 hzUSD", "inline": true },
      { "name": "Remaining Epochs", "value": "~2 epochs", "inline": true },
      { "name": "Action", "value": "Replenish bribe wallet", "inline": false }
    ]
  }]
}
```

#### エラーハンドリング
- Webhook送信失敗: `console.error` でログ出力のみ（通知失敗でbribeフローを止めない）
- タイムアウト: 10秒

---

### 4.6 `src/index.ts` — メインエントリ

#### 責務
- 全モジュールの統合
- state.json の読み書き
- メインフロー制御

#### 処理シーケンス

```typescript
async function main(): Promise<void> {
  // [1] Config load & validate
  const config = loadConfig();
  log("Config loaded");

  // [2] State load (may not exist on first run)
  const state = loadState();  // returns default if file missing
  log(`State loaded: lastBribedEpoch=${state.lastBribedEpoch}`);

  // [3] Get current epoch
  const epoch = await getCurrentEpoch();
  log(`Current epoch: #${epoch.epochId} (started ${epoch.secondsSinceStart}s ago)`);

  // [4] Duplicate check
  if (state.lastBribedEpoch === epoch.epochId) {
    log(`Already bribed for epoch #${epoch.epochId}. Skipping.`);
    return;
  }

  // [5] DRY_RUN check
  if (config.dryRun) {
    log(`DRY_RUN: Would bribe ${formatEther(config.bribeAmount)} hzUSD for epoch #${epoch.epochId}`);
    await notify({ type: "info", title: "DRY_RUN: Bribe simulated", fields: { ... } });
    return;
  }

  // [6] Check balance & warn if low
  const balance = await getBalance(config.hzusdAddress, walletAddress);
  if (balance < config.bribeAmount) {
    await notifyLowBalance(balance);
    throw new Error(`Insufficient balance: ${formatEther(balance)} < ${formatEther(config.bribeAmount)}`);
  }
  const LOW_BALANCE_THRESHOLD = config.bribeAmount * 4n; // 4 epochs worth
  if (balance < LOW_BALANCE_THRESHOLD) {
    await notifyLowBalance(balance);
  }

  // [7] Execute bribe
  const target: BribeTarget = {
    name: "hzUSD-shzUSD",
    poolAddress: config.poolAddress,
    bribeContractAddress: config.bribeContractAddress,
    tokenAddress: config.hzusdAddress,
    amount: config.bribeAmount,
    enabled: true,
  };

  const result = await executeBribe(target);

  // [8] Update state
  if (result.success) {
    state.lastBribedEpoch = epoch.epochId;
    state.history.push({
      epochId: epoch.epochId,
      txHash: result.txHash!,
      amount: config.bribeAmount.toString(),
      timestamp: new Date().toISOString(),
      status: "success",
      pool: target.name,
      gasUsed: result.gasUsed?.toString(),
    });
    saveState(state);
    await notifyBribeSuccess(epoch, result);
  } else {
    state.history.push({
      epochId: epoch.epochId,
      txHash: "",
      amount: config.bribeAmount.toString(),
      timestamp: new Date().toISOString(),
      status: "failed",
      pool: target.name,
    });
    saveState(state);
    await notifyBribeFailure(epoch, result.error ?? "Unknown error");
    process.exitCode = 1;
  }
}
```

---

## 5. 状態管理

### 5.1 state.json スキーマ

```json
{
  "lastBribedEpoch": 42,
  "history": [
    {
      "epochId": 42,
      "txHash": "0xabc123...",
      "amount": "5000000000000000000",
      "timestamp": "2026-04-10T01:30:00.000Z",
      "status": "success",
      "pool": "hzUSD-shzUSD",
      "gasUsed": "85432"
    }
  ]
}
```

### 5.2 永続化方式

**GitHub Artifacts** を使用:

```yaml
# 復元（job開始時）
- uses: actions/download-artifact@v4
  with:
    name: bribe-state
    path: .
  continue-on-error: true  # 初回は存在しないのでスキップ

# 保存（job終了時）
- uses: actions/upload-artifact@v4
  with:
    name: bribe-state
    path: state.json
    retention-days: 90
    overwrite: true
```

### 5.3 初回実行時

state.json が存在しない場合のデフォルト:

```json
{
  "lastBribedEpoch": 0,
  "history": []
}
```

---

## 6. デプロイ仕様

### 6.1 GitHub Actions ワークフロー

```yaml
name: Auto Bribe hzUSD-shzUSD

on:
  schedule:
    # 毎週木曜 00:00 UTC（Phase 0でepoch開始曜日特定後に調整）
    - cron: '0 0 * * 4'
  workflow_dispatch:
    inputs:
      dry_run:
        description: 'Run in dry-run mode (no tx sent)'
        required: false
        default: 'false'
        type: choice
        options: ['true', 'false']

jobs:
  bribe:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js 20
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Restore state
        uses: actions/download-artifact@v4
        with:
          name: bribe-state
          path: .
        continue-on-error: true

      - name: Execute bribe
        run: npx tsx src/index.ts
        env:
          PRIVATE_KEY: ${{ secrets.BRIBE_WALLET_PRIVATE_KEY }}
          RPC_URL: ${{ secrets.RPC_URL }}
          DISCORD_WEBHOOK_URL: ${{ secrets.DISCORD_WEBHOOK_URL }}
          HZUSD_ADDRESS: '0x6E2ade6FFc94d24A81406285c179227dfBFc97CE'
          SHZUSD_ADDRESS: '0xce01a9B9bc08f0847fb745044330Eff1181360Cd'
          POOL_ADDRESS: '0x2084B52E234211399b5f691dEc1edB69ec6Bc721'
          VOTER_ADDRESS: '0x5623F012d15EB828C12fe32e46d40AdC2A9e4FA3'
          MINTER_ADDRESS: '0xA8265e40e4Cdf6DB345861F4FCb75F9CC63E149b'
          BRIBE_CONTRACT_ADDRESS: ${{ secrets.BRIBE_CONTRACT_ADDRESS }}
          BRIBE_AMOUNT: '5'
          DRY_RUN: ${{ github.event.inputs.dry_run || 'false' }}

      - name: Save state
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: bribe-state
          path: state.json
          retention-days: 90
          overwrite: true
```

### 6.2 GitHub Secrets

| Secret名 | 値 | 説明 |
|-----------|-----|------|
| `BRIBE_WALLET_PRIVATE_KEY` | `0x...` | bribe実行ウォレットの秘密鍵 |
| `RPC_URL` | `https://rpc.hyperliquid.xyz/evm` | HyperEVM RPC |
| `DISCORD_WEBHOOK_URL` | `https://discord.com/api/webhooks/...` | Discord通知先 |
| `BRIBE_CONTRACT_ADDRESS` | `0x...` | Phase 0 で取得後に設定 |

### 6.3 タイミング戦略

```
Epoch (7日) ──────────────────────────────────────────▶

  Epoch N開始                              Epoch N+1開始
  │                                        │
  │   ← GitHub Actions cron fires →        │
  │       (epoch開始後 数時間以内)           │
  │                                        │
  │   スクリプト判定:                        │
  │   epoch N で bribe済み? → NO → 実行     │
  │                          YES → スキップ │
```

- **cron schedule**: Phase 0 で実際のepoch開始曜日/時刻を特定し、その **1-3時間後** に設定
- **GitHub Actions cronのズレ**: 数分〜十数分のズレは許容。スクリプト側で epoch判定するため問題なし
- **手動トリガー**: `workflow_dispatch` でいつでも手動実行可能（重複はstate.jsonで防止）

---

## 7. セキュリティ仕様

### 7.1 秘密鍵管理

| ルール | 実装 |
|--------|------|
| ハードコード禁止 | コード内に秘密鍵の文字列は一切存在しない |
| .envに記載禁止（CI環境） | GitHub Secrets のみ |
| ローカル開発時 | .env を使用、.gitignore で除外 |
| ログ出力禁止 | console.log で秘密鍵を出力しない |

### 7.2 金額制限

```typescript
// コード内ハードコード（環境変数では上書き不可）
const HARD_MAX_BRIBE_WEI = parseEther("10"); // 10 hzUSD

// 実行時チェック
if (bribeAmount > HARD_MAX_BRIBE_WEI) {
  throw new Error(`SECURITY: Bribe amount ${formatEther(bribeAmount)} exceeds hard cap of 10 hzUSD`);
}
```

### 7.3 Approve 制御

```typescript
// ALLOWED: exact amount approve
await hzusd.write.approve([bribeContract, bribeAmount]);

// FORBIDDEN: unlimited approve (このコードは存在しない)
// await hzusd.write.approve([bribeContract, MaxUint256]); // ❌ 禁止
```

### 7.4 重複実行防止

二重チェック:
1. **state.json**: `lastBribedEpoch === currentEpochId` → スキップ
2. **GitHub Actions**: 同時実行制御 (`concurrency` グループ)

```yaml
# GitHub Actions
concurrency:
  group: auto-bribe
  cancel-in-progress: false  # 実行中のジョブはキャンセルしない
```

### 7.5 アドレス検証

```typescript
// 全アドレスを checksum 形式に正規化
import { getAddress, isAddress } from 'viem';

function validateAddress(raw: string, label: string): `0x${string}` {
  if (!isAddress(raw)) {
    throw new Error(`Invalid address for ${label}: ${raw}`);
  }
  return getAddress(raw);
}
```

---

## 8. エラーハンドリング

### 8.1 エラー分類

| カテゴリ | 例 | 対処 |
|----------|-----|------|
| Config Error | 環境変数不足、アドレス不正 | 即座にthrow、通知なし（設定ミスは開発で検出） |
| Network Error | RPC接続失敗、タイムアウト | 3回リトライ（指数バックオフ） |
| Contract Error | revert、ガス不足 | 3回リトライ → 失敗通知 |
| Balance Error | hzUSD残高不足 | 通知 → 終了（リトライ不要） |
| State Error | state.json 破損 | デフォルト値で初期化（ログ出力） |

### 8.2 リトライ戦略

```typescript
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  label: string = "operation"
): Promise<T> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxRetries) throw error;
      const delay = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
      console.log(`${label}: attempt ${attempt}/${maxRetries} failed, retrying in ${delay}ms...`);
      await sleep(delay);
    }
  }
  throw new Error("unreachable");
}
```

---

## 9. 可観測性

### 9.1 ログ出力

全てのログは `console.log` / `console.error` で出力（GitHub Actions のログに記録される）。

```
[2026-04-10T01:30:00Z] INFO: Config loaded successfully
[2026-04-10T01:30:01Z] INFO: State loaded: lastBribedEpoch=41
[2026-04-10T01:30:02Z] INFO: Current epoch: #42 (started 3600s ago)
[2026-04-10T01:30:02Z] INFO: New epoch detected. Proceeding with bribe.
[2026-04-10T01:30:03Z] INFO: hzUSD balance: 25.0 (sufficient)
[2026-04-10T01:30:04Z] INFO: Approving 5.0 hzUSD to bribe contract...
[2026-04-10T01:30:10Z] INFO: Approve tx confirmed: 0xabc...
[2026-04-10T01:30:11Z] INFO: Submitting bribe: 5.0 hzUSD for epoch #42
[2026-04-10T01:30:20Z] INFO: Bribe tx confirmed: 0xdef... (gas: 85432)
[2026-04-10T01:30:21Z] INFO: State updated: lastBribedEpoch=42
[2026-04-10T01:30:22Z] INFO: Discord notification sent.
```

### 9.2 Discord通知一覧

| イベント | 通知 | 色 |
|----------|------|-----|
| Bribe成功 | epoch, amount, txHash, gasUsed | Green |
| Bribe失敗（リトライ超過） | epoch, error, retryCount | Red |
| 残高不足 | balance, 残りepoch数 | Red |
| 残高警告 (< 4 epochs分) | balance, 残りepoch数 | Yellow |
| DRY_RUN実行 | epoch, simulated amount | Blue |

---

## 10. 拡張性設計

### 10.1 複数プール対応

`BribeTarget[]` 配列で管理。将来的に以下を追加可能:

```typescript
const BRIBE_TARGETS: BribeTarget[] = [
  {
    name: "hzUSD-shzUSD",
    poolAddress: "0x2084...",
    bribeContractAddress: "0x...",  // Phase 0で取得
    tokenAddress: "0x6E2a...",      // hzUSD
    amount: parseEther("5"),
    enabled: true,
  },
  // 将来追加:
  // { name: "hzUSD-USDT", ... },
  // { name: "hzUSD-USDC", ... },
];
```

### 10.2 bribe額の動的変更

`BRIBE_AMOUNT` 環境変数で制御。GitHub Actions の workflow_dispatch で実行時に変更可能:

```yaml
workflow_dispatch:
  inputs:
    bribe_amount:
      description: 'Bribe amount in hzUSD'
      required: false
      default: '5'
```

### 10.3 将来の拡張候補

| 機能 | 優先度 | 説明 |
|------|--------|------|
| 複数プール同時bribe | 中 | forループで順次実行 |
| 動的bribe額（TVL連動） | 低 | オンチェーンTVL取得 → 最適bribe計算 |
| bribe効率モニタリング | 低 | emission獲得量 / bribe額 の ROI追跡 |
| Telegram通知 | 低 | Discord + Telegram デュアル通知 |

---

## 11. 技術スタック

| 項目 | 選択 | バージョン | 理由 |
|------|------|-----------|------|
| 言語 | TypeScript | 5.x | 型安全性、viem との親和性 |
| Web3 | **viem** | 2.x | 型安全、軽量、modern API |
| ランタイム | Node.js + tsx | 20.x | TypeScript直接実行 |
| CI/CD | GitHub Actions | N/A | 無料枠あり、Secret管理、cron対応 |
| 通知 | Discord Webhook | N/A | 既存ワークスペースで使用実績 |
| 状態永続化 | GitHub Artifacts | v4 | CI環境での簡易永続化 |

### 11.1 依存パッケージ

```json
{
  "dependencies": {
    "viem": "^2.0.0",
    "dotenv": "^16.0.0"
  },
  "devDependencies": {
    "tsx": "^4.0.0",
    "typescript": "^5.0.0",
    "@types/node": "^20.0.0"
  }
}
```

---

## 12. ファイル構成（最終）

```
Hybra-Add-LP_Apr2026/
├── src/
│   ├── index.ts                 # メインエントリ & フロー制御
│   ├── config.ts                # 環境変数読み込み & バリデーション
│   ├── types.ts                 # TypeScript型定義
│   ├── epoch-monitor.ts         # Epoch状態取得 (Minter / VoterV3)
│   ├── bribe-executor.ts        # Bribe実行 (approve + notifyRewardAmount)
│   ├── notifier.ts              # Discord Webhook通知
│   └── abi/
│       ├── VoterV3.json         # gauges(), external_bribes(), isWhitelistedToken()
│       ├── Minter.json          # active_period()
│       ├── BribeContract.json   # notifyRewardAmount()
│       └── ERC20.json           # balanceOf(), allowance(), approve(), decimals()
├── scripts/
│   └── explore-contracts.ts     # Phase 0: オンチェーン調査スクリプト
├── .github/
│   └── workflows/
│       └── auto-bribe.yml       # GitHub Actions cron ワークフロー
├── .env.example                 # 環境変数テンプレート
├── .gitignore                   # .env, node_modules, state.json
├── package.json
├── tsconfig.json
└── README.md
```

---

## 13. Phase 0: コントラクト調査仕様

### 13.1 目的

実装開始前に、Hybra のオンチェーンコントラクトを調査し、仮定A1〜A5を検証する。

### 13.2 `scripts/explore-contracts.ts` の仕様

```
実行: npx tsx scripts/explore-contracts.ts

出力:
  [1] VoterV3.gauges(0x2084...) → gauge address or zero
  [2] VoterV3.external_bribes(gauge) → bribe contract address
  [3] Minter.active_period() → current epoch start timestamp
  [4] VoterV3.isWhitelistedToken(0x6E2a...) → true/false
  [5] hzUSD.decimals() → decimal places
  [6] Bribe contract function signatures (via 4byte selector probing)
      → notifyRewardAmount, getReward, etc.

判定:
  - [1] が zero address → gauge未作成。Hybra側に確認必要
  - [2] が zero address → external bribe未設定。Hybra側に確認必要
  - [3] が 0 → epoch未開始。時期尚早
  - [4] が false → hzUSD未ホワイトリスト。Hybra側に依頼必要
  - [6] で notifyRewardAmount が見つからない → ABI調査追加必要
```

### 13.3 Phase 0 完了条件

以下が **全て** 確認できたら Phase 0 完了:

- [ ] gauge アドレスが non-zero
- [ ] bribe コントラクトアドレスが non-zero
- [ ] `active_period()` が有効な timestamp を返す
- [ ] hzUSD が whitelisted
- [ ] bribe コントラクトの `notifyRewardAmount` 関数セレクタ確認
- [ ] hzUSD decimals 確認

---

## 14. テスト計画

### 14.1 Phase別テスト

| Phase | テスト内容 | 方法 |
|-------|-----------|------|
| Phase 0 | コントラクト調査スクリプト動作 | ローカル実行 |
| Phase 1 | DRY_RUN モード全フロー | GitHub Actions workflow_dispatch |
| Phase 2 | 少額テスト (1 hzUSD) | GitHub Actions workflow_dispatch |
| Phase 3 | 本番運用 (5 hzUSD) | cron自動実行 |

### 14.2 異常系テスト

| ケース | 期待動作 |
|--------|----------|
| 残高不足 | Discord通知 → 安全終了 |
| RPC障害 | 3回リトライ → 失敗通知 |
| ガス不足 | 3回リトライ → 失敗通知 |
| 同一epoch重複実行 | スキップ（state.jsonで検知） |
| state.json破損 | デフォルト値で初期化 → ログ出力 |
| Discord Webhook障害 | ログ出力のみ（bribeフローは継続） |

---

## 15. 検証チェックリスト

- [ ] `explore-contracts.ts` で gauge/bribe アドレス取得成功
- [ ] epoch タイミング取得成功（Minter.active_period()）
- [ ] DRY_RUN で全ロジックパス確認
- [ ] 少額(1 hzUSD)での本番bribe成功
- [ ] Discord通知の受信確認（成功・失敗・警告の3パターン）
- [ ] 重複実行時のスキップ確認
- [ ] 残高不足時のエラー通知確認
- [ ] GitHub Actions workflow_dispatch で手動実行成功
- [ ] GitHub Actions cron で自動実行成功
- [ ] state.json のArtifact保存・復元確認
