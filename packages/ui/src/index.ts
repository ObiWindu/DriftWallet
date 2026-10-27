// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

export function truncateAddress(addr: string, chars = 4): string {
  if (addr.length <= chars * 2 + 3) return addr;
  return `${addr.slice(0, chars + (addr.startsWith("0x") ? 2 : 0))}…${addr.slice(-chars)}`;
}

// Pure presentational helpers only. No key logic allowed in @drift/ui.
export function chainBadge(chainId: string): string {
  const map: Record<string, string> = {
    "eip155:1": "Ethereum", "eip155:56": "BNB", "eip155:137": "Polygon",
    "eip155:42161": "Arbitrum", "eip155:8453": "Base",
    "eip155:11155111": "Sepolia", "eip155:97": "BSC Testnet",
    "eip155:80002": "Amoy", "eip155:421614": "Arbitrum Sepolia",
    "eip155:84532": "Base Sepolia",
    "solana:mainnet": "Solana", "solana:devnet": "Solana Devnet",
    "bip122:000000000019d6689c085ae165831e93": "Bitcoin",
    "cardano:mainnet": "Cardano", "cardano:preprod": "Cardano Preprod",
  };
  return map[chainId] ?? chainId;
}

export * from "./amount.js";
export * from "./tokens.js";
export * from "./i18n.js";
export {
  AddressRow,
  Amount,
  BiometricGate,
  ChainBadge,
  FEE_LEVELS,
  FeePicker,
  PolicyBanner,
  chainLabel,
  createCopyTimer,
  feeTierOptions,
  quoteFeeBaseUnits,
  truncateAddressUi,
} from "./components.js";
export type {
  AddressRowProps,
  AmountProps,
  BiometricGateProps,
  CopyTimer,
  FeeLevel,
  FeePickerProps,
  FeeTierOption,
  PolicyBannerProps,
  PolicyFinding,
  PolicyVerdictKind,
} from "./components.js";
