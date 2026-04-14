// ============================================================
// EpochMonitor — Hybra epochタイミングのオンチェーン取得
// ============================================================

import { createPublicClient, http, type PublicClient } from "viem";
import { EPOCH_DURATION, RPC_CALL_TIMEOUT_MS } from "./config.js";
import { hyperEvm } from "./chains.js";
import type { EpochInfo } from "./types.js";

import MinterABI from "./abi/Minter.json" with { type: "json" };
import VoterV3ABI from "./abi/VoterV3.json" with { type: "json" };

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] [EpochMonitor] ${msg}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Minter.active_period() が返す epochStart を「現在時刻から見た正しい epoch start」に補正する。
 *
 * 【背景】
 * ve(3,3) の Minter は update_period() が呼ばれるまで active_period を更新しない。
 * epoch 境界直後に update_period が未コールの状態でbotが起動すると、
 * active_period は 1epoch 前のタイムスタンプを返す。
 * そのまま epochId を計算すると「前 epoch に bribe 済み」と誤判定し、
 * 今 epoch の bribe が永久にスキップされる。
 *
 * 【修正】
 * active_period が示す epoch の終了時刻 (epochStart + EPOCH_DURATION) を
 * 現在時刻と比較し、過ぎていれば EPOCH_DURATION を加算し続けて補正する。
 * 複数 epoch 分 stale な場合も while ループで正しく補正できる。
 */
export function advanceToCurrentEpoch(minterEpochStart: number, nowSec: number): number {
  let epochStart = minterEpochStart;
  if (nowSec < epochStart + EPOCH_DURATION) {
    // stale なし — そのまま返す
    return epochStart;
  }

  // stale あり: ループ前後に1回ずつだけログを出す（毎反復ログ = スパム防止）
  const originalStart = epochStart;
  while (nowSec >= epochStart + EPOCH_DURATION) {
    epochStart += EPOCH_DURATION;
  }
  const weeksAdvanced = Math.round((epochStart - originalStart) / EPOCH_DURATION);
  log(
    `WARN: Minter.active_period() was stale by ${weeksAdvanced} week(s). ` +
      `Corrected epoch start: ${new Date(epochStart * 1000).toISOString()}`
  );
  return epochStart;
}

/**
 * Minter.active_period() → 現在のepoch開始タイムスタンプを取得する。
 * フォールバック: VoterV3.activePeriod()
 */
async function fetchEpochStart(
  client: PublicClient,
  minterAddress: `0x${string}`,
  voterAddress: `0x${string}`
): Promise<number> {
  // 試行1: Minter.active_period()
  try {
    const result = await client.readContract({
      address: minterAddress,
      abi: MinterABI,
      functionName: "active_period",
    });
    const ts = Number(result as bigint);
    if (ts > 0) {
      log(`Epoch start from Minter.active_period(): ${ts}`);
      return ts;
    }
  } catch (_) {
    log("Minter.active_period() failed, trying fallback...");
  }

  // 試行2: Minter.activePeriod()
  try {
    const result = await client.readContract({
      address: minterAddress,
      abi: MinterABI,
      functionName: "activePeriod",
    });
    const ts = Number(result as bigint);
    if (ts > 0) {
      log(`Epoch start from Minter.activePeriod(): ${ts}`);
      return ts;
    }
  } catch (_) {
    log("Minter.activePeriod() failed, trying VoterV3...");
  }

  // 試行3: VoterV3.activePeriod()
  try {
    const result = await client.readContract({
      address: voterAddress,
      abi: VoterV3ABI,
      functionName: "activePeriod",
    });
    const ts = Number(result as bigint);
    if (ts > 0) {
      log(`Epoch start from VoterV3.activePeriod(): ${ts}`);
      return ts;
    }
  } catch (_) {
    log("VoterV3.activePeriod() failed");
  }

  throw new Error(
    "Unable to fetch epoch start timestamp from Minter or VoterV3. " +
      "Check contract addresses and ABIs."
  );
}

/** epoch番号を算出 (epochStart は seconds) */
export function getEpochId(epochStart: number): number {
  return Math.floor(epochStart / EPOCH_DURATION);
}

/**
 * 現在のEpoch情報を取得する (最大3回リトライ)
 */
export async function getCurrentEpoch(
  rpcUrl: string,
  minterAddress: `0x${string}`,
  voterAddress: `0x${string}`
): Promise<EpochInfo> {
  const client = createPublicClient({ chain: hyperEvm, transport: http(rpcUrl, { timeout: RPC_CALL_TIMEOUT_MS }) });

  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const rawEpochStart = await fetchEpochStart(client, minterAddress, voterAddress);
      const now = Math.floor(Date.now() / 1000);
      // Minterが未更新の場合に epochStart が stale になる問題を補正する
      const epochStart = advanceToCurrentEpoch(rawEpochStart, now);
      const epochEnd = epochStart + EPOCH_DURATION;
      const epochId = getEpochId(epochStart);
      const secondsSinceStart = now - epochStart;

      log(
        `Epoch #${epochId}: start=${new Date(epochStart * 1000).toISOString()}, ` +
          `end=${new Date(epochEnd * 1000).toISOString()}, ` +
          `elapsed=${secondsSinceStart}s`
      );

      return { epochId, epochStart, epochEnd, secondsSinceStart };
    } catch (err) {
      lastError = err;
      if (attempt < 3) {
        const delay = Math.pow(2, attempt) * 1000;
        log(`Attempt ${attempt}/3 failed. Retrying in ${delay}ms...`);
        await sleep(delay);
      }
    }
  }

  throw new Error(`Failed to get current epoch after 3 attempts: ${String(lastError)}`);
}
