// ============================================================
// chains.ts — HyperEVM カスタムチェーン定義
//
// HyperEVM Mainnet: Chain ID 999
// RPC: https://rpc.hyperliquid.xyz/evm
//
// NOTE: explore-contracts.ts の getChainId() でチェーンIDを確認できる。
//       異なる場合は HYPEREVM_CHAIN_ID を修正すること。
// ============================================================

import { defineChain } from "viem";

export const HYPEREVM_CHAIN_ID = 999;

export const hyperEvm = defineChain({
  id: HYPEREVM_CHAIN_ID,
  name: "HyperEVM",
  nativeCurrency: {
    decimals: 18,
    name: "HYPE",
    symbol: "HYPE",
  },
  rpcUrls: {
    default: {
      http: ["https://rpc.hyperliquid.xyz/evm"],
    },
  },
  blockExplorers: {
    default: {
      name: "HyperScan",
      url: "https://hyperscan.xyz",
    },
  },
});
