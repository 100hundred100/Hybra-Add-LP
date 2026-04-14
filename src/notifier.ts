// ============================================================
// Notifier — Discord Webhook 通知
// ============================================================

import { formatEther } from "viem";
import type { BribeResult, EpochInfo, NotificationPayload } from "./types.js";

const HYPERSCAN_TX_BASE = "https://hyperscan.xyz/tx";

// Discord embed colors
const COLOR = {
  SUCCESS: 0x00ff00, // Green
  FAILURE: 0xff0000, // Red
  WARNING: 0xffff00, // Yellow
  INFO: 0x00bfff, // Blue
} as const;

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] [Notifier] ${msg}`);
}

/**
 * Discord Webhook に embed メッセージを送信する
 */
export async function notify(
  webhookUrl: string,
  payload: NotificationPayload
): Promise<void> {
  const body = {
    embeds: [
      {
        title: payload.title,
        color: payload.color ?? COLOR.INFO,
        fields: payload.fields,
        timestamp: new Date().toISOString(),
        footer: { text: "Hybra Auto-Bribe Bot" },
      },
    ],
  };

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000), // 10秒タイムアウト
    });

    if (!res.ok) {
      let errorBody = "(could not read response body)";
      try {
        errorBody = await res.text();
      } catch {
        // res.text() 自体が失敗してもステータスコードはログに残す
      }
      log(`Discord webhook error ${res.status}: ${errorBody}`);
    } else {
      log("Discord notification sent.");
    }
  } catch (err) {
    // 通知失敗でメインフローを止めない
    log(`Discord notification failed (non-fatal): ${String(err)}`);
  }
}

/**
 * Bribe成功通知
 */
export async function notifyBribeSuccess(
  webhookUrl: string,
  epoch: EpochInfo,
  result: BribeResult,
  poolName: string,
  bribeAmount: bigint
): Promise<void> {
  const txUrl = result.txHash
    ? `[${result.txHash.slice(0, 10)}...](${HYPERSCAN_TX_BASE}/${result.txHash})`
    : "N/A";

  await notify(webhookUrl, {
    type: "success",
    title: `✅ Bribe Submitted — Epoch #${epoch.epochId}`,
    color: COLOR.SUCCESS,
    fields: [
      { name: "Pool", value: poolName, inline: true },
      { name: "Amount", value: `${formatEther(bribeAmount)} hzUSD`, inline: true },
      { name: "Tx Hash", value: txUrl, inline: false },
      {
        name: "Gas Used",
        value: result.gasUsed ? result.gasUsed.toLocaleString() : "N/A",
        inline: true,
      },
      { name: "Retries", value: String(result.retryCount), inline: true },
      {
        name: "Epoch Start",
        value: new Date(epoch.epochStart * 1000).toISOString(),
        inline: false,
      },
    ],
  });
}

/**
 * Bribe失敗通知
 */
export async function notifyBribeFailure(
  webhookUrl: string,
  epoch: EpochInfo,
  error: string,
  retryCount: number,
  poolName: string
): Promise<void> {
  await notify(webhookUrl, {
    type: "failure",
    title: `❌ Bribe Failed — Epoch #${epoch.epochId}`,
    color: COLOR.FAILURE,
    fields: [
      { name: "Pool", value: poolName, inline: true },
      { name: "Error", value: error.slice(0, 1000), inline: false },
      { name: "Retries", value: `${retryCount} exhausted`, inline: true },
      { name: "Action Required", value: "Check wallet balance, RPC, and bribe contract", inline: false },
    ],
  });
}

/**
 * hzUSD残高不足通知
 */
export async function notifyInsufficientBalance(
  webhookUrl: string,
  balance: bigint,
  required: bigint
): Promise<void> {
  await notify(webhookUrl, {
    type: "failure",
    title: "❌ Insufficient hzUSD Balance",
    color: COLOR.FAILURE,
    fields: [
      { name: "Balance", value: `${formatEther(balance)} hzUSD`, inline: true },
      { name: "Required", value: `${formatEther(required)} hzUSD`, inline: true },
      { name: "Action Required", value: "Top up bribe wallet with hzUSD", inline: false },
    ],
  });
}

/**
 * 残高警告通知（残り ~4 epoch分以下）
 */
export async function notifyLowBalance(
  webhookUrl: string,
  balance: bigint,
  bribeAmount: bigint
): Promise<void> {
  // 今回のbribe分を差し引いた「今後実行できる残りepoch数」を表示する。
  // balance / bribeAmount だと今回分も含むため off-by-one になる。
  const remainingEpochs = bribeAmount > 0n ? (balance - bribeAmount) / bribeAmount : 0n;

  await notify(webhookUrl, {
    type: "warning",
    title: "⚠️ Low hzUSD Balance",
    color: COLOR.WARNING,
    fields: [
      { name: "Balance", value: `${formatEther(balance)} hzUSD`, inline: true },
      { name: "Epochs After This One", value: `~${remainingEpochs}`, inline: true },
      { name: "Action", value: "Replenish bribe wallet before next epoch", inline: false },
    ],
  });
}

/**
 * DRY_RUN実行通知
 */
export async function notifyDryRun(
  webhookUrl: string,
  epoch: EpochInfo,
  bribeAmount: bigint,
  poolName: string
): Promise<void> {
  await notify(webhookUrl, {
    type: "info",
    title: `🔵 DRY_RUN — Epoch #${epoch.epochId}`,
    color: COLOR.INFO,
    fields: [
      { name: "Pool", value: poolName, inline: true },
      { name: "Would Bribe", value: `${formatEther(bribeAmount)} hzUSD`, inline: true },
      { name: "Mode", value: "DRY_RUN (no transaction sent)", inline: false },
    ],
  });
}
