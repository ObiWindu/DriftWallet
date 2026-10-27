// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

// Extension-local presentational primitives (U020). Thin React shells over
// the tested view-models in theme.ts/popup.ts/approval.ts. Self-contained —
// no dependency on in-flight mobile work (duplication accepted, Stream B).
import { createContext, useContext } from "react";
import type { JSX, ReactNode } from "react";
import { themeFor, type Theme, type ThemeMode } from "./theme.js";
import { formatBalance, formatCents, assetValueCents } from "./popup.js";
import { truncateAddress } from "./theme.js";

const ThemeCtx = createContext<Theme>(themeFor("light"));

export function ThemeProvider(props: { mode?: ThemeMode | undefined; children: ReactNode }): JSX.Element {
  return <ThemeCtx.Provider value={themeFor(props.mode ?? "light")}>{props.children}</ThemeCtx.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeCtx);
}

/** Bigint-aware amount (minor units → human string). */
export function Amount(props: { minor: string; decimals: number }): JSX.Element {
  const t = useTheme();
  return <span style={{ color: t.text }}>{formatBalance(props.minor, props.decimals)}</span>;
}

/** Fiat value rendered from integer cents (no float). */
export function FiatValue(props: { minor: string; decimals: number; priceUsd: number | string }): JSX.Element {
  const t = useTheme();
  return <span style={{ color: t.muted }}>${formatCents(assetValueCents(props.minor, props.decimals, props.priceUsd))}</span>;
}

export function AddressRow(props: { address: string; explorerUrl?: string | undefined }): JSX.Element {
  const t = useTheme();
  const short = truncateAddress(props.address);
  const body = <span style={{ color: t.text }}>{short}</span>;
  return props.explorerUrl ? (
    <a href={props.explorerUrl} target="_blank" rel="noreferrer" aria-label={`view ${props.address}`}>
      {body}
    </a>
  ) : (
    body
  );
}

export function ChainBadge(props: { chain: string; testnet?: boolean | undefined }): JSX.Element {
  const t = useTheme();
  return (
    <span
      style={{ background: t.surface, color: t.muted, borderRadius: 999, padding: "2px 8px" }}
      aria-label={`chain ${props.chain}`}
    >
      {props.chain}
      {props.testnet === true ? " · testnet" : ""}
    </span>
  );
}

export function PolicyBanner(props: { verdict: "allow" | "deny" | "stepUp"; reason: string }): JSX.Element {
  const t = useTheme();
  const tone = props.verdict === "allow" ? t.ok : props.verdict === "deny" ? t.bad : t.warn;
  return (
    <div role="alert" style={{ border: `1px solid ${tone}`, color: tone, padding: 8 }}>
      <strong>{props.verdict}</strong>: {props.reason}
    </div>
  );
}

export interface FeeTier {
  key: "low" | "med" | "high";
  minor: bigint;
}

export function FeePickerView(props: {
  tiers: [FeeTier, FeeTier, FeeTier];
  selected: FeeTier["key"];
  decimals: number;
  symbol: string;
  onSelect?: ((key: FeeTier["key"]) => void) | undefined;
}): JSX.Element {
  const t = useTheme();
  return (
    <div role="radiogroup" aria-label="fee picker" style={{ display: "flex", gap: 8 }}>
      {props.tiers.map((tier) => (
        <button
          key={tier.key}
          role="radio"
          aria-checked={tier.key === props.selected}
          onClick={() => props.onSelect?.(tier.key)}
          style={{
            border: `1px solid ${tier.key === props.selected ? t.primary : t.border}`,
            background: t.surface,
            color: t.text,
            borderRadius: 10,
            padding: "6px 10px",
          }}
        >
          {tier.key}: {formatBalance(tier.minor.toString(), props.decimals)} {props.symbol}
        </button>
      ))}
    </div>
  );
}
