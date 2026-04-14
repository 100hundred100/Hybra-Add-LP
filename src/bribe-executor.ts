// ============================================================
// BribeExecutor — approve + notifyRewardAmount の実行
// ============================================================

import {
  createPublicClient,
  createWalletClient,
  http,
  formatEther,
  type Hash,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { HARD_MAX_BRIBE_WEI, RPC_CALL_TIMEOUT_MS } from "./config.js";
import { hyperEvm } from "./chains.js";
import type { BribeResult, BribeTarget } from "./types.js";

import ERC20ABI from "./abi/ERC20.json" with { type: "json" };
import BribeContractABI from "./abi/BribeContract.json" with { type: "json" };

// receipt確認のタイムアウト (60秒)
const RECEIPT_TIMEOUT_MS = 60_000;

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] [BribeExecutor] ${msg}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Bribeを実行する
 *
 * 安全チェック → 残高チェック → approve (必要なら) → notifyRewardAmount
 *
 * 【ダブルブライブ防止設計】
 *   notifyRewardAmount のリトライは「tx送信前」の失敗のみ対象。
 *   一度 txHash を取得したあとは receipt タイムアウトしても再送信しない。
 *   これにより 1epoch に 2回ブライブされる事故を防ぐ。
 */
export async function executeBribe(
  target: BribeTarget,
  rpcUrl: string,
  privateKey: `0x${string}`,
  epochStart: number,
  maxRetryCount: number = 3
): Promise<BribeResult> {
  // ── 安全チェック ──────────────────────────────────────────
  if (!target.enabled) {
    // 将来の複数プール対応: enabled=false のターゲットはスキップ
    return {
      success: false,
      error: `Bribe target "${target.name}" is disabled`,
      retryCount: 0,
    };
  }

  if (target.amount > HARD_MAX_BRIBE_WEI) {
    throw new Error(
      `SECURITY HALT: Bribe amount ${formatEther(target.amount)} exceeds hard cap of 10 hzUSD`
    );
  }

  const account = privateKeyToAccount(privateKey);
  const walletAddress = account.address;

  const publicClient = createPublicClient({
    chain: hyperEvm,
    transport: http(rpcUrl, { timeout: RPC_CALL_TIMEOUT_MS }),
  });
  const walletClient = createWalletClient({
    account,
    chain: hyperEvm,
    transport: http(rpcUrl, { timeout: RPC_CALL_TIMEOUT_MS }),
  });

  log(`Wallet: ${walletAddress}`);
  log(`Target: ${target.name}, amount: ${formatEther(target.amount)} hzUSD`);
  log(`BribeContract: ${target.bribeContractAddress}`);

  // ── 残高チェック ───────────────────────────────────────────
  const balance = (await publicClient.readContract({
    address: target.tokenAddress,
    abi: ERC20ABI,
    functionName: "balanceOf",
    args: [walletAddress],
  })) as bigint;

  log(`hzUSD balance: ${formatEther(balance)}`);

  if (balance < target.amount) {
    return {
      success: false,
      error: `Insufficient hzUSD balance: have ${formatEther(balance)}, need ${formatEther(target.amount)}`,
      retryCount: 0,
    };
  }

  // ── Approve ────────────────────────────────────────────────
  const allowance = (await publicClient.readContract({
    address: target.tokenAddress,
    abi: ERC20ABI,
    functionName: "allowance",
    args: [walletAddress, target.bribeContractAddress],
  })) as bigint;

  log(`Current allowance: ${formatEther(allowance)}`);

  if (allowance < target.amount) {
    log(`Approving ${formatEther(target.amount)} hzUSD to bribe contract (exact amount)...`);

    const approveResult = await executeApprove(
      publicClient,
      walletClient,
      target,
      walletAddress,
      maxRetryCount
    );

    if (!approveResult.success) {
      return approveResult;
    }
  } else {
    log("Sufficient allowance already set, skipping approve.");
  }

  // ── notifyRewardAmount ─────────────────────────────────────
  return executeNotifyRewardAmount(
    publicClient,
    walletClient,
    target,
    walletAddress,
    epochStart,
    maxRetryCount
  );
}

/**
 * ERC20 approve を実行する。
 *
 * tx送信とreceipt確認を1つの関数にまとめてリトライする。
 * txHash取得後にreceipt確認が失敗した場合は再送信せず失敗扱いとする
 * （allowanceが設定済みなら次回は省略される）。
 */
async function executeApprove(
  publicClient: ReturnType<typeof createPublicClient>,
  walletClient: ReturnType<typeof createWalletClient>,
  target: BribeTarget,
  walletAddress: `0x${string}`,
  maxRetryCount: number
): Promise<BribeResult> {
  let lastError = "";

  for (let attempt = 1; attempt <= maxRetryCount; attempt++) {
    let submittedTxHash: Hash | null = null;

    try {
      // gas 推定
      const gasEstimate = await publicClient.estimateContractGas({
        address: target.tokenAddress,
        abi: ERC20ABI,
        functionName: "approve",
        args: [target.bribeContractAddress, target.amount],
        account: walletAddress,
      });
      const gasLimit = (gasEstimate * 120n) / 100n;

      // tx 送信
      // account には walletClient 構築時に渡した LocalAccount オブジェクトを使用する。
      // walletAddress（Address 文字列）を渡すと viem の parseAccount() が
      // { type: 'json-rpc' } に変換し、ローカル署名をスキップして
      // eth_sendTransaction をパブリック RPC に呼び出すため失敗する。
      submittedTxHash = await walletClient.writeContract({
        address: target.tokenAddress,
        abi: ERC20ABI,
        functionName: "approve",
        args: [target.bribeContractAddress, target.amount],
        gas: gasLimit,
        chain: hyperEvm,
        account: walletClient.account!,
      }) as Hash;

      log(`Approve tx submitted (attempt ${attempt}): ${submittedTxHash}`);

      // receipt 確認 — txHash取得後はタイムアウトしても再送信しない
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: submittedTxHash,
        confirmations: 1,
        timeout: RECEIPT_TIMEOUT_MS,
      });

      if (receipt.status !== "success") {
        // revert は確定的失敗（blacklist、contract一時停止など）。
        // notifyRewardAmount と同様、同じ引数でリトライしても再度revertするだけなので即座に中断。
        log(`Approve reverted (deterministic). Hash: ${submittedTxHash}`);
        return {
          success: false,
          error: `Approve reverted. Hash: ${submittedTxHash}. ` +
            `Check if token is transferable and wallet is not blacklisted.`,
          retryCount: attempt - 1,
        };
      }

      log(`Approve confirmed: ${submittedTxHash}`);
      return { success: true, txHash: submittedTxHash, retryCount: attempt - 1 };

    } catch (err) {
      lastError = String(err);

      if (submittedTxHash) {
        // txHash取得済み → receipt確認失敗。再送信はしない（nonce衝突リスク）
        log(`Approve tx ${submittedTxHash} submitted but receipt not confirmed: ${lastError}`);
        return {
          success: false,
          error: `Approve submitted (${submittedTxHash}) but receipt unconfirmed: ${lastError}`,
          retryCount: attempt - 1,
        };
      }

      // tx送信前のエラー → リトライ可能
      log(`Approve attempt ${attempt}/${maxRetryCount} failed (pre-submission): ${lastError}`);
      if (attempt < maxRetryCount) await sleep(Math.pow(2, attempt) * 1000);
    }
  }

  return {
    success: false,
    error: `Approve failed after ${maxRetryCount} attempts: ${lastError}`,
    retryCount: maxRetryCount - 1, // 3回試行 = 2回リトライ (0-indexed)
  };
}

/**
 * bribe.notifyRewardAmount を実行する。
 *
 * 【ダブルブライブ防止 — 2層構造】
 *   Layer 1: txHash 取得後に receipt 確認が失敗した場合は再送信しない。
 *            → 次回 run で pendingTxHash を on-chain 確認して解決。
 *   Layer 2: 送信前に tokenRewardsPerEpoch を確認する。
 *            → SIGKILL 等で state 保存前に終了した場合でも二重送信を防止。
 */
async function executeNotifyRewardAmount(
  publicClient: ReturnType<typeof createPublicClient>,
  walletClient: ReturnType<typeof createWalletClient>,
  target: BribeTarget,
  walletAddress: `0x${string}`,
  epochStart: number,
  maxRetryCount: number
): Promise<BribeResult> {
  log(`Submitting bribe: notifyRewardAmount(${target.tokenAddress}, ${formatEther(target.amount)} hzUSD)...`);

  // ── 送信前二重ブライブチェック ─────────────────────────────
  // SIGKILL 等で state.pendingTxHash が保存されなかった場合でも、
  // オンチェーンに既にブライブが存在すれば再送信しない。
  // チェック失敗（RPC障害など）は警告を出し、送信処理に進む（ブロックしない）。
  try {
    const existingBribe = (await publicClient.readContract({
      address: target.bribeContractAddress,
      abi: BribeContractABI,
      functionName: "tokenRewardsPerEpoch",
      args: [target.tokenAddress, BigInt(epochStart)],
    })) as bigint;
    if (existingBribe > 0n) {
      log(
        `Pre-submission check: tokenRewardsPerEpoch = ${formatEther(existingBribe)} hzUSD ` +
          `for epoch ${epochStart}. Bribe already on-chain — skipping (SIGKILL recovery).`
      );
      return { success: true, alreadyBribed: true, retryCount: 0 };
    }
    log(`Pre-submission check: no existing bribe for epoch ${epochStart}. Proceeding.`);
  } catch (checkErr) {
    log(`WARN: tokenRewardsPerEpoch pre-check failed (${String(checkErr)}). Proceeding with submission.`);
  }

  let lastError = "";

  for (let attempt = 1; attempt <= maxRetryCount; attempt++) {
    let submittedTxHash: Hash | null = null;

    try {
      // gas 推定
      const gasEstimate = await publicClient.estimateContractGas({
        address: target.bribeContractAddress,
        abi: BribeContractABI,
        functionName: "notifyRewardAmount",
        args: [target.tokenAddress, target.amount],
        account: walletAddress,
      });
      const gasLimit = (gasEstimate * 120n) / 100n;
      log(`Gas estimate: ${gasEstimate}, gas limit (with buffer): ${gasLimit}`);

      // tx 送信
      // account は walletClient 構築時に設定した LocalAccount オブジェクトを使用する（approve と同理由）。
      submittedTxHash = await walletClient.writeContract({
        address: target.bribeContractAddress,
        abi: BribeContractABI,
        functionName: "notifyRewardAmount",
        args: [target.tokenAddress, target.amount],
        gas: gasLimit,
        chain: hyperEvm,
        account: walletClient.account!,
      }) as Hash;

      log(`Bribe tx submitted (attempt ${attempt}): ${submittedTxHash}`);

      // receipt 確認 — txHash取得後はタイムアウトしても再送信しない
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: submittedTxHash,
        confirmations: 1,
        timeout: RECEIPT_TIMEOUT_MS,
      });

      if (receipt.status !== "success") {
        // revert は確定的失敗（token未whitelist、contract一時停止など）。
        // 同じ引数でリトライしても再度revertするだけなので即座に中断する。
        log(`notifyRewardAmount reverted (deterministic). Hash: ${submittedTxHash}`);
        return {
          success: false,
          error: `notifyRewardAmount reverted. Hash: ${submittedTxHash}. ` +
            `Check token whitelist status and bribe contract state.`,
          retryCount: attempt - 1,
        };
      }

      log(`Bribe confirmed! txHash: ${submittedTxHash}, gasUsed: ${receipt.gasUsed}`);
      return {
        success: true,
        txHash: submittedTxHash,
        gasUsed: receipt.gasUsed,
        retryCount: attempt - 1,
      };

    } catch (err) {
      lastError = String(err);

      if (submittedTxHash) {
        // ★ ダブルブライブ防止: txHash取得後は絶対に再送信しない
        log(
          `WARN: Bribe tx ${submittedTxHash} was submitted but receipt unconfirmed. ` +
            `NOT retrying to prevent double-bribe. Error: ${lastError}`
        );
        return {
          success: false,
          // txHash を返すことで呼び出し元が pendingTxHash として保存できる
          txHash: submittedTxHash,
          error:
            `Bribe tx submitted (${submittedTxHash}) but receipt unconfirmed. ` +
            `Check on-chain before next run. Error: ${lastError}`,
          retryCount: attempt - 1,
        };
      }

      // tx送信前のエラー → リトライ可能
      log(`Attempt ${attempt}/${maxRetryCount} failed (pre-submission): ${lastError}`);
      if (attempt < maxRetryCount) {
        const delay = Math.pow(2, attempt) * 1000;
        log(`Retrying in ${delay}ms...`);
        await sleep(delay);
      }
    }
  }

  return {
    success: false,
    error: `notifyRewardAmount failed after ${maxRetryCount} attempts: ${lastError}`,
    retryCount: maxRetryCount - 1, // 3回試行 = 2回リトライ (0-indexed)
  };
}

/**
 * ウォレットのhzUSD残高を取得する（通知・警告用）
 */
export async function getHzusdBalance(
  rpcUrl: string,
  tokenAddress: `0x${string}`,
  walletAddress: `0x${string}`
): Promise<bigint> {
  const client = createPublicClient({ chain: hyperEvm, transport: http(rpcUrl, { timeout: RPC_CALL_TIMEOUT_MS }) });
  return (await client.readContract({
    address: tokenAddress,
    abi: ERC20ABI,
    functionName: "balanceOf",
    args: [walletAddress],
  })) as bigint;
}
