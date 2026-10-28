// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { formatAmount, formatFiatCents } from "./amount.js";
import { tFor } from "./i18n.js";
import { COPY_CLEAR_MS } from "./tokens.js";

// Shared presentational components (U001). View-model only — no key logic,
// no network, no floats on money (all amounts are bigint base units).
// Every user string goes through an i18n key; pass `lng` (default "en").

// ---------------------------------------------------------------------------
// Amount
// ---------------------------------------------------------------------------

export interface AmountProps {
  value: bigint;
  decimals: number;
  symbol?: string;
  /** Precomputed fiat string (integer-math, e.g. via formatFiatCents). */
  fiat?: string;
  lng?: string;
  testID?: string;
}

export function Amount({ value, decimals, symbol, fiat, lng = "en", testID }: AmountProps) {
  const t = tFor(lng);
  const text = symbol ? `${formatAmount(value, decimals)} ${symbol}` : formatAmount(value, decimals);
  void t;
  return (
    <View testID={testID ?? "amount"}>
      <Text testID="amount-value">{text}</Text>
      {fiat !== undefined ? <Text testID="amount-fiat">{fiat}</Text> : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// AddressRow (truncate + copy with auto-clear timer)
// ---------------------------------------------------------------------------

export function truncateAddressUi(addr: string, chars = 4): string {
  if (addr.length <= chars * 2 + 3) return addr;
  return `${addr.slice(0, chars + (addr.startsWith("0x") ? 2 : 0))}…${addr.slice(-chars)}`;
}

export interface CopyTimer {
  notifyCopied(): void;
  cancel(): void;
}

/**
 * Clipboard-hygiene timer: invokes `onClear` (parent clears the "copied"
 * indicator / clipboard) `clearMs` after each copy. Testable without React.
 */
export function createCopyTimer(clearMs: number, onClear: () => void): CopyTimer {
  if (!Number.isInteger(clearMs) || clearMs <= 0) throw new Error("bad clearMs");
  let handle: ReturnType<typeof setTimeout> | null = null;
  return {
    notifyCopied() {
      if (handle !== null) clearTimeout(handle);
      handle = setTimeout(() => {
        handle = null;
        onClear();
      }, clearMs);
    },
    cancel() {
      if (handle !== null) clearTimeout(handle);
      handle = null;
    },
  };
}

export interface AddressRowProps {
  address: string;
  chars?: number;
  lng?: string;
  clearMs?: number;
  onCopy?: (address: string) => void;
  testID?: string;
}

export function AddressRow({ address, chars = 4, lng = "en", clearMs = COPY_CLEAR_MS, onCopy, testID }: AddressRowProps) {
  const t = tFor(lng);
  const [copied, setCopied] = useState(false);
  const timer = useRef<CopyTimer | null>(null);
  useEffect(() => () => timer.current?.cancel(), []);
  const copy = () => {
    onCopy?.(address);
    setCopied(true);
    timer.current ??= createCopyTimer(clearMs, () => setCopied(false));
    timer.current.notifyCopied();
  };
  return (
    <View testID={testID ?? "address-row"}>
      <Text testID="address-text">{truncateAddressUi(address, chars)}</Text>
      <Pressable testID="address-copy" accessibilityLabel={t("common.copy")} onPress={copy}>
        <Text>{copied ? t("common.copied") : t("common.copy")}</Text>
      </Pressable>
    </View>
  );
}

// ---------------------------------------------------------------------------
// ChainBadge (extends the index.ts chainBadge helper with testnets)
// ---------------------------------------------------------------------------

const CHAIN_LABELS: Record<string, string> = {
  "eip155:1": "Ethereum",
  "eip155:56": "BNB",
  "eip155:137": "Polygon",
  "eip155:42161": "Arbitrum",
  "eip155:8453": "Base",
  "eip155:11155111": "Sepolia",
  "eip155:97": "BSC Testnet",
  "eip155:80002": "Amoy",
  "eip155:421614": "Arbitrum Sepolia",
  "eip155:84532": "Base Sepolia",
  "solana:mainnet": "Solana",
  "solana:devnet": "Solana Devnet",
  "bip122:000000000019d6689c085ae165831e93": "Bitcoin",
  "cardano:mainnet": "Cardano",
  "cardano:preprod": "Cardano Preprod",
};

/** Human label for a CAIP-2 chain id; unknown chains echo the id. */
export function chainLabel(chainId: string): string {
  return CHAIN_LABELS[chainId] ?? chainId;
}

export function ChainBadge({ chainId, testID }: { chainId: string; testID?: string }) {
  return (
    <View testID={testID ?? "chain-badge"}>
      <Text testID="chain-badge-label">{chainLabel(chainId)}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// FeePicker (low/med/high + fiat, bigint-exact)
// ---------------------------------------------------------------------------

export type FeeLevel = "low" | "med" | "high";
export const FEE_LEVELS: FeeLevel[] = ["low", "med", "high"];

/** Integer multipliers: low 4/5, med 1, high 3/2 (ceil division). */
const FEE_NUM: Record<FeeLevel, bigint> = { low: 4n, med: 1n, high: 3n };
const FEE_DEN: Record<FeeLevel, bigint> = { low: 5n, med: 1n, high: 2n };

export function quoteFeeBaseUnits(medianFeeBaseUnits: bigint, level: FeeLevel): bigint {
  if (medianFeeBaseUnits < 0n) throw new Error("bad median fee");
  const num = FEE_NUM[level] as bigint;
  const den = FEE_DEN[level] as bigint;
  return (medianFeeBaseUnits * num + den - 1n) / den;
}

export interface FeeTierOption {
  level: FeeLevel;
  feeBaseUnits: bigint;
  etaKey: string;
  fiat: string;
}

export function feeTierOptions(
  medianFeeBaseUnits: bigint,
  decimals: number,
  priceCents: bigint,
): FeeTierOption[] {
  return FEE_LEVELS.map((level) => {
    const fee = quoteFeeBaseUnits(medianFeeBaseUnits, level);
    return { level, feeBaseUnits: fee, etaKey: `fee.${level}`, fiat: formatFiatCents(fee, decimals, priceCents) };
  });
}

export interface FeePickerProps {
  options: FeeTierOption[];
  selected: FeeLevel;
  onSelect: (level: FeeLevel) => void;
  lng?: string;
  testID?: string;
}

const ETA_MIN: Record<FeeLevel, string> = { low: "30", med: "5", high: "1" };

export function FeePicker({ options, selected, onSelect, lng = "en", testID }: FeePickerProps) {
  const t = tFor(lng);
  return (
    <View testID={testID ?? "fee-picker"}>
      {options.map((o) => (
        <Pressable
          key={o.level}
          testID={`fee-${o.level}`}
          accessibilityLabel={`${t(o.etaKey)} ~${ETA_MIN[o.level]} min ${o.fiat}`}
          onPress={() => onSelect(o.level)}
        >
          <Text>
            {t(o.etaKey)} · {o.fiat}
            {o.level === selected ? " ✓" : ""}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// PolicyBanner (allow / warn / block from policy-engine verdicts)
// ---------------------------------------------------------------------------

// Structural mirror of @drift/policy-engine Finding (read-only contract).
export interface PolicyFinding {
  severity: "info" | "warn" | "block";
  code: string;
  message: string;
}

export type PolicyVerdictKind = "allow" | "warn" | "block";

const VERDICT_KEY: Record<PolicyVerdictKind, string> = {
  allow: "policy.allow",
  warn: "policy.warn",
  block: "policy.block",
};

export interface PolicyBannerProps {
  verdict: PolicyVerdictKind;
  findings: PolicyFinding[];
  lng?: string;
  testID?: string;
}

export function PolicyBanner({ verdict, findings, lng = "en", testID }: PolicyBannerProps) {
  const t = tFor(lng);
  return (
    <View testID={testID ?? `policy-${verdict}`} accessibilityLabel={t(VERDICT_KEY[verdict])}>
      <Text testID="policy-title">{t(VERDICT_KEY[verdict])}</Text>
      {findings.map((f, i) => (
        <Text key={`${f.code}-${i}`} testID={`policy-finding-${f.code}`}>
          {f.message}
        </Text>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// BiometricGate
// ---------------------------------------------------------------------------

export interface BiometricGateProps {
  required: boolean;
  authenticated: boolean;
  onAuthenticate: () => void;
  lng?: string;
  children?: unknown;
  testID?: string;
}

export function BiometricGate({ required, authenticated, onAuthenticate, lng = "en", children, testID }: BiometricGateProps) {
  const t = tFor(lng);
  if (!required || authenticated) {
    return <View testID={testID ?? "biometric-gate"}>{children as never}</View>;
  }
  return (
    <View testID={testID ?? "biometric-gate"}>
      <Text testID="biometric-prompt">{t("biometric.prompt")}</Text>
      <Pressable testID="biometric-auth" accessibilityLabel={t("biometric.prompt")} onPress={onAuthenticate}>
        <Text>{t("biometric.prompt")}</Text>
      </Pressable>
    </View>
  );
}

// ---------------------------------------------------------------------------
// WatchOnlyBanner (I012): persistent "view only" banner for watch-only accounts.
// ---------------------------------------------------------------------------

export interface WatchOnlyBannerProps {
  watchOnly?: boolean;
  isWatchOnly?: boolean;
  account?: { kind?: string } | null;
  lng?: string;
  testID?: string;
  children?: unknown;
}

export function WatchOnlyBanner({ watchOnly, isWatchOnly, account, lng = "en", testID }: WatchOnlyBannerProps) {
  const resolved =
    watchOnly === true ||
    isWatchOnly === true ||
    account?.kind === "watch-only";
  if (!resolved) return null;
  const t = tFor(lng);
  const label = t("watchOnly.banner") === "watchOnly.banner" ? "View only" : t("watchOnly.banner");
  return (
    <View testID={testID ?? "watch-only-banner"} accessibilityLabel={label}>
      <Text testID="watch-only-banner-text">{label}</Text>
    </View>
  );
}
