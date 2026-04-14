// ============================================================
// index.ts — Hybra Auto-Bribe Bot メインエントリ
// ============================================================

import { existsSync, readFileSync, writeFileSync } from "fs";
import { createPublicClient, http, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hyperEvm } from "./chains.js";

import { loadConfig, LOW_BALANCE_EPOCHS, RPC_CALL_TIMEOUT_MS } from "./config.js";
import { getCurrentEpoch } from "./epoch-monitor.js";
import { executeBribe, getHzusdBalance } from "./bribe-executor.js";
import {
  notifyBribeSuccess,
  notifyBribeFailure,
  notifyInsufficientBalance,
  notifyLowBalance,
  notifyDryRun,
} from "./notifier.js";
import type { BribeState, BribeTarget } from "./types.js";

const STATE_FILE = "state.json";

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] [Main] ${msg}`);
}

/**
 * 前回 "submitted but unconfirmed" で終わった txHash の on-chain ステータスを確認する。
 *
 * @returns
 *   "confirmed"  — receipt あり & status=success → 再送信不要
 *   "failed"     — receipt あり & status=reverted → 安全に再試行可
 *   "not_found"  — receipt なし (dropped or RPC error) → 安全に再試行可
 */
async function checkPendingTxStatus(
  rpcUrl: string,
  txHash: `0x${string}`
): Promise<"confirmed" | "failed" | "not_found"> {
  const client = createPublicClient({ chain: hyperEvm, transport: http(rpcUrl, { timeout: RPC_CALL_TIMEOUT_MS }) });
  try {
    const receipt = await client.getTransactionReceipt({ hash: txHash });
    return receipt.status === "success" ? "confirmed" : "failed";
  } catch {
    return "not_found";
  }
}

// ── State 読み書き ─────────────────────────────────────────

function loadState(): BribeState {
  if (existsSync(STATE_FILE)) {
    try {
      const raw = readFileSync(STATE_FILE, "utf-8");
      const parsed = JSON.parse(raw) as Partial<BribeState>;

      // 必須フィールドが欠損・型不正の場合はデフォルト値で補完する。
      // state.json が手動編集・バージョン移行・部分書込みで壊れていても
      // TypeError クラッシュせず安全に起動できる。
      const lastBribedEpoch =
        typeof parsed.lastBribedEpoch === "number" ? parsed.lastBribedEpoch : 0;
      const history = Array.isArray(parsed.history) ? parsed.history : [];
      const pendingTxHash =
        typeof parsed.pendingTxHash === "string" ? parsed.pendingTxHash : undefined;
      const pendingEpochId =
        typeof parsed.pendingEpochId === "number" ? parsed.pendingEpochId : undefined;

      const state: BribeState = { lastBribedEpoch, history, pendingTxHash, pendingEpochId };
      log(
        `State loaded: lastBribedEpoch=${state.lastBribedEpoch}, ` +
          `history=${state.history.length} entries` +
          (state.pendingTxHash ? `, pendingTxHash=${state.pendingTxHash}` : "")
      );
      return state;
    } catch (err) {
      log(`WARN: Failed to parse state.json (${String(err)}). Starting fresh.`);
    }
  } else {
    log("No state.json found. Starting fresh.");
  }
  return { lastBribedEpoch: 0, history: [] };
}

function saveState(state: BribeState): void {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
  log(`State saved: lastBribedEpoch=${state.lastBribedEpoch}`);
}

// ── メインフロー ───────────────────────────────────────────

async function main(): Promise<void> {
  log("=".repeat(60));
  log("Hybra Auto-Bribe Bot starting...");
  log("=".repeat(60));

  // [1] Config ロード & バリデーション
  const config = loadConfig();
  log(`Mode: ${config.dryRun ? "DRY_RUN" : "LIVE"}`);
  log(`Bribe amount: ${formatEther(config.bribeAmount)} hzUSD`);

  // [2] State 読み込み＆初期化保存
  // state.json を早期に書き出すことで、後続の処理が失敗しても
  // GitHub Actions の upload-artifact が「ファイル未存在」エラーにならない。
  const state = loadState();
  saveState(state);

  // [3] 現在 Epoch 取得
  const epoch = await getCurrentEpoch(
    config.rpcUrl,
    config.minterAddress,
    config.voterAddress
  );

  // [4] 前回 "submitted but unconfirmed" のペンディング tx を解決する
  if (state.pendingTxHash) {
    // pendingTxHash は string 型で保存されているため、0x プレフィックスを検証してから使う
    const isValidTxHash = /^0x[0-9a-fA-F]{64}$/.test(state.pendingTxHash);
    if (!isValidTxHash) {
      log(`WARN: pendingTxHash "${state.pendingTxHash}" is not a valid tx hash. Clearing.`);
      state.pendingTxHash = undefined;
      state.pendingEpochId = undefined;
      saveState(state);
    } else if (state.pendingEpochId === epoch.epochId) {
      // 同じ epoch — オンチェーンで確認する
      const pendingHash = state.pendingTxHash as `0x${string}`;
      log(`Found pending tx from previous run: ${pendingHash}. Checking on-chain status...`);

      const pendingStatus = await checkPendingTxStatus(config.rpcUrl, pendingHash);
      log(`Pending tx status: ${pendingStatus}`);

      if (pendingStatus === "confirmed") {
        // オンチェーンで確認済み → Bribe成功として扱う（再送信しない）
        log(`Pending tx confirmed on-chain. Treating as successful bribe for epoch #${epoch.epochId}.`);
        state.lastBribedEpoch = epoch.epochId;
        state.pendingTxHash = undefined;
        state.pendingEpochId = undefined;
        // 既存の history エントリを success に更新（あれば、末尾から検索）
        // 見つからない場合（SIGKILL等でhistory.pushが実行されなかったケース）は新規追加。
        let historyEntryFound = false;
        for (let i = state.history.length - 1; i >= 0; i--) {
          const e = state.history[i];
          if (e.epochId === epoch.epochId && e.txHash === pendingHash) {
            e.status = "success";
            historyEntryFound = true;
            break;
          }
        }
        if (!historyEntryFound) {
          log(`No history entry found for epoch #${epoch.epochId} / ${pendingHash}. Adding new entry.`);
          state.history.push({
            epochId: epoch.epochId,
            txHash: pendingHash,
            amount: config.bribeAmount.toString(),
            timestamp: new Date().toISOString(),
            status: "success",
            pool: "hzUSD-shzUSD",
          });
        }
        saveState(state);
        await notifyBribeSuccess(
          config.discordWebhookUrl,
          epoch,
          { success: true, txHash: pendingHash, retryCount: 0 },
          "hzUSD-shzUSD",
          config.bribeAmount
        );
        return;
      } else {
        // failed or not_found → ペンディングをクリアして通常フローに戻る（再試行安全）
        log(`Pending tx ${pendingStatus}. Clearing pending state and proceeding with new bribe attempt.`);
        state.pendingTxHash = undefined;
        state.pendingEpochId = undefined;
        saveState(state);
      }
    } else {
      // 旧 epoch の残留 pending — epoch が進んでいるので無条件クリア
      log(
        `Clearing stale pending tx from epoch #${state.pendingEpochId ?? "unknown"} ` +
          `(current epoch: #${epoch.epochId})`
      );
      state.pendingTxHash = undefined;
      state.pendingEpochId = undefined;
      saveState(state);
    }
  }

  // [5] 重複チェック
  if (state.lastBribedEpoch === epoch.epochId) {
    // Discord通知はしない。週7回のcronのうち6回はここに来るため、
    // 通知するとDiscordがスパムになる。ログだけ残す。
    log(`Already bribed for epoch #${epoch.epochId}. Skipping.`);
    return;
  }

  log(`New epoch detected: #${epoch.epochId} (was: #${state.lastBribedEpoch})`);

  // [6] DRY_RUN チェック
  if (config.dryRun) {
    log(`DRY_RUN: Would bribe ${formatEther(config.bribeAmount)} hzUSD for epoch #${epoch.epochId}`);
    await notifyDryRun(
      config.discordWebhookUrl,
      epoch,
      config.bribeAmount,
      "hzUSD-shzUSD"
    );
    return;
  }

  // [7] 残高チェック
  const account = privateKeyToAccount(config.privateKey);
  const balance = await getHzusdBalance(
    config.rpcUrl,
    config.hzusdAddress,
    account.address
  );
  log(`hzUSD balance: ${formatEther(balance)}`);

  if (balance < config.bribeAmount) {
    log(`ERROR: Insufficient hzUSD balance`);
    await notifyInsufficientBalance(
      config.discordWebhookUrl,
      balance,
      config.bribeAmount
    );
    process.exitCode = 1;
    return;
  }

  // 残高警告（4 epoch分未満）
  const lowBalanceThreshold = config.bribeAmount * LOW_BALANCE_EPOCHS;
  if (balance < lowBalanceThreshold) {
    log(`WARN: Low hzUSD balance (${formatEther(balance)}), sending warning...`);
    await notifyLowBalance(config.discordWebhookUrl, balance, config.bribeAmount);
  }

  // [8] Bribe 実行
  const target: BribeTarget = {
    name: "hzUSD-shzUSD",
    poolAddress: config.poolAddress,
    bribeContractAddress: config.bribeContractAddress,
    tokenAddress: config.hzusdAddress,
    amount: config.bribeAmount,
    enabled: true,
  };

  log("Executing bribe...");
  const result = await executeBribe(target, config.rpcUrl, config.privateKey, epoch.epochStart);

  // [9] State 更新 & 通知
  if (result.success) {
    // SIGKILL 回復ケース: 送信前チェックでオンチェーンに既にブライブを検出
    if (result.alreadyBribed) {
      log(`Bribe already on-chain for epoch #${epoch.epochId} (SIGKILL recovery). Updating state only.`);
      state.lastBribedEpoch = epoch.epochId;
      state.pendingTxHash = undefined;
      state.pendingEpochId = undefined;
      state.history.push({
        epochId: epoch.epochId,
        // txHash は不明（SIGKILL で state 保存前に終了したため）
        amount: config.bribeAmount.toString(),
        timestamp: new Date().toISOString(),
        status: "success",
        pool: target.name,
      });
      saveState(state);
      await notifyBribeSuccess(
        config.discordWebhookUrl,
        epoch,
        { success: true, retryCount: 0 },
        target.name,
        config.bribeAmount
      );
      return;
    }

    log(`Bribe SUCCESS: txHash=${result.txHash}, gasUsed=${result.gasUsed}`);

    state.lastBribedEpoch = epoch.epochId;
    state.pendingTxHash = undefined;
    state.pendingEpochId = undefined;
    state.history.push({
      epochId: epoch.epochId,
      txHash: result.txHash,
      amount: config.bribeAmount.toString(),
      timestamp: new Date().toISOString(),
      status: "success",
      pool: target.name,
      gasUsed: result.gasUsed?.toString(),
    });
    saveState(state);

    await notifyBribeSuccess(
      config.discordWebhookUrl,
      epoch,
      result,
      target.name,
      config.bribeAmount
    );
  } else {
    log(`Bribe FAILED: ${result.error}`);

    // receipt が未確認のまま txHash が取れている場合はペンディングとして保存。
    // 次回実行時にオンチェーンを確認し、確認済みなら再送しない。
    const isUnconfirmed = result.txHash != null;
    if (isUnconfirmed) {
      log(`Saving pending tx ${result.txHash} for epoch #${epoch.epochId} (will verify on next run)`);
      state.pendingTxHash = result.txHash;
      state.pendingEpochId = epoch.epochId;
    }

    state.history.push({
      epochId: epoch.epochId,
      txHash: result.txHash, // undefined if pre-submission failure; that's fine (field is optional)
      amount: config.bribeAmount.toString(),
      timestamp: new Date().toISOString(),
      status: "failed",
      pool: target.name,
    });
    saveState(state);

    await notifyBribeFailure(
      config.discordWebhookUrl,
      epoch,
      result.error ?? "Unknown error",
      result.retryCount,
      target.name
    );

    process.exitCode = 1;
  }

  log("=".repeat(60));
  log(`Done. exitCode=${process.exitCode ?? 0}`);
  log("=".repeat(60));
}

main().catch((err: unknown) => {
  console.error(`[${new Date().toISOString()}] [Main] FATAL: ${String(err)}`);
  process.exitCode = 1;
});
