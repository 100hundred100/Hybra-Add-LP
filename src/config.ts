// ============================================================
// Config — 環境変数の読み込みとバリデーション
// ============================================================

import "dotenv/config";
import { getAddress, isAddress, parseEther } from "viem";

// ハードコード定数（.envで上書き不可）
export const HARD_MAX_BRIBE_WEI = parseEther("10"); // 絶対上限: 10 hzUSD
export const EPOCH_DURATION = 604800; // 7日 (秒)
export const LOW_BALANCE_EPOCHS = 4n; // 残高がこのepoch分未満で警告
/**
 * 個別 RPC 呼び出しのタイムアウト (30秒)
 *
 * viem の http() transport はデフォルトでタイムアウトを設定しない。
 * Node.js の fetch も同様にデフォルトタイムアウトなしのため、
 * RPC ノードが無応答の場合にハングする。
 * readContract / estimateContractGas / getTransactionReceipt など全呼び出しに適用する。
 * waitForTransactionReceipt は別途 RECEIPT_TIMEOUT_MS を使用する。
 */
export const RPC_CALL_TIMEOUT_MS = 30_000;

export interface Config {
  // RPC
  rpcUrl: string;
  // Wallet
  privateKey: `0x${string}`;
  // Contract Addresses (checksummed)
  hzusdAddress: `0x${string}`;
  poolAddress: `0x${string}`;
  bribeContractAddress: `0x${string}`;
  voterAddress: `0x${string}`;
  minterAddress: `0x${string}`;
  // Bribe Parameters
  bribeAmount: bigint; // wei
  // Notifications
  discordWebhookUrl: string;
  // Mode
  dryRun: boolean;
}

class ConfigError extends Error {
  constructor(message: string) {
    super(`[ConfigError] ${message}`);
    this.name = "ConfigError";
  }
}

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value || value.trim() === "") {
    throw new ConfigError(`Missing required environment variable: ${key}`);
  }
  return value.trim();
}

function validateAddress(raw: string, label: string): `0x${string}` {
  if (!isAddress(raw)) {
    throw new ConfigError(`Invalid address for ${label}: "${raw}"`);
  }
  return getAddress(raw);
}

function validatePrivateKey(raw: string): `0x${string}` {
  const key = raw.startsWith("0x") ? raw : `0x${raw}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new ConfigError(
      "PRIVATE_KEY must be a 32-byte hex string (64 hex chars, optionally prefixed with 0x)"
    );
  }
  return key as `0x${string}`;
}

export function loadConfig(): Config {
  // RPC
  const rpcUrl = requireEnv("RPC_URL");
  if (!rpcUrl.startsWith("http://") && !rpcUrl.startsWith("https://")) {
    throw new ConfigError(`RPC_URL must start with http:// or https://, got: "${rpcUrl}"`);
  }

  // Wallet
  const privateKey = validatePrivateKey(requireEnv("PRIVATE_KEY"));

  // Addresses
  const hzusdAddress = validateAddress(requireEnv("HZUSD_ADDRESS"), "HZUSD_ADDRESS");
  const poolAddress = validateAddress(requireEnv("POOL_ADDRESS"), "POOL_ADDRESS");
  const voterAddress = validateAddress(requireEnv("VOTER_ADDRESS"), "VOTER_ADDRESS");
  const minterAddress = validateAddress(requireEnv("MINTER_ADDRESS"), "MINTER_ADDRESS");
  const bribeContractAddress = validateAddress(
    requireEnv("BRIBE_CONTRACT_ADDRESS"),
    "BRIBE_CONTRACT_ADDRESS"
  );

  // Bribe Amount
  const bribeAmountStr = requireEnv("BRIBE_AMOUNT");
  // Number() は "5abc" → NaN を返すため parseFloat より厳格。
  // parseFloat("5abc") = 5 を通過させてしまうバグを防ぐ。
  const bribeAmountNum = Number(bribeAmountStr);
  if (!isFinite(bribeAmountNum) || bribeAmountNum <= 0) {
    throw new ConfigError(
      `BRIBE_AMOUNT must be a positive finite number, got: "${bribeAmountStr}"`
    );
  }
  // Number で正規化した値を文字列に変換してparseEtherに渡す。
  // 科学記数法("1e2"等)や余分なゼロ("05"等)による parseEther の誤動作を防ぐ。
  const normalizedAmountStr = String(bribeAmountNum);
  // parseEther は科学記数法（"1e-7", "1e+21" 等）を処理できず BaseError を投げる。
  // JavaScript は以下の範囲で String() が科学記数法を使用する:
  //   - 極小値: bribeAmountNum < 1e-6  → "1e-7" 等
  //   - 極大値: bribeAmountNum >= 1e21 → "1e+21" 等
  // いずれも bribe として非現実的な値なので、事前に明瞭なエラーで拒否する。
  if (/e/i.test(normalizedAmountStr)) {
    throw new ConfigError(
      `BRIBE_AMOUNT "${bribeAmountStr}" is out of acceptable range ` +
        `(too small or too large). Use a plain decimal value such as "5".`
    );
  }
  const bribeAmount = parseEther(normalizedAmountStr as `${number}`);
  if (bribeAmount > HARD_MAX_BRIBE_WEI) {
    throw new ConfigError(
      `SECURITY: BRIBE_AMOUNT (${bribeAmountStr} hzUSD) exceeds hard cap of 10 hzUSD`
    );
  }

  // Discord
  // discord.com, discordapp.com(旧URL), ptb.discord.com, canary.discord.com すべて許可
  const discordWebhookUrl = requireEnv("DISCORD_WEBHOOK_URL");
  if (!/^https:\/\/((?:ptb\.|canary\.)?discord(?:app)?\.com)\/api\/webhooks\//.test(discordWebhookUrl)) {
    throw new ConfigError(
      `DISCORD_WEBHOOK_URL must be a valid Discord webhook URL ` +
        `(discord.com, discordapp.com, ptb.discord.com, or canary.discord.com)`
    );
  }

  // Mode
  const dryRun = process.env["DRY_RUN"]?.toLowerCase() === "true";

  return {
    rpcUrl,
    privateKey,
    hzusdAddress,
    poolAddress,
    bribeContractAddress,
    voterAddress,
    minterAddress,
    bribeAmount,
    discordWebhookUrl,
    dryRun,
  };
}
