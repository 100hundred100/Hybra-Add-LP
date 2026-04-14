// ============================================================
// Types — Hybra Auto-Bribe Bot
// ============================================================

/** Bribe対象プール（将来の複数プール対応用） */
export interface BribeTarget {
  name: string;
  poolAddress: `0x${string}`;
  bribeContractAddress: `0x${string}`;
  tokenAddress: `0x${string}`;
  amount: bigint; // wei
  enabled: boolean;
}

/** Epoch情報 */
export interface EpochInfo {
  epochId: number; // epoch番号 = Math.floor(epochStart / EPOCH_DURATION)
  epochStart: number; // unix timestamp (seconds)
  epochEnd: number; // unix timestamp (seconds)
  secondsSinceStart: number;
}

/** Bribe実行結果 */
export interface BribeResult {
  success: boolean;
  txHash?: `0x${string}`;
  gasUsed?: bigint;
  error?: string;
  retryCount: number;
  /**
   * true のとき: 送信前の tokenRewardsPerEpoch チェックで既にオンチェーンにブライブが存在した。
   * SIGKILL 後の回復ケース。state.lastBribedEpoch を更新して通知するが txHash は不明。
   */
  alreadyBribed?: boolean;
}

/** 実行履歴エントリ */
export interface BribeHistoryEntry {
  epochId: number;
  txHash?: string; // optional: not available for pre-submission failures
  amount: string; // wei as string (for JSON serialization)
  timestamp: string; // ISO 8601
  status: "success" | "failed";
  pool: string;
  gasUsed?: string;
}

/** 永続化状態 (state.json) */
export interface BribeState {
  lastBribedEpoch: number;
  history: BribeHistoryEntry[];
  /**
   * ダブルブライブ防止:
   * notifyRewardAmount の txHash を取得したが receipt が未確認の場合に保存。
   * 次回実行時にオンチェーンで確認し、確認済みなら lastBribedEpoch を更新して再送しない。
   */
  pendingTxHash?: string;
  pendingEpochId?: number;
}

/** Discord通知ペイロード */
export interface NotificationPayload {
  type: "success" | "failure" | "warning" | "info";
  title: string;
  fields: Array<{ name: string; value: string; inline?: boolean }>;
  color?: number;
}
