// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

export const EVM_CHAINS = [
  { id: 1, name: "ethereum", rpcAlias: "eth-mainnet" },
  { id: 56, name: "bnb", rpcAlias: "bsc-mainnet" },
  { id: 137, name: "polygon", rpcAlias: "polygon-mainnet" },
  { id: 42161, name: "arbitrum", rpcAlias: "arbitrum-mainnet" },
  { id: 8453, name: "base", rpcAlias: "base-mainnet" },
] as const;

export type EvmChainId = (typeof EVM_CHAINS)[number]["id"];

export const CHAIN_IDS = {
  ethereum: "eip155:1",
  bnb: "eip155:56",
  polygon: "eip155:137",
  arbitrum: "eip155:42161",
  base: "eip155:8453",
  solana: "solana:mainnet",
  bitcoin: "bip122:000000000019d6689c085ae165831e93",
  cardano: "cardano:mainnet",
} as const;

export const DERIVATION_PATHS = {
  evm: (i: number) => `m/44'/60'/0'/0/${i}`,
  solana: (i: number) => `m/44'/501'/${i}'/0'`,
  bitcoin: (i: number) => `m/84'/0'/0'/0/${i}`,
  cardano: (i: number) => `m/1852'/1815'/0'/0/${i}`,
} as const;

export interface Balance {
  chainId: string;
  address: string;
  totalBaseUnits: bigint;
  decimals: number;
}

export interface UnsignedIntent {
  chainId: string;
  kind: "native-transfer" | "token-transfer" | "dapp-sign";
  signerRequest: unknown;
  humanReadable: { from: string; to: string; amountBaseUnits: string; feeBaseUnits: string; warnings: string[] };
}

export function formatUnits(value: bigint, decimals: number): string {
  if (decimals < 0 || decimals > 36) throw new Error("bad decimals");
  const neg = value < 0n;
  const abs = neg ? -value : value;
  const s = abs.toString().padStart(decimals + 1, "0");
  const int = s.slice(0, s.length - decimals);
  let frac = s.slice(s.length - decimals);
  frac = frac.replace(/0+$/, "");
  const out = frac.length === 0 ? int : `${int}.${frac}`;
  return neg ? `-${out}` : out;
}

export function parseUnits(text: string, decimals: number): bigint {
  if (!/^\d+(\.\d+)?$/.test(text.trim())) throw new Error("bad amount");
  const [i, f = ""] = text.trim().split(".") as [string, string];
  if (f.length > decimals) throw new Error("too many decimals");
  const frac = (f + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(i === "" ? "0" : i) * 10n ** BigInt(decimals) + (frac === "" ? 0n : BigInt(frac));
}

// ---------------------------------------------------------------------------
// T004: registry, fees, address validation
// ---------------------------------------------------------------------------

/** `"true"`/`"1"` enables mainnet. Default false (testnets only) per SPEC DoD. */
function readMainnetFlag(): boolean {
  try {
    const v =
      typeof process !== "undefined"
        ? (process.env?.["DRIFT_MAINNET"] ?? process.env?.["EXPO_PUBLIC_DRIFT_MAINNET"])
        : undefined;
    return v === "true" || v === "1";
  } catch {
    return false;
  }
}

export const MAINNET_ENABLED: boolean = readMainnetFlag();

export const EVM_TESTNETS = [
  { id: 11155111, name: "sepolia", rpcAlias: "eth-sepolia" },
  { id: 97, name: "bsc-testnet", rpcAlias: "bsc-testnet" },
  { id: 80002, name: "polygon-amoy", rpcAlias: "polygon-amoy" },
  { id: 421614, name: "arbitrum-sepolia", rpcAlias: "arbitrum-sepolia" },
  { id: 84532, name: "base-sepolia", rpcAlias: "base-sepolia" },
] as const;

export type EvmTestnetId = (typeof EVM_TESTNETS)[number]["id"];

/** chainId (EVM numeric) -> testnet metadata. Non-EVM testnets keyed by string id. */
export const TESTNETS: Record<number | string, string> = {
  11155111: "sepolia",
  97: "bsc-testnet",
  80002: "polygon-amoy",
  421614: "arbitrum-sepolia",
  84532: "base-sepolia",
  "solana:devnet": "solana-devnet",
  "bip122:000000000019d6689c085ae165831e93-test": "btc-signet",
  "cardano:preprod": "cardano-preprod",
} as const;

export interface EvmChainMeta {
  id: number;
  name: string;
  rpcAlias: string;
  testnet: boolean;
}

const MAINNET_META: EvmChainMeta[] = EVM_CHAINS.map((c) => ({ ...c, testnet: false }));
const TESTNET_META: EvmChainMeta[] = EVM_TESTNETS.map((c) => ({ ...c, testnet: true }));

export const ChainRegistry = {
  getEvmChain(chainId: number): EvmChainMeta {
    const found = [...MAINNET_META, ...TESTNET_META].find((c) => c.id === chainId);
    if (!found) throw new Error(`unknown chain ${chainId}`);
    if (found.testnet === false && !MAINNET_ENABLED) {
      throw new Error(`mainnet chain ${chainId} disabled (DRIFT_MAINNET not set)`);
    }
    return found;
  },
  isAllowed(chainId: number): boolean {
    try {
      this.getEvmChain(chainId);
      return true;
    } catch {
      return false;
    }
  },
  mainnets(): EvmChainMeta[] {
    return [...MAINNET_META];
  },
  testnets(): EvmChainMeta[] {
    return [...TESTNET_META];
  },
};

/** Low/med/high fee quote. All money as bigint base units. */
export interface FeeQuote {
  low: bigint;
  med: bigint;
  high: bigint;
}

export function makeFeeQuote(low: bigint, med: bigint, high: bigint): FeeQuote {
  if (low < 0n || med < 0n || high < 0n) throw new Error("negative fee");
  if (!(low <= med && med <= high)) throw new Error("fee tiers unordered");
  return { low, med, high };
}

/**
 * Format a fiat value from a base-unit amount and a USD price.
 * Uses integer math on price cents: no float touches money.
 * `priceUsd` accepts a decimal string (exact) or number (rounded to cents).
 */
export function formatFiat(amountBaseUnits: bigint, decimals: number, priceUsd: number | string): string {
  if (decimals < 0 || decimals > 36) throw new Error("bad decimals");
  const neg = amountBaseUnits < 0n;
  const abs = neg ? -amountBaseUnits : amountBaseUnits;
  let priceCents: bigint;
  if (typeof priceUsd === "string") {
    if (!/^\d+(\.\d{1,2})?$/.test(priceUsd.trim())) throw new Error("bad price");
    const [d, c = ""] = priceUsd.trim().split(".") as [string, string];
    priceCents = BigInt(d) * 100n + BigInt((c + "00").slice(0, 2));
  } else {
    if (!Number.isFinite(priceUsd) || priceUsd < 0) throw new Error("bad price");
    priceCents = BigInt(Math.round(priceUsd * 100));
  }
  const totalCents = (abs * priceCents) / 10n ** BigInt(decimals);
  const dollars = totalCents / 100n;
  const cents = (totalCents % 100n).toString().padStart(2, "0");
  return `${neg ? "-" : ""}$${dollars.toString()}.${cents}`;
}

const RE_0X = /^0x[0-9a-fA-F]{40}$/;
const RE_BASE58_SOL = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const RE_BTC = /^(bc1[qp][0-9a-z]{38,59}|tb1[qp][0-9a-z]{38,59}|bcrt1[qp][0-9a-z]{38,59})$/;
const RE_ADA = /^addr1[0-9a-z]+$/;

/**
 * Validate an address for a chain.
 * `chainId` accepts CAIP-2 strings ("eip155:1", "solana:mainnet", "bip122:…",
 * "cardano:mainnet", …testnet variants) or a bare EVM numeric id.
 */
export function validateAddress(chainId: string | number, addr: string): boolean {
  if (typeof addr !== "string" || addr.length === 0) return false;
  if (typeof chainId === "number") return RE_0X.test(addr);
  const id = chainId.toLowerCase();
  if (id.startsWith("eip155:")) return RE_0X.test(addr);
  if (id.startsWith("solana:")) return RE_BASE58_SOL.test(addr);
  if (id.startsWith("bip122:")) return RE_BTC.test(addr);
  if (id.startsWith("cardano:")) return RE_ADA.test(addr) && addr.length >= 50 && addr.length <= 120;
  return false;
}
