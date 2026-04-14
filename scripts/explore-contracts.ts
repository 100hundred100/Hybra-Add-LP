// ============================================================
// explore-contracts.ts — Phase 0: Hybra コントラクト調査
//
// 実行: npx tsx scripts/explore-contracts.ts
//
// 目的:
//   - VoterV3から gauge / bribe コントラクトアドレスを取得
//   - Minter から epoch タイミングを確認
//   - hzUSD の whitelist 確認
//   - bribe 関数シグネチャの確認
// ============================================================

import "dotenv/config";
import { createPublicClient, http, formatEther, toFunctionSelector } from "viem";
import { hyperEvm, HYPEREVM_CHAIN_ID } from "../src/chains.js";
import { EPOCH_DURATION } from "../src/config.js";
import { advanceToCurrentEpoch } from "../src/epoch-monitor.js";

import VoterV3ABI from "../src/abi/VoterV3.json" with { type: "json" };
import MinterABI from "../src/abi/Minter.json" with { type: "json" };
import BribeContractABI from "../src/abi/BribeContract.json" with { type: "json" };
import ERC20ABI from "../src/abi/ERC20.json" with { type: "json" };

// ── アドレス定数 ──────────────────────────────────────────
const ADDRESSES = {
  VOTER_V3: "0x5623F012d15EB828C12fe32e46d40AdC2A9e4FA3" as `0x${string}`,
  MINTER: "0xA8265e40e4Cdf6DB345861F4FCb75F9CC63E149b" as `0x${string}`,
  POOL: "0x2084B52E234211399b5f691dEc1edB69ec6Bc721" as `0x${string}`,
  HZUSD: "0x6E2ade6FFc94d24A81406285c179227dfBFc97CE" as `0x${string}`,
  SHZUSD: "0xce01a9B9bc08f0847fb745044330Eff1181360Cd" as `0x${string}`,
};

const RPC_URL = process.env["RPC_URL"] ?? "https://rpc.hyperliquid.xyz/evm";

function sep(title: string): void {
  console.log("\n" + "─".repeat(60));
  console.log(`  ${title}`);
  console.log("─".repeat(60));
}

function ok(label: string, value: unknown): void {
  console.log(`  ✅ ${label}: ${String(value)}`);
}

function warn(label: string, value: unknown): void {
  console.log(`  ⚠️  ${label}: ${String(value)}`);
}

function fail(label: string, err: unknown): void {
  console.log(`  ❌ ${label}: ${String(err)}`);
}

async function tryRead<T>(
  client: ReturnType<typeof createPublicClient>,
  address: `0x${string}`,
  abi: unknown[],
  functionName: string,
  args: unknown[] = []
): Promise<T | null> {
  try {
    const result = await client.readContract({
      address,
      abi,
      functionName,
      args,
    } as Parameters<typeof client.readContract>[0]);
    return result as T;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  console.log("═".repeat(60));
  console.log("  Hybra Contract Explorer — Phase 0");
  console.log(`  RPC: ${RPC_URL}`);
  console.log("═".repeat(60));

  const client = createPublicClient({ chain: hyperEvm, transport: http(RPC_URL) });

  // ── 1. Chain 確認 ─────────────────────────────────────────
  sep("1. Chain Info");
  try {
    const chainId = await client.getChainId();
    const blockNumber = await client.getBlockNumber();
    ok("Chain ID (on-chain)", chainId);
    ok("Chain ID (expected)", HYPEREVM_CHAIN_ID);
    if (Number(chainId) !== HYPEREVM_CHAIN_ID) {
      warn(
        "Chain ID MISMATCH",
        `On-chain=${chainId} vs src/chains.ts=${HYPEREVM_CHAIN_ID}. ` +
          "Update HYPEREVM_CHAIN_ID in src/chains.ts!"
      );
    }
    ok("Block number", blockNumber);
  } catch (err) {
    fail("Chain connection", err);
    console.error("Cannot connect to RPC. Aborting.");
    process.exit(1);
  }

  // ── 2. hzUSD Token ────────────────────────────────────────
  sep("2. hzUSD Token Info");
  const hzusdDecimals = await tryRead<number>(client, ADDRESSES.HZUSD, ERC20ABI, "decimals");
  const hzusdSymbol = await tryRead<string>(client, ADDRESSES.HZUSD, ERC20ABI, "symbol");
  const hzusdSupply = await tryRead<bigint>(client, ADDRESSES.HZUSD, ERC20ABI, "totalSupply");

  if (hzusdDecimals !== null) ok("hzUSD decimals", hzusdDecimals);
  else fail("hzUSD decimals", "call failed — check address");
  if (hzusdSymbol !== null) ok("hzUSD symbol", hzusdSymbol);
  if (hzusdSupply !== null) ok("hzUSD totalSupply", `${formatEther(hzusdSupply)} (${hzusdSupply})`);

  // ── 3. Minter — Epoch タイミング ──────────────────────────
  sep("3. Minter — Epoch Timing");

  const activePeriodSnake = await tryRead<bigint>(client, ADDRESSES.MINTER, MinterABI, "active_period");
  const activePeriodCamel = await tryRead<bigint>(client, ADDRESSES.MINTER, MinterABI, "activePeriod");
  const weekConst = await tryRead<bigint>(client, ADDRESSES.MINTER, MinterABI, "WEEK");

  let epochStart: number | null = null;

  if (activePeriodSnake !== null && activePeriodSnake > 0n) {
    epochStart = Number(activePeriodSnake);
    ok("Minter.active_period()", `${activePeriodSnake} → ${new Date(epochStart * 1000).toISOString()}`);
  } else {
    fail("Minter.active_period()", "not found or returned 0");
  }

  if (activePeriodCamel !== null && activePeriodCamel > 0n) {
    const ts = Number(activePeriodCamel);
    ok("Minter.activePeriod()", `${activePeriodCamel} → ${new Date(ts * 1000).toISOString()}`);
    if (!epochStart) epochStart = ts;
  } else {
    fail("Minter.activePeriod()", "not found or returned 0");
  }

  if (weekConst !== null) ok("Minter.WEEK()", `${weekConst}s`);

  if (epochStart) {
    // Minter が update_period() 未コールの場合に epochStart が stale になるため補正する。
    // 補正しないと secondsSinceStart が負になり「Next epoch in -Xh」が表示される。
    const now = Math.floor(Date.now() / 1000);
    const correctedEpochStart = advanceToCurrentEpoch(epochStart, now);
    const epochId = Math.floor(correctedEpochStart / EPOCH_DURATION);
    const secondsSinceStart = now - correctedEpochStart;
    const nextEpochStart = correctedEpochStart + EPOCH_DURATION;
    ok("→ Current epochId", epochId);
    ok("→ Seconds since epoch start", `${secondsSinceStart}s (${(secondsSinceStart / 3600).toFixed(1)}h)`);
    ok("→ Next epoch starts", `${new Date(nextEpochStart * 1000).toISOString()} (in ${((nextEpochStart - now) / 3600).toFixed(1)}h)`);
  } else {
    warn("Epoch timing", "Could not determine epoch start. Bribe bot needs this — investigate!");
  }

  // ── 4. VoterV3 — Gauge Discovery ─────────────────────────
  sep("4. VoterV3 — Gauge Discovery");

  const gaugeAddress = await tryRead<`0x${string}`>(
    client, ADDRESSES.VOTER_V3, VoterV3ABI, "gauges", [ADDRESSES.POOL]
  );

  const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

  if (gaugeAddress && gaugeAddress !== ZERO_ADDRESS) {
    ok("VoterV3.gauges(pool)", gaugeAddress);

    // Gauge の alive チェック
    const isAlive = await tryRead<boolean>(
      client, ADDRESSES.VOTER_V3, VoterV3ABI, "isAlive", [gaugeAddress]
    );
    if (isAlive !== null) ok("→ isAlive", isAlive);

    // Gauge のweight確認
    const weight = await tryRead<bigint>(
      client, ADDRESSES.VOTER_V3, VoterV3ABI, "weights", [ADDRESSES.POOL]
    );
    if (weight !== null) ok("→ Current vote weight", weight.toString());

    // ── 5. Bribe Contract ─────────────────────────────────
    sep("5. External Bribe Contract");

    const externalBribe = await tryRead<`0x${string}`>(
      client, ADDRESSES.VOTER_V3, VoterV3ABI, "external_bribes", [gaugeAddress]
    );
    const internalBribe = await tryRead<`0x${string}`>(
      client, ADDRESSES.VOTER_V3, VoterV3ABI, "internal_bribes", [gaugeAddress]
    );

    if (externalBribe && externalBribe !== ZERO_ADDRESS) {
      ok("VoterV3.external_bribes(gauge)", externalBribe);
      console.log(`\n  ★ BRIBE_CONTRACT_ADDRESS=${externalBribe}`);
      console.log("  ★ Set this in your .env and GitHub Secrets!\n");

      // Bribe コントラクトの状態確認
      const rewardsLen = await tryRead<bigint>(
        client, externalBribe, BribeContractABI, "rewardsListLength"
      );
      if (rewardsLen !== null) ok("→ rewardsListLength", rewardsLen.toString());

      // hzUSD の bribe 残高確認 (今 epoch) — stale補正後の epochStart を使う
      if (epochStart !== null) {
        const now2 = Math.floor(Date.now() / 1000);
        const currentEpochStart = advanceToCurrentEpoch(epochStart, now2);
        const epochBribed = await tryRead<bigint>(
          client, externalBribe, BribeContractABI,
          "tokenRewardsPerEpoch", [ADDRESSES.HZUSD, currentEpochStart]
        );
        if (epochBribed !== null) {
          ok("→ hzUSD bribed this epoch", `${formatEther(epochBribed)} hzUSD`);
        }
      }
    } else {
      fail("VoterV3.external_bribes(gauge)", `${externalBribe} — zero address or call failed`);
      warn("Action required", "External bribe contract not set. Contact Hybra team.");
    }

    if (internalBribe && internalBribe !== ZERO_ADDRESS) {
      ok("VoterV3.internal_bribes(gauge)", internalBribe);
    }
  } else {
    fail("VoterV3.gauges(pool)", `${gaugeAddress} — zero address or call failed`);
    warn("Action required", "Gauge not found for this pool. Check pool address or contact Hybra.");
  }

  // ── 6. Whitelist チェック ─────────────────────────────────
  sep("6. Token Whitelist Check");

  const isHzusdWhitelisted = await tryRead<boolean>(
    client, ADDRESSES.VOTER_V3, VoterV3ABI, "isWhitelistedToken", [ADDRESSES.HZUSD]
  );

  if (isHzusdWhitelisted === true) {
    ok("hzUSD is whitelisted for bribes", true);
  } else if (isHzusdWhitelisted === false) {
    fail("hzUSD is NOT whitelisted", "Contact Hybra team to whitelist hzUSD before bribing");
  } else {
    warn("Could not check whitelist", "isWhitelistedToken() call failed");
  }

  // ── 7. Function Selectors 確認 ────────────────────────────
  sep("7. Expected Function Selectors (for ABI verification)");

  const selectors = [
    { name: "notifyRewardAmount(address,uint256)", desc: "BribeContract — bribe投入" },
    { name: "active_period()", desc: "Minter — epoch取得" },
    { name: "gauges(address)", desc: "VoterV3 — gauge取得" },
    { name: "external_bribes(address)", desc: "VoterV3 — bribe取得" },
  ];

  for (const s of selectors) {
    const selector = toFunctionSelector(s.name);
    ok(`${s.desc}`, `${s.name} → ${selector}`);
  }

  // ── Summary ───────────────────────────────────────────────
  sep("Summary");
  console.log("  Copy confirmed values to .env:\n");
  console.log(`  HZUSD_ADDRESS=${ADDRESSES.HZUSD}`);
  console.log(`  POOL_ADDRESS=${ADDRESSES.POOL}`);
  console.log(`  VOTER_ADDRESS=${ADDRESSES.VOTER_V3}`);
  console.log(`  MINTER_ADDRESS=${ADDRESSES.MINTER}`);
  console.log(`  BRIBE_CONTRACT_ADDRESS=<from step 5 above>`);
  console.log("\n  Phase 0 complete. Review results above before proceeding to implementation.");
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
